import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import path from "path";
import fs from "fs";

import { getConfig } from "../../config/index.js";
import { createAxiomAgent } from "../../agent/index.js";
import { INTERACTIVE_INGEST_PREFIX } from "../../agent/prompts.js";
import type { CoreMessage } from "../../agent/types.js";
import { readSourceFile, SUPPORTED_EXTS } from "../../core/files.js";
import { updateIndex, appendLog, snapshotWiki, diffWiki } from "../../core/wiki.js";
import { getIngestedFromLog } from "../../core/sources.js";
import { calcCost, appendUsageLog } from "../../core/usage.js";
import { loadIgnorePatterns } from "../../core/watcher.js";
import ignore from "ignore";

interface Props {
  file?: string;
  interactive?: boolean;
  onExit?: () => void;
}

type Status = "running" | "done" | "error";
type IngestStep =
  | "idle"
  | "reingest-confirm"
  | "interactive-reply"
  | "interactive-confirm"
  | "running"
  | "done"
  | "no-files";

interface FileResult {
  filename: string;
  lines: Array<{ text: string; color?: string }>;
  pagesCreated: string[];
  changes: Array<{ path: string; type: "created" | "modified" }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  } | null;
  status: Status;
}

function extractPages(text: string): string[] {
  const pages: string[] = [];
  const re = /wiki\/pages\/[\w/-]+\.md/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!pages.includes(m[0])) pages.push(m[0]);
  }
  return pages;
}

export function IngestScreen({ file, interactive = false, onExit }: Props) {
  const { exit } = useApp();
  const doExit = onExit ?? exit;
  const config = getConfig();

  const [step, setStep] = useState<IngestStep>("idle");
  const [interactivePrompt, setInteractivePrompt] = useState("");
  const [interactiveInput, setInteractiveInput] = useState("");

  const [results, setResults] = useState<FileResult[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [liveLines, setLiveLines] = useState<
    Array<{ text: string; color?: string }>
  >([]);
  const [currentPages, setCurrentPages] = useState<string[]>([]);
  const [isReingest, setIsReingest] = useState(false);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  useEffect(() => {
    if (step !== "running") return;
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [step]);

  // Kick off once on mount
  useEffect(() => {
    if (!config || step !== "idle") return;
    void startIngest();
  }, []);

  async function startIngest() {
    if (!config) return;
    const agent = createAxiomAgent(config);
    const { wikiDir, rawDir } = config;
    const logPath = path.join(wikiDir, "wiki/log.md");

    // Resolve file list
    let filesToProcess: string[] = [];
    if (file) {
      // Strip surrounding quotes and unescape shell-escaped spaces/chars
      const cleaned = file
        .trim()
        .replace(/^["']|["']$/g, "") // remove surrounding " or '
        .replace(/\\(.)/g, "$1"); // unescape \<char> → <char>
      const abs = path.resolve(cleaned);
      if (!fs.existsSync(abs)) {
        addResult(
          cleaned,
          [{ text: `✗ File not found: ${abs}`, color: "red" }],
          [],
          [],
          null,
          "error",
        );
        setStep("done");
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      if (!SUPPORTED_EXTS.includes(ext)) {
        addResult(
          cleaned,
          [{ text: `✗ Unsupported file type: ${ext}`, color: "red" }],
          [],
          [],
          null,
          "error",
        );
        setStep("done");
        return;
      }
      filesToProcess = [abs];
    } else {
      const ingested = getIngestedFromLog(logPath);
      const ignorePatterns = loadIgnorePatterns(rawDir);
      const ig = ignore().add(ignorePatterns);

      const allRaw = fs.existsSync(rawDir)
        ? fs.readdirSync(rawDir).filter((f: string) => {
            const ext = path.extname(f).toLowerCase();
            if (!SUPPORTED_EXTS.includes(ext)) return false;
            if (!fs.statSync(path.join(rawDir, f)).isFile()) return false;
            if (ig.ignores(f)) return false;
            return true;
          })
        : [];
      filesToProcess = allRaw
        .filter((f: string) => !ingested.has(f))
        .map((f: string) => path.join(rawDir, f));

      if (filesToProcess.length === 0) {
        setStep("no-files");
        return;
      }
    }

    // Process files sequentially
    for (const filepath of filesToProcess) {
      const filename = path.basename(filepath);
      setCurrentFile(filename);
      setLiveLines([]);
      setCurrentPages([]);

      // Detect re-ingest: check the log file (authoritative source of truth)
      const ingested = getIngestedFromLog(logPath);
      const reingest = ingested.has(filename);
      setIsReingest(reingest);

      // If a specific file was passed and it's already ingested, ask the user
      if (file && reingest) {
        setStep("reingest-confirm");
        return; // wait for user input — continueAfterReingestConfirm will resume
      }

      // Interactive mode: first pass — get topics
      if (interactive) {
        const firstMessage = await buildMessage(filepath, reingest, "");
        const interactiveMsg: CoreMessage = {
          role: "user",
          content:
            typeof firstMessage.content === "string"
              ? `${INTERACTIVE_INGEST_PREFIX}\n\n${firstMessage.content}`
              : [
                  { type: "text", text: INTERACTIVE_INGEST_PREFIX },
                  ...(firstMessage.content as any[]),
                ],
        };
        const firstResult = await agent.generate([interactiveMsg]);
        setInteractivePrompt(firstResult.text);
        setStep("interactive-reply");
        // Pause here — useInput will call continueInteractive()
        return;
      }

      setStep("running");
      const ok = await runIngest(agent, filepath, filename, reingest, "");
      if (!ok) break;
    }

    setCurrentFile(null);
    setStep("done");
  }

  async function continueAfterReingestConfirm() {
    if (!config || !currentFile) return;
    const agent = createAxiomAgent(config);
    const filepath = file
      ? path.resolve(file)
      : path.join(config.rawDir, currentFile);
    setStep("running");
    await runIngest(agent, filepath, currentFile, true, ""); // single file — no loop, stop regardless
    setCurrentFile(null);
    setStep("done");
  }

  async function continueInteractive(userInput: string) {
    if (!config || !currentFile) return;
    const agent = createAxiomAgent(config);
    const filepath = file
      ? path.resolve(file)
      : path.join(config.rawDir, currentFile);

    setStep("running");

    const lines: Array<{ text: string; color?: string }> = [];

    try {
      const message = await buildMessage(filepath, isReingest, userInput);
      const result = await agent.generate([message], {
        onStepFinish: (step: any) => {
          try {
            for (const call of step.toolCalls ?? []) {
              const toolName =
                call.toolName ?? call.payload?.toolName ?? "tool";
              const args = JSON.stringify(
                call.args ?? call.payload?.args ?? {},
              );
              const entry = {
                text: `⚙ ${toolName}(${args.slice(0, 80)}${args.length > 80 ? "…" : ""})`,
                color: "yellow" as string | undefined,
              };
              lines.push(entry);
              setLiveLines((prev) => [...prev, entry].slice(-20));
            }
          } catch {
            /* never crash the agent loop */
          }
        },
      });

      const pagesFound = extractPages(result.text ?? "");
      setCurrentPages(pagesFound);

      // Interactive confirm step
      setInteractivePrompt(
        `Created ${pagesFound.length} pages.\n${pagesFound
          .slice(0, 8)
          .map((p) => `  · ${p}`)
          .join("\n")}`,
      );
      setStep("interactive-confirm");
    } catch (err: unknown) {
      lines.push({
        text: `✗ ${err instanceof Error ? err.message : String(err)}`,
        color: "red",
      });
      addResult(currentFile!, lines, [], [], null, "error");
      setCurrentFile(null);
      setStep("done");
    }
  }

  async function finaliseInteractive() {
    if (!config || !currentFile) return;

    setStep("running");
    try {
      await updateIndex(config.wikiDir);
      await appendLog(config.wikiDir, currentFile, "ingest");
    } catch {
      /* best effort */
    }

    const changes = diffWiki(new Map(), config.wikiDir);
    addResult(currentFile, [], currentPages, changes, null, "done");
    setCurrentFile(null);
    setStep("done");
  }

  async function runIngest(
    agent: ReturnType<typeof createAxiomAgent>,
    filepath: string,
    filename: string,
    reingest: boolean,
    userContext: string,
  ): Promise<boolean> {
    if (!config) return false;
    const lines: Array<{ text: string; color?: string }> = [];
    const before = snapshotWiki(config.wikiDir);

    try {
      const message = await buildMessage(filepath, reingest, userContext);
      const result = await agent.generate([message], {
        onStepFinish: (step: any) => {
          try {
            for (const call of step.toolCalls ?? []) {
              const toolName =
                call.toolName ?? call.payload?.toolName ?? "tool";
              const args = JSON.stringify(
                call.args ?? call.payload?.args ?? {},
              );
              const entry = {
                text: `⚙ ${toolName}(${args.slice(0, 80)}${args.length > 80 ? "…" : ""})`,
                color: "yellow" as string | undefined,
              };
              lines.push(entry);
              setLiveLines((prev) => [...prev, entry].slice(-20));
            }
            for (const res of step.toolResults ?? []) {
              const r = res.result ?? res.payload?.result;
              if (r && typeof r === "string" && r.length < 120) {
                const entry = {
                  text: `  → ${r}`,
                  color: "gray" as string | undefined,
                };
                lines.push(entry);
                setLiveLines((prev) => [...prev, entry].slice(-20));
              }
            }
          } catch {
            /* never crash the agent loop */
          }
        },
      });

      // Extract pages from agent's final text
      const pagesFound = extractPages(result.text ?? "");
      setCurrentPages(pagesFound);

      // Always write index + log ourselves — don't rely on the agent
      await updateIndex(config.wikiDir);
      await appendLog(config.wikiDir, filename, "ingest");

      // Usage + cost
      const usage = (result as any).usage ?? null;
      const inputTokens: number =
        usage?.inputTokens ?? usage?.promptTokens ?? 0;
      const outputTokens: number =
        usage?.outputTokens ?? usage?.completionTokens ?? 0;
      const costUsd = calcCost(
        config.provider,
        config.model,
        inputTokens,
        outputTokens,
      );
      appendUsageLog(config.wikiDir, {
        timestamp: new Date().toISOString(),
        operation: reingest ? "reingest" : "ingest",
        source: filename,
        provider: config.provider,
        model: config.model,
        inputTokens,
        outputTokens,
        costUsd,
      });

      const changes = diffWiki(before, config.wikiDir);
      addResult(
        filename,
        lines,
        pagesFound,
        changes,
        { inputTokens, outputTokens, costUsd },
        "done",
      );
      return true;
    } catch (err: unknown) {
      const changes = diffWiki(before, config.wikiDir);
      lines.push({
        text: `✗ ${err instanceof Error ? err.message : String(err)}`,
        color: "red",
      });
      addResult(filename, lines, [], changes, null, "error");
      return false;
    }
  }

  async function buildMessage(
    filepath: string,
    reingest: boolean,
    userContext: string,
  ): Promise<CoreMessage> {
    const src = await readSourceFile(filepath);
    const instruction = reingest
      ? `Re-ingest this source file into the wiki (diff against existing pages). Filename: ${src.filename}${userContext ? `\n\nUser instructions: ${userContext}` : ""}`
      : `Ingest this source file into the wiki. Filename: ${src.filename}${userContext ? `\n\nUser instructions: ${userContext}` : ""}`;

    if (src.isBase64 && src.mimeType.startsWith("image/")) {
      return {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image", image: src.content, mimeType: src.mimeType as any },
        ],
      };
    }

    if (src.isBase64) {
      // PDF
      return {
        role: "user",
        content: [
          { type: "text", text: instruction },
          {
            type: "file",
            data: src.content,
            mimeType: src.mimeType as any,
            filename: src.filename,
          },
        ],
      };
    }

    // Plain text / markdown / html / docx (already converted to text)
    return {
      role: "user",
      content: `${instruction}\n\n<file_content>\n${src.content}\n</file_content>`,
    };
  }

  function addResult(
    filename: string,
    lines: FileResult["lines"],
    pagesCreated: string[],
    changes: FileResult["changes"],
    usage: FileResult["usage"],
    status: Status,
  ) {
    setResults((prev) => [
      ...prev,
      { filename, lines, pagesCreated, changes, usage, status },
    ]);
  }

  useInput((input, key) => {
    if (key.escape) {
      doExit();
      return;
    }
    if (step === "reingest-confirm") {
      if (input === "y" || input === "Y" || key.return)
        void continueAfterReingestConfirm();
      if (input === "n" || input === "N") {
        setCurrentFile(null);
        setStep("done");
      }
    }
    if (step === "interactive-confirm") {
      if (input === "y" || input === "Y" || key.return)
        void finaliseInteractive();
      if (input === "n" || input === "N") {
        setCurrentFile(null);
        setStep("done");
      }
    }
    if ((step === "done" || step === "no-files") && key.return) {
      doExit();
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <Box padding={1}>
        <Text color="yellow">
          Not configured. Run <Text color="cyan">axiom-wiki init</Text> first.
        </Text>
      </Box>
    );
  }

  if (step === "no-files") {
    return (
      <Box padding={1} flexDirection="column">
        <Text color="gray">
          All files in <Text color="cyan">{config.rawDir}</Text> have already
          been ingested.
        </Text>
        <Box marginTop={1}>
          <Text color="gray">
            Drop new files there, or use{" "}
            <Text color="cyan">axiom-wiki sources</Text> to re-ingest existing
            ones.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press Enter to go back
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>
        Axiom Wiki — Ingest
        {interactive ? <Text color="cyan"> [interactive]</Text> : null}
      </Text>

      {/* Completed results */}
      {results.map((result, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text bold>
            <Text color={result.status === "done" ? "green" : "red"}>
              {result.status === "done" ? "✓" : "✗"}
            </Text>{" "}
            {result.filename}
            {result.pagesCreated.length > 0 && (
              <Text color="gray"> ({result.pagesCreated.length} pages)</Text>
            )}
          </Text>
          {result.usage && (
            <Text color="gray" dimColor>
              {" "}
              in={result.usage.inputTokens} out={result.usage.outputTokens}
              {result.usage.costUsd !== null
                ? `  $${result.usage.costUsd.toFixed(4)}`
                : ""}
            </Text>
          )}
          {result.status === "error" &&
            result.lines.map((line, j) => (
              <Text key={j} color="red" dimColor>
                {" "}
                {line.text}
              </Text>
            ))}
          {result.changes.length > 0 && (
            <Box flexDirection="column" marginLeft={2} marginTop={0}>
              {result.changes.map((c, j) => (
                <Text key={j} color={c.type === "created" ? "green" : "blue"}>
                  {c.type === "created" ? "+ " : "~ "}
                  {c.path}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      ))}

      {/* Active file */}
      {currentFile && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            {isReingest && <Text color="yellow">[re-ingest] </Text>}
            <Text bold color="cyan">
              {currentFile}
            </Text>
          </Box>

          {/* Spinner + tool call log */}
          {step === "running" && (
            <Box flexDirection="column" marginTop={1} marginLeft={2}>
              {liveLines.length === 0 && (
                <Text color="yellow">
                  {spinnerFrames[spinnerTick % spinnerFrames.length]} Calling
                  LLM…
                </Text>
              )}
              {liveLines.length > 0 && (
                <Text color="gray" dimColor>
                  {spinnerFrames[spinnerTick % spinnerFrames.length]} working…
                </Text>
              )}
              {liveLines.slice(-16).map((line, i) => (
                <Text
                  key={i}
                  color={(line.color as any) ?? "gray"}
                  dimColor={!line.color}
                >
                  {line.text}
                </Text>
              ))}
            </Box>
          )}

          {/* Pages as they appear */}
          {currentPages.length > 0 && step !== "running" && (
            <Box flexDirection="column" marginTop={1} marginLeft={2}>
              {currentPages.map((p, i) => (
                <Text key={i} color="green">
                  ✓ {p}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Re-ingest confirmation */}
      {step === "reingest-confirm" && currentFile && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
        >
          <Text color="yellow">
            ⚠ Already ingested: <Text color="white">{currentFile}</Text>
          </Text>
          <Box marginTop={1}>
            <Text bold>Re-ingest and update existing pages? </Text>
            <Text color="gray">(y/n)</Text>
          </Box>
        </Box>
      )}

      {/* Interactive: show topics, wait for user input */}
      {step === "interactive-reply" && (
        <Box flexDirection="column" marginTop={1}>
          <Box
            borderStyle="single"
            borderColor="cyan"
            paddingX={1}
            flexDirection="column"
          >
            <Text color="cyan">Agent found:</Text>
            <Text>{interactivePrompt.slice(0, 400)}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold>
              Any focus areas, things to skip, or framing to apply?
            </Text>
            <Text color="gray">(Press Enter to proceed with defaults)</Text>
            <Box marginTop={1}>
              <Text>{"> "}</Text>
              <TextInput
                value={interactiveInput}
                onChange={setInteractiveInput}
                onSubmit={(val) => {
                  void continueInteractive(val.trim());
                }}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Interactive: confirm before updating index */}
      {step === "interactive-confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="single" borderColor="green" paddingX={1}>
            <Text>{interactivePrompt}</Text>
          </Box>
          <Box marginTop={1}>
            <Text bold>
              Anything to add or change before I update the index?{" "}
            </Text>
            <Text color="gray">(Enter to confirm / n to skip)</Text>
          </Box>
        </Box>
      )}

      {step === "done" && !currentFile && (
        <Box marginTop={1} flexDirection="column">
          {(() => {
            const succeeded = results.filter((r) => r.status === "done").length;
            const failed = results.filter((r) => r.status === "error").length;
            return (
              <Text color={failed > 0 ? "red" : "green"} bold>
                {failed > 0 ? "✗" : "✓"} Ingest complete — {succeeded}{" "}
                succeeded, {failed} failed
              </Text>
            );
          })()}
          <Box marginTop={1}>
            <Text color="gray">Press Enter to continue</Text>
          </Box>
        </Box>
      )}

      {step === "idle" && !currentFile && results.length === 0 && (
        <Box marginTop={1}>
          <Text color="gray">Starting...</Text>
        </Box>
      )}
    </Box>
  );
}

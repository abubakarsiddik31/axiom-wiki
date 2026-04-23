import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import path from "path";
import fs from "fs";

import { getConfig } from "../../config/index.js";
import { createAxiomAgent } from "../../agent/index.js";
import { INTERACTIVE_INGEST_PREFIX } from "../../agent/prompts.js";
import { SUPPORTED_EXTS, buildIngestMessage, contextLimitMessage, checkFileSize, checkContextBudget, ConversionError } from "../../core/files.js";
import { clipUrl } from "../../core/clip.js";
import type { CoreMessage } from "../../agent/types.js";
import { updateIndex, updateMOC, appendLog, snapshotWiki, diffWiki } from "../../core/wiki.js";
import { indexWikiPage, persistOrama } from "../../core/indexing.js";
import { getIngestedFromLog } from "../../core/sources.js";
import { calcCost, appendUsageLog } from "../../core/usage.js";
import { loadIgnorePatterns } from "../../core/watcher.js";
import { loadState, saveState, detectChanges, recordIngest, migrateFromLog, statePath } from "../../core/state.js";
import { buildRecompilationPlan } from "../../core/compiler.js";
import { acquireLock, releaseLock, getLockInfo } from "../../core/lock.js";
import { withRetry, classifyError, friendlyErrorMessage } from "../../core/retry.js";
import ignore from "ignore";

const DEBUG = process.env['AXIOM_DEBUG'] === '1'
function debug(...args: unknown[]) {
  if (DEBUG) console.error('[ingest]', ...args)
}

interface Props {
  file?: string;
  interactive?: boolean;
  onExit?: () => void;
}

type Status = "running" | "done" | "error";
type IngestStep =
  | "idle"
  | "locked"
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
  errorReason?: 'context_limit' | 'conversion' | 'auth' | 'billing' | 'network' | 'unknown';
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
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
  const [lockMessage, setLockMessage] = useState("");
  const [planSummary, setPlanSummary] = useState<string | null>(null);
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
    const { wikiDir, rawDir } = config;
    debug('startIngest called', { provider: config.provider, model: config.model, wikiDir, rawDir, ollamaBaseUrl: config.ollamaBaseUrl });

    // Acquire compilation lock
    if (!acquireLock(wikiDir)) {
      const { info } = getLockInfo(wikiDir);
      setLockMessage(
        `Another ingest is running (PID ${info?.pid ?? '?'} since ${info?.acquiredAt ?? '?'})`
      );
      setStep("locked");
      return;
    }

    try {
      debug('creating agent...');
      const agent = createAxiomAgent(config);
      debug('agent created');
      const logPath = path.join(wikiDir, "wiki/log.md");

      // Resolve file list
      let filesToProcess: string[] = [];
      if (file) {
        // Strip surrounding quotes and unescape shell-escaped spaces/chars
        const cleaned = file
          .trim()
          .replace(/^["']|["']$/g, "") // remove surrounding " or '
          .replace(/\\(.)/g, "$1"); // unescape \<char> → <char>

        // URL detection: clip first, then ingest the saved file
        const isUrl = /^https?:\/\//i.test(cleaned);
        if (isUrl) {
          setCurrentFile(cleaned);
          setLiveLines([{ text: "⠸ Clipping URL…", color: "yellow" }]);
          setStep("running");
          try {
            const result = await clipUrl(cleaned, rawDir);
            setCurrentFile(result.filename);
            setLiveLines((prev) => [
              ...prev,
              { text: `✓ Saved: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`, color: "green" },
            ]);
            filesToProcess = [result.filepath];
          } catch (err) {
            addResult(
              cleaned,
              [{ text: `✗ ${err instanceof Error ? err.message : String(err)}`, color: "red" }],
              [],
              [],
              null,
              "error",
            );
            releaseLock(wikiDir);
            setStep("done");
            return;
          }
        } else {
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
            releaseLock(wikiDir);
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
            releaseLock(wikiDir);
            setStep("done");
            return;
          }
          filesToProcess = [abs];
        }
      } else {
        // Incremental compilation: use SHA-256 hash-based change detection
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

        // Load or migrate state for hash-based detection
        const stateFile = statePath(wikiDir);
        const state = fs.existsSync(stateFile)
          ? loadState(wikiDir)
          : migrateFromLog(wikiDir, rawDir);

        const changes = detectChanges(rawDir, allRaw, state);
        const plan = buildRecompilationPlan(state, changes);
        filesToProcess = [
          ...plan.directSources.map((c) => c.filepath),
          ...plan.additionalSources.map((f) => path.join(rawDir, f)),
        ];
        if (plan.affectedConcepts.length > 0) {
          setPlanSummary(plan.summary);
        }
        debug('file scan', { allRawCount: allRaw.length, allRaw, changesCount: changes.length, changes: changes.map(c => ({ file: c.filename, kind: c.kind })), toProcessCount: plan.directSources.length, additionalSources: plan.additionalSources, filesToProcess });

        if (filesToProcess.length === 0) {
          releaseLock(wikiDir);
          setStep("no-files");
          return;
        }
      }

      debug('processing', filesToProcess.length, 'files');
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
          releaseLock(wikiDir); // release while waiting for user input
          setStep("reingest-confirm");
          return;
        }

        // Interactive mode: first pass — get topics
        if (interactive) {
          const firstMessage = await buildIngestMessage(filepath, reingest, "", config);
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
          const firstResult = await withRetry(() => agent.generate([interactiveMsg]));
          releaseLock(wikiDir); // release while waiting for user input
          setInteractivePrompt(firstResult.text);
          setStep("interactive-reply");
          return;
        }

        setStep("running");
        const errorReason = await runIngest(agent, filepath, filename, reingest, "");
        // Abort entire batch on auth/billing (no point continuing)
        if (errorReason === 'auth' || errorReason === 'billing') break;
        // Other failures: continue to next file
      }

      releaseLock(wikiDir);
      setCurrentFile(null);
      setStep("done");
    } catch {
      releaseLock(wikiDir);
      setCurrentFile(null);
      setStep("done");
    }
  }

  async function continueAfterReingestConfirm() {
    if (!config || !currentFile) return;
    // Reacquire lock after user confirmed
    if (!acquireLock(config.wikiDir)) {
      const { info } = getLockInfo(config.wikiDir);
      setLockMessage(`Another ingest started while waiting (PID ${info?.pid ?? '?'})`);
      setStep("locked");
      return;
    }
    const agent = createAxiomAgent(config);
    const filepath = file && !isUrl(file)
      ? path.resolve(file)
      : path.join(config.rawDir, currentFile);
    setStep("running");
    await runIngest(agent, filepath, currentFile, true, "");
    releaseLock(config.wikiDir);
    setCurrentFile(null);
    setStep("done");
  }

  async function continueInteractive(userInput: string) {
    if (!config || !currentFile) return;
    // Reacquire lock after user provided input
    if (!acquireLock(config.wikiDir)) {
      const { info } = getLockInfo(config.wikiDir);
      setLockMessage(`Another ingest started while waiting (PID ${info?.pid ?? '?'})`);
      setStep("locked");
      return;
    }
    const agent = createAxiomAgent(config);
    const filepath = file && !isUrl(file)
      ? path.resolve(file)
      : path.join(config.rawDir, currentFile);

    setStep("running");

    const lines: Array<{ text: string; color?: string }> = [];

    try {
      const message = await buildIngestMessage(filepath, isReingest, userInput, config);
      const stepFinish = (step: any) => {
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
      };
      const result = await withRetry(() => agent.generate([message], { onStepFinish: stepFinish }));

      const pagesFound = extractPages(result.text ?? "");
      setCurrentPages(pagesFound);

      // Interactive confirm step
      setInteractivePrompt(
        `Created ${pagesFound.length} pages.\n${pagesFound
          .slice(0, 8)
          .map((p) => `  · ${p}`)
          .join("\n")}`,
      );
      releaseLock(config.wikiDir); // release while waiting for user confirm
      setStep("interactive-confirm");
    } catch (err: unknown) {
      const friendly = contextLimitMessage(err);
      lines.push({
        text: `✗ ${friendly ?? (err instanceof Error ? err.message : String(err))}`,
        color: "red",
      });
      releaseLock(config.wikiDir);
      addResult(currentFile!, lines, [], [], null, "error");
      setCurrentFile(null);
      setStep("done");
    }
  }

  async function finaliseInteractive() {
    if (!config || !currentFile) return;

    // Reacquire lock to finalise
    if (!acquireLock(config.wikiDir)) {
      const { info } = getLockInfo(config.wikiDir);
      setLockMessage(`Another ingest started while waiting (PID ${info?.pid ?? '?'})`);
      setStep("locked");
      return;
    }

    setStep("running");
    try {
      await updateIndex(config.wikiDir);
      await updateMOC(config.wikiDir);
      
      // Index new pages
      if (config.embeddings && config.embeddings.provider !== 'none') {
        setLiveLines((prev) => [...prev, { text: "⠸ Updating semantic index…", color: "yellow" }]);
        for (const p of currentPages) {
          try {
            await indexWikiPage(config, p);
          } catch (e) {
            // Silently fail indexing
          }
        }
        await persistOrama(config);
        setLiveLines((prev) => [...prev, { text: "✓ Semantic index updated", color: "green" }]);
      }

      await appendLog(config.wikiDir, currentFile, "ingest");

      // Record source state for incremental compilation
      const filepath = file && !isUrl(file)
        ? path.resolve(file)
        : path.join(config.rawDir, currentFile);
      const state = loadState(config.wikiDir);
      recordIngest(state, currentFile, filepath, currentPages);
      saveState(config.wikiDir, state);
    } catch {
      /* best effort */
    }

    releaseLock(config.wikiDir);
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
  ): Promise<FileResult['errorReason'] | undefined> {
    if (!config) return 'unknown';
    debug('runIngest', { filepath, filename, reingest });
    const lines: Array<{ text: string; color?: string }> = [];
    const before = snapshotWiki(config.wikiDir);

    // Pre-flight: file size check
    try {
      const sizeCheck = checkFileSize(filepath);
      if (!sizeCheck.ok) {
        lines.push({ text: `✗ ${sizeCheck.warning}`, color: "red" });
        addResult(filename, lines, [], [], null, "error", 'context_limit');
        return 'context_limit';
      }
      if (sizeCheck.warning) {
        lines.push({ text: `⚠ ${sizeCheck.warning}`, color: "yellow" });
        setLiveLines((prev) => [...prev, { text: `⚠ ${sizeCheck.warning}`, color: "yellow" }]);
      }
    } catch {
      // stat failed — let buildIngestMessage handle it
    }

    // Pre-flight: context budget check (for text files we can estimate)
    try {
      const ext = filepath.split('.').pop()?.toLowerCase() ?? '';
      if (['md', 'txt', 'html', 'docx'].includes(ext)) {
        const sizeBytes = fs.statSync(filepath).size;
        // Rough estimate for text files
        const estimatedTokens = Math.ceil(sizeBytes / 3.5);
        const { getContextWindow } = await import("../../config/models.js");
        const contextWindow = getContextWindow(config.provider, config.model);
        const overhead = 8_000;
        if (estimatedTokens + overhead > contextWindow * 0.95) {
          const msg = `File is ~${(estimatedTokens / 1000).toFixed(0)}K tokens, model context is ${(contextWindow / 1000).toFixed(0)}K. Try a model with a larger context window.`;
          lines.push({ text: `✗ ${msg}`, color: "red" });
          addResult(filename, lines, [], [], null, "error", 'context_limit');
          return 'context_limit';
        }
      }
    } catch {
      // estimation failed — proceed and let LLM reject if needed
    }

    try {
      const message = await buildIngestMessage(filepath, reingest, userContext, config);
      const stepFinish = (step: any) => {
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
      };
      debug('calling LLM for', filename);
      const result = await withRetry(() => agent.generate([message], { onStepFinish: stepFinish }));
      debug('LLM result text length:', result.text?.length, 'usage:', (result as any).usage);

      // Extract pages from agent's final text
      const pagesFound = extractPages(result.text ?? "");
      setCurrentPages(pagesFound);

      // Always write index + log + moc ourselves — don't rely on the agent
      await updateIndex(config.wikiDir);
      await updateMOC(config.wikiDir);

      // Index new pages (redundant if agent used write_page tool, but good for safety)
      if (config.embeddings && config.embeddings.provider !== 'none') {
        setLiveLines((prev) => [...prev, { text: "⠸ Updating semantic index…", color: "yellow" }]);
        for (const p of pagesFound) {
          try {
            await indexWikiPage(config, p);
          } catch (e) {
            // Silently fail indexing
          }
        }
        await persistOrama(config);
        setLiveLines((prev) => [...prev, { text: "✓ Semantic index updated", color: "green" }]);
      }

      await appendLog(config.wikiDir, filename, "ingest");

      // Record source state for incremental compilation
      const state = loadState(config.wikiDir);
      recordIngest(state, filename, filepath, pagesFound);
      saveState(config.wikiDir, state);

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
      return undefined; // success
    } catch (err: unknown) {
      debug('runIngest error:', err);
      const changes = diffWiki(before, config.wikiDir);
      const errorClass = classifyError(err);

      // Use friendly message for known error classes, raw message otherwise
      let errorMsg: string;
      if (err instanceof ConversionError) {
        errorMsg = err.message;
      } else if (errorClass !== 'unknown') {
        errorMsg = friendlyErrorMessage(errorClass);
      } else {
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      lines.push({ text: `✗ ${errorMsg}`, color: "red" });

      const reason: FileResult['errorReason'] =
        err instanceof ConversionError ? 'conversion'
        : errorClass === 'context_limit' ? 'context_limit'
        : errorClass === 'auth' ? 'auth'
        : errorClass === 'billing' ? 'billing'
        : errorClass === 'transient' ? 'network'
        : 'unknown';

      addResult(filename, lines, [], changes, null, "error", reason);
      return reason;
    }
  }

  function addResult(
    filename: string,
    lines: FileResult["lines"],
    pagesCreated: string[],
    changes: FileResult["changes"],
    usage: FileResult["usage"],
    status: Status,
    errorReason?: FileResult['errorReason'],
  ) {
    setResults((prev) => [
      ...prev,
      { filename, lines, pagesCreated, changes, usage, status, errorReason },
    ]);
  }

  useInput((input, key) => {
    if (key.escape) {
      if (config) releaseLock(config.wikiDir);
      doExit();
      return;
    }
    if (step === "reingest-confirm") {
      if (input === "y" || input === "Y" || key.return)
        void continueAfterReingestConfirm();
      if (input === "n" || input === "N") {
        // Lock already released before entering user-input step
        setCurrentFile(null);
        setStep("done");
      }
    }
    if (step === "interactive-confirm") {
      if (input === "y" || input === "Y" || key.return)
        void finaliseInteractive();
      if (input === "n" || input === "N") {
        // Lock already released before entering user-input step
        setCurrentFile(null);
        setStep("done");
      }
    }
    if ((step === "done" || step === "no-files" || step === "locked") && key.return) {
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

  if (step === "locked") {
    return (
      <Box padding={1} flexDirection="column">
        <Text color="red" bold>
          ✗ Compilation locked
        </Text>
        <Box marginTop={1}>
          <Text color="yellow">{lockMessage}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press Enter to go back
          </Text>
        </Box>
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

      {/* Recompilation plan summary */}
      {planSummary && (
        <Text color="yellow" dimColor>{planSummary}</Text>
      )}

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
            const hasContextLimit = results.some((r) => r.errorReason === 'context_limit');
            const hasConversion = results.some((r) => r.errorReason === 'conversion');
            const hasAuth = results.some((r) => r.errorReason === 'auth' || r.errorReason === 'billing');
            return (
              <Box flexDirection="column">
                <Text color={failed > 0 ? "red" : "green"} bold>
                  {failed > 0 ? "✗" : "✓"} Ingest complete — {succeeded}{" "}
                  succeeded, {failed} failed
                </Text>
                {hasContextLimit && (
                  <Text color="yellow" dimColor>
                    Tip: Try <Text color="cyan">axiom-wiki model</Text> to switch to a model with a larger context window.
                  </Text>
                )}
                {hasConversion && (
                  <Text color="yellow" dimColor>
                    Tip: Some files failed to convert. Check if they are corrupted or password-protected.
                  </Text>
                )}
                {hasAuth && (
                  <Text color="yellow" dimColor>
                    Tip: Check your API key with <Text color="cyan">axiom-wiki model</Text>.
                  </Text>
                )}
              </Box>
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

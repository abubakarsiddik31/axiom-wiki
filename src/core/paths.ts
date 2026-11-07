import os from 'os'
import path from 'path'

/** Root for everything Axiom keeps outside the wiki itself (`~/.axiom` by default). */
export function axiomHome(): string {
  const override = process.env['AXIOM_HOME']?.trim()
  return override ? path.resolve(override) : path.join(os.homedir(), '.axiom')
}

export function axiomBinDir(): string {
  return path.join(axiomHome(), 'bin')
}

export function axiomCacheDir(...parts: string[]): string {
  return path.join(axiomHome(), 'cache', ...parts)
}

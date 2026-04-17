import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

function findPackageJson(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('package.json not found')
}

const pkg = JSON.parse(fs.readFileSync(findPackageJson(), 'utf-8')) as { version: string }

export const VERSION = pkg.version

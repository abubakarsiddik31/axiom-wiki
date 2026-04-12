import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { acquireLock, releaseLock, getLockInfo, forceReleaseLock } from '../../src/core/lock.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-lock-test-'));
}

describe('compilation lock', () => {
  let wikiDir: string;

  beforeEach(() => {
    wikiDir = makeTmpDir();
    fs.mkdirSync(path.join(wikiDir, '.axiom'), { recursive: true });
  });

  afterEach(() => {
    // Always clean up lock before removing dir
    try { releaseLock(wikiDir); } catch { /* */ }
    fs.rmSync(wikiDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('acquires lock when no lock exists', () => {
      expect(acquireLock(wikiDir)).toBe(true);
    });

    it('allows re-acquiring lock by same process', () => {
      expect(acquireLock(wikiDir)).toBe(true);
      expect(acquireLock(wikiDir)).toBe(true);
    });

    it('creates lock file with PID', () => {
      acquireLock(wikiDir);
      const lockFile = path.join(wikiDir, '.axiom/lock');
      expect(fs.existsSync(lockFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      expect(data.pid).toBe(process.pid);
      expect(data.acquiredAt).toBeTruthy();
    });

    it('reclaims stale lock from dead process', () => {
      // Write a lock file with a PID that definitely doesn't exist
      const lockFile = path.join(wikiDir, '.axiom/lock');
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, acquiredAt: '2024-01-01T00:00:00Z' }));

      expect(acquireLock(wikiDir)).toBe(true);

      const data = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      expect(data.pid).toBe(process.pid);
    });

    it('creates .axiom directory if missing', () => {
      const freshDir = makeTmpDir();
      expect(acquireLock(freshDir)).toBe(true);
      expect(fs.existsSync(path.join(freshDir, '.axiom/lock'))).toBe(true);
      fs.rmSync(freshDir, { recursive: true, force: true });
    });
  });

  describe('releaseLock', () => {
    it('removes lock file', () => {
      acquireLock(wikiDir);
      releaseLock(wikiDir);

      const lockFile = path.join(wikiDir, '.axiom/lock');
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('does nothing when no lock exists', () => {
      expect(() => releaseLock(wikiDir)).not.toThrow();
    });

    it('does not release lock held by another PID', () => {
      const lockFile = path.join(wikiDir, '.axiom/lock');
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, acquiredAt: '2024-01-01' }));

      releaseLock(wikiDir);

      // Lock should still exist (not our PID)
      expect(fs.existsSync(lockFile)).toBe(true);
    });
  });

  describe('getLockInfo', () => {
    it('returns not locked when no lock file', () => {
      const info = getLockInfo(wikiDir);
      expect(info.locked).toBe(false);
      expect(info.info).toBeNull();
      expect(info.stale).toBe(false);
    });

    it('returns locked for current process', () => {
      acquireLock(wikiDir);
      const info = getLockInfo(wikiDir);
      expect(info.locked).toBe(true);
      expect(info.info?.pid).toBe(process.pid);
      expect(info.stale).toBe(false);
    });

    it('detects stale lock from dead PID', () => {
      const lockFile = path.join(wikiDir, '.axiom/lock');
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, acquiredAt: '2024-01-01' }));

      const info = getLockInfo(wikiDir);
      expect(info.locked).toBe(false);
      expect(info.stale).toBe(true);
      expect(info.info?.pid).toBe(999999);
    });
  });

  describe('forceReleaseLock', () => {
    it('removes any lock regardless of PID', () => {
      const lockFile = path.join(wikiDir, '.axiom/lock');
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, acquiredAt: '2024-01-01' }));

      forceReleaseLock(wikiDir);
      expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('does nothing when no lock exists', () => {
      expect(() => forceReleaseLock(wikiDir)).not.toThrow();
    });
  });
});

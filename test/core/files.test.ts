import { describe, it, expect } from 'vitest';
import { contextLimitMessage } from '../../src/core/files.js';

describe('files core', () => {
  describe('contextLimitMessage', () => {
    it('returns friendly message for token count error', () => {
      const err = new Error('Error: 400 The model token count exceeds the limit');
      expect(contextLimitMessage(err)).toContain('File too large');
    });

    it('returns friendly message for context length error', () => {
      const err = 'context length exceeded';
      expect(contextLimitMessage(err)).toContain('File too large');
    });

    it('returns null for unrelated errors', () => {
      const err = new Error('Network error');
      expect(contextLimitMessage(err)).toBeNull();
    });
  });
});

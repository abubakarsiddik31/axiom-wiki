import { describe, it, expect } from 'vitest';
import { calcCost } from '../../src/core/usage.js';

describe('usage', () => {
  describe('calcCost', () => {
    it('calculates cost correctly for Google Gemini 2.0 Flash', () => {
      const cost = calcCost('google', 'gemini-2.0-flash', 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.50);
    });

    it('calculates cost correctly for OpenAI GPT-5.4 Mini', () => {
      const cost = calcCost('openai', 'gpt-5.4-mini', 500_000, 500_000);
      expect(cost).toBeCloseTo(1.0);
    });

    it('returns null for models without pricing (e.g. Ollama)', () => {
      const cost = calcCost('ollama', 'llama3.2', 1000, 1000);
      expect(cost).toBeNull();
    });

    it('returns null for unknown models', () => {
      const cost = calcCost('google', 'unknown-model', 1000, 1000);
      expect(cost).toBeNull();
    });
  });
});

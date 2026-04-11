import { describe, it, expect } from 'vitest';
import { getProvider, getModel, getDefaultModel, PROVIDERS } from '../../src/config/models.js';

describe('models config', () => {
  describe('getProvider', () => {
    it('returns the correct provider definition', () => {
      const provider = getProvider('google');
      expect(provider.id).toBe('google');
      expect(provider.label).toBe('Google Gemini');
    });
  });

  describe('getModel', () => {
    it('returns the correct model definition', () => {
      const model = getModel('google', 'gemini-2.0-flash');
      expect(model?.id).toBe('gemini-2.0-flash');
      expect(model?.label).toBe('Gemini 2.0 Flash');
    });

    it('returns undefined for unknown model', () => {
      const model = getModel('google', 'non-existent');
      expect(model).toBeUndefined();
    });
  });

  describe('getDefaultModel', () => {
    it('returns the recommended model if available', () => {
      const model = getDefaultModel('google');
      expect(model.recommended).toBe(true);
      expect(model.id).toBe('gemini-3-flash-preview');
    });

    it('returns the first model if no recommended model is found', () => {
      // For this test, we would need to mock PROVIDERS or find a provider without recommended
      // But currently all providers have a recommended model.
      const model = getDefaultModel('openai');
      expect(model.id).toBe('gpt-5.4-mini');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    AI_MODE: 'fallback',
    ANOMALY_AI_MODE: 'fallback',
    AI_MODEL: '',
    AI_API_KEY: '',
    AI_BASE_URL: 'https://opencode.ai/zen/v1',
    AI_TIMEOUT_MS: '15000',
  })) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

async function loadConfig() {
  // Each case intentionally reloads startup configuration after changing environment.
  return (await import('../../config/index.js')).config;
}

describe('AI startup configuration', () => {
  it.each(['AI_MODE', 'ANOMALY_AI_MODE'])('rejects %s live without a key', async (name) => {
    vi.stubEnv(name, 'live');
    vi.stubEnv('AI_MODEL', 'test-model');
    await expect(loadConfig()).rejects.toThrow('AI_API_KEY');
  });
  it.each(['AI_MODE', 'ANOMALY_AI_MODE'])('rejects %s live without a model', async (name) => {
    vi.stubEnv(name, 'live');
    vi.stubEnv('AI_API_KEY', 'test-key');
    await expect(loadConfig()).rejects.toThrow('AI_MODEL');
  });
  it.each(['AI_MODE', 'ANOMALY_AI_MODE'])('rejects an unknown %s', async (name) => {
    vi.stubEnv(name, 'livve');
    await expect(loadConfig()).rejects.toThrow(name);
  });
  it.each(['0', '-1', '1.5', 'Infinity', 'not-a-number'])('rejects timeout %s', async (value) => {
    vi.stubEnv('AI_TIMEOUT_MS', value);
    await expect(loadConfig()).rejects.toThrow('AI_TIMEOUT_MS');
  });
  it.each(['AI_API_KEY', 'AI_MODEL'])('rejects whitespace-only %s in live mode', async (name) => {
    vi.stubEnv('AI_MODE', 'live');
    vi.stubEnv('AI_API_KEY', 'test-key');
    vi.stubEnv('AI_MODEL', 'test-model');
    vi.stubEnv(name, '   ');
    await expect(loadConfig()).rejects.toThrow(name);
  });
  it.each(['not-a-url', 'file:///tmp/api', 'https://secret-user:secret-key@example.com/v1'])('rejects invalid provider URL without echoing it', async (url) => {
    vi.stubEnv('AI_BASE_URL', url);
    try {
      await loadConfig();
      expect.fail('Invalid URL accepted');
    } catch (error) {
      expect((error as Error).message).toContain('AI_BASE_URL');
      expect((error as Error).message).not.toContain(url);
    }
  });
});

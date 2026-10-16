import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../config/index.js';
import { HttpAIProvider } from '../../providers/aiProvider.js';

const API_KEY = 'provider-test-secret-key';
const originalTimeoutMs = config.ai.timeoutMs;

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withLocalServer(handler: Handler, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local test server failed to start');

  try {
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

function pendingResponse() {
  let notifyRequestReceived!: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    notifyRequestReceived = resolve;
  });
  return {
    requestReceived,
    handler: (_request: IncomingMessage, _response: ServerResponse) => notifyRequestReceived(),
  };
}

function recordingLogger(logs: unknown[]) {
  return {
    child: () => ({
      warn: (...args: unknown[]) => logs.push(args),
    }),
  } as unknown as Logger;
}

function setTimeoutMs(timeoutMs: number) {
  Object.assign(config.ai, { timeoutMs });
}

beforeEach(() => setTimeoutMs(originalTimeoutMs));
afterEach(() => setTimeoutMs(originalTimeoutMs));

describe('HTTP AI provider request boundaries', () => {
  it('keeps its deadline active when the caller supplies a signal', async () => {
    setTimeoutMs(150);
    const hanging = pendingResponse();
    const caller = new AbortController();
    const result = withLocalServer(hanging.handler, async (baseUrl) => {
          const provider = new HttpAIProvider({ name: 'test', apiKey: API_KEY, baseUrl });
          const request = provider.chat([{ role: 'user', content: 'hello' }], {
            model: 'test-model',
            signal: caller.signal,
          });
          await expect(request).rejects.toHaveProperty('name', 'AbortError');
          expect(caller.signal.aborted).toBe(false);
        });

    await result;
  });

  it('cancels an in-flight request when the caller aborts', async () => {
    setTimeoutMs(5_000);
    const hanging = pendingResponse();
    const caller = new AbortController();
    await withLocalServer(hanging.handler, async (baseUrl) => {
          const provider = new HttpAIProvider({ name: 'test', apiKey: API_KEY, baseUrl });
          const request = provider.chat([{ role: 'user', content: 'hello' }], {
            model: 'test-model',
            signal: caller.signal,
          });
          await Promise.race([hanging.requestReceived, request]);
          caller.abort();
          await expect(request).rejects.toHaveProperty('name', 'AbortError');
        });
  });

  it.each([401, 429, 500])('bounds %i provider failures in errors and logs', async (status) => {
    const upstreamBody = `upstream private content ${API_KEY}`;
    const logs: unknown[] = [];
    let requests = 0;
    await withLocalServer((_request, response) => {
      requests += 1;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(upstreamBody);
    }, async (baseUrl) => {
      const provider = new HttpAIProvider({
        name: 'test',
        apiKey: API_KEY,
        baseUrl,
        logger: recordingLogger(logs),
      });
      let failure: Error | undefined;
      try {
        await provider.chat([{ role: 'user', content: 'hello' }], { model: 'test-model' });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).toBe(`AI provider returned ${status}`);
      expect(JSON.stringify({ error: failure?.message, logs })).not.toContain(upstreamBody);
      expect(JSON.stringify({ error: failure?.message, logs })).not.toContain(API_KEY);
      expect(requests).toBe(1);
    });
  });

  it('returns a bounded error for malformed provider JSON', async () => {
    const upstreamBody = `not-json ${API_KEY} private-response-fragment`;
    await withLocalServer((_request, response) => response.end(upstreamBody), async (baseUrl) => {
      const provider = new HttpAIProvider({ name: 'test', apiKey: API_KEY, baseUrl });
      let failure: Error | undefined;
      try {
        await provider.chat([{ role: 'user', content: 'hello' }], { model: 'test-model' });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).toBe('AI provider returned invalid JSON');
      expect(failure?.message).not.toContain(upstreamBody);
      expect(failure?.message).not.toContain(API_KEY);
    });
  });

  it.each([
    JSON.stringify({ choices: [{ message: { content: 42 } }], private: API_KEY }),
    'null',
  ])('rejects malformed chat-completion envelope %s without exposing it', async (upstreamBody) => {
    await withLocalServer((_request, response) => response.end(upstreamBody), async (baseUrl) => {
      const provider = new HttpAIProvider({ name: 'test', apiKey: API_KEY, baseUrl });
      let failure: Error | undefined;
      try {
        await provider.chat([{ role: 'user', content: 'hello' }], { model: 'test-model' });
      } catch (error) {
        failure = error as Error;
      }

      expect(failure?.message).toBe('AI provider returned empty content');
      expect(failure?.message).not.toContain(API_KEY);
    });
  });
});

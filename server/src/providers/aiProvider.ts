import type { Logger } from 'pino';
import { config } from '../config/index.js';
import { logger as rootLogger } from '../infrastructure/logger.js';

export interface AIProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIProviderOptions {
  model: string;
  temperature?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface AIProvider {
  readonly name: string;
  chat(messages: AIProviderMessage[], options: AIProviderOptions): Promise<string>;
}

export class HttpAIProvider implements AIProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(opts: { name: string; apiKey: string; baseUrl: string; logger?: Logger }) {
    this.name = opts.name;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.logger = (opts.logger ?? rootLogger).child({ provider: opts.name });
  }

  async chat(messages: AIProviderMessage[], options: AIProviderOptions): Promise<string> {
    if (!this.apiKey) throw new Error('AI provider is missing API key');
    const ctrl = new AbortController();
    const signal = options.signal ? AbortSignal.any([ctrl.signal, options.signal]) : ctrl.signal;
    const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: options.temperature ?? 0.4,
          messages,
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      });
      if (!res.ok) {
        // Provider error bodies may echo credentials or prompt fragments. Keep only bounded metadata.
        await res.body?.cancel();
        this.logger.warn({ status: res.status }, 'ai provider failed');
        throw new Error(`AI provider returned ${res.status}`);
      }
      let data: { choices?: { message?: { content?: string } }[] };
      try {
        data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('AI provider returned invalid JSON');
        throw error;
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('AI provider returned empty content');
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

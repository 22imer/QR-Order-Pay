import { z } from 'zod';
import type { AIProviderMessage } from '../providers/aiProvider.js';
import type { RecommendInput } from '../services/aiService.js';
import { BARISTA_SYSTEM_PROMPT } from './baristaSkill.js';

export interface BaristaContext {
  prompt: string;
  budget: number | null;
  preferences: NonNullable<RecommendInput['preferences']>;
  menu: Array<{
    id: string;
    name: string;
    description: string;
    basePrice: number;
    variants: Array<{ id: string | null; name: string; price: number }>;
    caffeine: boolean | null;
    dairy: boolean | null;
    flavorProfile: string[];
    tags: string[];
  }>;
}

const baristaResponseSchema = z.object({
  message: z.string(),
  recommendations: z.array(z.object({
    productId: z.string(),
    variantId: z.string().nullable().optional(),
    reason: z.string(),
  })).max(3),
  followUpQuestion: z.string().optional(),
});

export type BaristaModelResponse = z.infer<typeof baristaResponseSchema>;

export function beforeBaristaRequest(context: BaristaContext): AIProviderMessage[] {
  return [
    { role: 'system', content: BARISTA_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ];
}

export function afterBaristaResponse(raw: string): BaristaModelResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const object = /\{[\s\S]*\}/.exec(raw);
    if (!object) throw new Error('AI schema invalid');
    try {
      parsed = JSON.parse(object[0]);
    } catch {
      throw new Error('AI schema invalid');
    }
  }
  const validated = baristaResponseSchema.safeParse(parsed);
  if (!validated.success) throw new Error('AI schema invalid');
  return validated.data;
}

import { z } from 'zod';

export const GAME_MAX_PLAYERS = 12;
export const GAME_SPIN_MS = 4500;
export const GAME_START_DELAY_MS = 500;
export const GAME_LOBBY_MS = 10 * 60000;
export const GAME_COOLDOWN_MS = 5000;
export const gameNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'Tên không được có ký tự điều khiển.')
  .transform((value) => value.normalize('NFC').replace(/\s+/g, ' '));
export const gameCreateSchema = z
  .object({ requestId: z.string().uuid(), name: gameNameSchema })
  .strict();
export const gameCommandSchema = z
  .object({ requestId: z.string().uuid(), expectedVersion: z.number().int().nonnegative() })
  .strict();
export const gameJoinSchema = gameCommandSchema.extend({ name: gameNameSchema }).strict();
export const gameRemovePlayerSchema = gameCommandSchema
  .extend({ playerId: z.string().uuid() })
  .strict();
export type GamePhase = 'WAITING' | 'SPINNING' | 'FINISHED' | 'CANCELLED' | 'EXPIRED';
export interface GamePlayer {
  id: string;
  name: string;
  isYou: boolean;
  isHost: boolean;
  eligible: boolean;
  managedByHost?: boolean;
}
export interface GameRound {
  id: string;
  phase: GamePhase;
  version: number;
  players: GamePlayer[];
  isHost: boolean;
  canSpin: boolean;
  winnerId: string | null;
  spinStartsAt: number | null;
  revealsAt: number | null;
  expiresAt: number;
  createdAt: number;
}
export interface GameFeed {
  current: GameRound | null;
  history: GameRound[];
  serverNow: number;
  nextRoundAt: number;
  open: boolean;
}

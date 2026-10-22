import { z } from 'zod';

export const JUKEBOX_VOTES_PER_SESSION = 5;
export const JUKEBOX_LEASE_MS = 30000;
const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s));
export const jukeboxTrackSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    title: label,
    artist: label,
    audioUrl: z
      .string()
      .trim()
      .max(2048)
      .url()
      .refine((s) => {
        const u = new URL(s);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.hash &&
          /\.(mp3|ogg|wav|m4a|aac|opus)$/i.test(u.pathname)
        );
      }, 'Dùng URL HTTPS trực tiếp tới file mp3, ogg, wav, m4a, aac hoặc opus.'),
    enabled: z.boolean(),
  })
  .strict();
export const jukeboxVoteSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    trackId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .nullable(),
  })
  .strict();
export const jukeboxDeviceSchema = z.object({ deviceId: z.string().uuid() }).strict();
export const jukeboxControlSchema = jukeboxDeviceSchema
  .extend({
    requestId: z.string().uuid(),
    playbackVersion: z.number().int().nonnegative(),
  })
  .strict();
export interface JukeboxTrack {
  id: string;
  title: string;
  artist: string;
}
export interface JukeboxCatalogTrack extends JukeboxTrack {
  audioUrl: string;
  enabled: boolean;
  version: number;
}
export interface JukeboxFeed {
  tracks: JukeboxTrack[];
  queue: (JukeboxTrack & { votes: number })[];
  current: JukeboxTrack | null;
  playbackVersion: number;
  serverNow: number;
  vote: { trackId: string | null; version: number; remaining: number; canVote: boolean } | null;
}
export interface JukeboxStaffFeed extends JukeboxFeed {
  current: (JukeboxTrack & { audioUrl: string }) | null;
  lease: { owned: boolean; busy: boolean; until: number };
}

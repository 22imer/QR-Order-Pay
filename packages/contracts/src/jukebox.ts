import { z } from 'zod';

export const JUKEBOX_VOTES_PER_SESSION = 5;
export const JUKEBOX_LEASE_MS = 30000;
const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s));

export function jukeboxSource(
  value: string,
): { kind: 'youtube'; videoId: string } | { kind: 'audio' } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const youtube = [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtube-nocookie.com',
      'www.youtube-nocookie.com',
    ];
    if (host === 'youtu.be' || youtube.includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const id =
        host === 'youtu.be' && parts.length === 1
          ? parts[0]
          : url.pathname === '/watch'
            ? url.searchParams.get('v')
            : parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0]!)
              ? parts[1]
              : null;
      return id && /^[\w-]{11}$/.test(id) ? { kind: 'youtube', videoId: id } : null;
    }
    return !url.hash && /\.(mp3|ogg|wav|m4a|aac|opus)$/i.test(url.pathname)
      ? { kind: 'audio' }
      : null;
  } catch {
    return null;
  }
}
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
      .refine(
        (s) => jukeboxSource(s) !== null,
        'Dán link video YouTube (youtube.com hoặc youtu.be), hoặc link HTTPS trực tiếp tới file nhạc.',
      ),
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

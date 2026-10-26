import type { Request, Response, NextFunction } from 'express';
import * as jukebox from '../services/jukeboxService.js';
const handle =
  (work: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req) });
    } catch (error) {
      next(error);
    }
  };
export const feed = handle((req) => jukebox.jukeboxFeed(req.guest!));
export const vote = handle((req) => jukebox.voteJukebox(req.guest!, req.body));
export const catalog = handle(() => jukebox.jukeboxCatalog());
export const saveTrack = handle((req) =>
  jukebox.saveJukeboxTrack(
    req.user!.id,
    req.params['id'] ? String(req.params['id']) : null,
    req.body,
  ),
);
export const staffFeed = handle((req) => jukebox.staffJukeboxFeed(req.user!.id, req.query));
export const lease = (kind: 'claim' | 'heartbeat' | 'release') =>
  handle((req) => jukebox.leaseJukebox(req.user!.id, kind, req.body));
export const control = (kind: 'next' | 'stop' | 'play') =>
  handle((req) => jukebox.controlJukebox(req.user!.id, kind, req.body));

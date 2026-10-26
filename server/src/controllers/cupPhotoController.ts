import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import { AppError } from '../errors/AppError.js';
import { MEMBER_COOKIE, requireMember } from '../services/memberService.js';
import * as photos from '../services/cupPhotoService.js';
import { generateLatteArt } from '../services/latteArtService.js';
type Kind = 'guest' | 'member' | 'staff';
export const authorize =
  (kind: Kind): RequestHandler =>
  async (req, res, next) => {
    try {
      const actor: photos.PhotoActor =
        kind === 'guest'
          ? {
              owner: photos.photoOwner(req.guest!.tableSessionId, req.guest!.participantId),
              tableSessionId: req.guest!.tableSessionId,
            }
          : kind === 'staff'
            ? { owner: `counter:${req.user!.id}`, userId: req.user!.id }
            : { owner: `member:${(await requireMember(req.cookies?.[MEMBER_COOKIE])).id}` };
      res.locals.photoActor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
export const rawUpload: RequestHandler = (req, res, next) => {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(
      req.get('Content-Type')?.toLowerCase() ?? '',
    )
  )
    return next(new AppError('PHOTO_TYPE', 'Chỉ nhận ảnh JPEG, PNG hoặc WebP tĩnh.', 415));
  express.raw({ type: () => true, limit: 4 * 1024 * 1024 })(
    req,
    res,
    (error?: { status?: number }) =>
      next(error?.status === 413 ? new AppError('PHOTO_SIZE', 'Ảnh tối đa 4 MB.', 413) : error),
  );
};
const handle =
  (work: (req: Request, res: Response) => Promise<unknown>, image = false) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      const data = await work(req, res);
      if (image) {
        res.set('Content-Type', 'image/jpeg');
        res.set('Content-Disposition', 'inline; filename="cup-photo.jpg"');
        res.send(data);
      } else res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };
export const upload = handle((req, res) =>
  photos.uploadCupPhoto(
    res.locals.photoActor as photos.PhotoActor,
    req.get('Idempotency-Key'),
    Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    req.get('Content-Type')!.toLowerCase(),
  ),
);
export const own = handle(
  (req, res) => photos.ownCupPhoto(res.locals.photoActor as photos.PhotoActor, req.params['id']),
  true,
);
export const feed = handle((req) => photos.cupPrintFeed(req.query['page']));
export const image = handle(
  (req) => photos.staffCupPhoto(req.params['id'], req.params['index']),
  true,
);
export const print = handle((req) => photos.requestCupPrint(req.user!.id, req.body));
export const details = handle((req, res) =>
  photos.ownCupPhotoDetails(res.locals.photoActor as photos.PhotoActor, req.params['id']),
);
export const latteArt = handle((req, res) =>
  generateLatteArt(res.locals.photoActor as photos.PhotoActor, req.params['id'], req.body),
);
export async function exportLatteArt(req: Request, res: Response, next: NextFunction) {
  try {
    const output = await photos.exportCupLatteArt(req.user!.id, req.body);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${output.filename}"`);
    res.send(output.data);
  } catch (error) {
    next(error);
  }
}

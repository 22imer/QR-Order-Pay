import type { Request, Response, NextFunction } from 'express';
import {
  currentTableSessionResponseSchema,
  joinTableRequestSchema,
  joinTableResponseSchema,
  updateTableSessionStatusRequestSchema,
  transferTableSessionRequestSchema,
} from '@may-cafe/contracts';
import {
  joinAsGuest,
  listOpenSessions,
  openSession,
  transition,
  transferSession,
} from '../services/tableSessionService.js';
import {
  setGuestCookie,
  setReceiptCookie,
  clearGuestCookie,
  resolveReceiptGuest,
} from '../middlewares/guest.js';
import { listOpenServiceRequests } from '../services/serviceRequestService.js';
import { buildBill } from '../services/paymentService.js';
import { NotFoundError } from '../errors/AppError.js';
import { tableRepository } from '../repositories/tableRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { GUEST_COOKIE } from '../middlewares/guest.js';
import { sha256 } from '../utils/crypto.js';
import { RECEIPT_COOKIE } from '../middlewares/guest.js';
import { closeGuestSockets } from '../realtime/socket.js';
import { recordBusinessEvent } from '../infrastructure/metrics.js';
import { resolveAdmissionTable } from '../services/tableQrService.js';
import { MEMBER_COOKIE, logoutMember } from '../services/memberService.js';
import { config } from '../config/index.js';

async function clearTableMember(req: Request, res: Response) {
  if (typeof req.cookies?.[MEMBER_COOKIE] !== 'string') return;
  await logoutMember(req.cookies?.[MEMBER_COOKIE]);
  res.clearCookie(MEMBER_COOKIE, { domain: config.cookieDomain, path: '/' });
}

export async function join(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = joinTableRequestSchema.parse(req.body);
    if (req.guest) {
      const table = await resolveAdmissionTable(input.tableToken);
      const session = await tableSessionRepository.findById(req.guest.tableSessionId);
      if (table?.isActive && session && session.tableId.toString() === table.id) {
        res.json({
          success: true,
          data: joinTableResponseSchema.parse({
            guestSessionId: req.guest.id,
            participantId: req.guest.participantId,
            tableSessionId: session.id,
            created: false,
            table: { id: table.id, code: table.code, name: table.name, capacity: table.capacity },
            tableSession: { id: session.id, status: session.status, startedAt: session.startedAt },
          }),
        });
        return;
      }
    }
    const result = await joinAsGuest(input.tableToken);
    if (result.created) {
      recordBusinessEvent('table_session_created');
    }
    setGuestCookie(res, result.guestToken);
    setReceiptCookie(res, result.receiptToken);
    await clearTableMember(req, res);
    res.json({
      success: true,
      data: joinTableResponseSchema.parse({
        guestSessionId: result.guestId,
        participantId: result.participantId,
        tableSessionId: result.tableSession._id.toString(),
        created: result.created,
        table: {
          id: result.table._id.toString(),
          code: result.table.code,
          name: result.table.name,
          capacity: result.table.capacity,
        },
        tableSession: {
          id: result.tableSession._id.toString(),
          status: result.tableSession.status,
          startedAt: result.tableSession.startedAt,
        },
      }),
    });
  } catch (e) {
    next(e);
  }
}

export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.guest) {
      const receipt = await resolveReceiptGuest(req);
      res.json({
        success: true,
        data: currentTableSessionResponseSchema.parse({
          active: false,
          receiptAvailable: !!receipt,
        }),
      });
      return;
    }
    const session = await tableSessionRepository.findById(req.guest.tableSessionId);
    const table = session ? await tableRepository.findById(session.tableId.toString()) : null;
    res.json({
      success: true,
      data: currentTableSessionResponseSchema.parse({
        active: true,
        tableSessionId: req.guest.tableSessionId,
        participantId: req.guest.participantId,
        status: session?.status,
        table: table ? { id: table.id, code: table.code, name: table.name } : null,
      }),
    });
  } catch (e) {
    next(e);
  }
}

export async function leave(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[GUEST_COOKIE];
    if (typeof token === 'string') await guestSessionRepository.revokeByHash(sha256(token));
    const receipt = req.cookies?.[RECEIPT_COOKIE];
    if (typeof receipt === 'string')
      await guestSessionRepository.clearReceiptByHash(sha256(receipt));
    clearGuestCookie(res);
    await clearTableMember(req, res);
    if (req.guest) closeGuestSockets(req.guest.tableSessionId, req.guest.participantId);
    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
}

export async function staffTables(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tables = (await tableRepository.list()).map((t) => ({
      _id: t.id,
      code: t.code,
      name: t.name,
      capacity: t.capacity,
      isActive: t.isActive,
    }));
    res.json({ success: true, data: { tables } });
  } catch (e) {
    next(e);
  }
}

export async function staffList(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await listOpenSessions();
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}

export async function staffOpen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const tableId = String(req.params['tableId'] ?? '');
    if (!tableId) {
      res
        .status(422)
        .json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Thiếu tableId.' } });
      return;
    }
    const { session, created } = await openSession(tableId, req.user.id);
    if (created) recordBusinessEvent('table_session_created');
    res.json({ success: true, data: { session, created } });
  } catch (e) {
    next(e);
  }
}

export async function staffTransition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const id = String(req.params['id'] ?? '');
    const { status, expectedVersion } = updateTableSessionStatusRequestSchema.parse(req.body);
    const updated = await transition(id, expectedVersion, status, req.user.id);
    res.json({ success: true, data: { session: updated } });
  } catch (e) {
    next(e);
  }
}

export async function staffTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw new NotFoundError();
    const input = transferTableSessionRequestSchema.parse(req.body);
    const session = await transferSession(
      String(req.params['id'] ?? ''),
      input.targetTableId,
      input.expectedVersion,
      req.user.id,
    );
    res.json({ success: true, data: { session } });
  } catch (error) {
    next(error);
  }
}

export async function staffBill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params['id'] ?? '');
    const bill = await buildBill(id);
    res.json({ success: true, data: bill });
  } catch (e) {
    next(e);
  }
}

export async function staffServiceRequests(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const items = await listOpenServiceRequests();
    res.json({ success: true, data: { items } });
  } catch (e) {
    next(e);
  }
}

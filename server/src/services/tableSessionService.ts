import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableRepository } from '../repositories/tableRepository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { sha256, randomToken } from '../utils/crypto.js';
import { orderRepository } from '../repositories/orderRepository.js';
import type { TableSessionStatus } from '@may-cafe/contracts';
import { OrderModel } from '../models/Order.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ServiceRequestModel } from '../models/ServiceRequest.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { config } from '../config/index.js';
import { TableSessionModel, type TableSessionDoc } from '../models/TableSession.js';
import { outboxRepository } from '../repositories/outboxRepository.js';
import { verifyTableTicket } from './tableQrService.js';
import { finalizeSessionBill } from './paymentService.js';
import {
  assertWalkInAllowed,
  lockReservationTable,
  moveSessionReservation,
} from './reservationGuards.js';
import { assertGiftTransferAllowed } from './giftGuards.js';

/**
 * Single entry point for "this table must have a live session".
 * Guests are allowed in by auto-opening the session (idempotent); staff reuse/revert it.
 */
export async function ensureActiveSession(input: {
  tableId: string;
  actor: { type: 'STAFF' | 'GUEST'; id?: string | null };
}): Promise<{ session: TableSessionDoc; created: boolean }> {
  const active = await tableSessionRepository.findActiveByTable(input.tableId);
  if (active) {
    if (input.actor.type === 'STAFF' && active.status === 'CHECKOUT') {
      if (active.collectionExpiresAt && active.collectionExpiresAt.getTime() > Date.now())
        throw new ConflictError(
          'PAYMENT_CLAIMED',
          'Bàn đang được thu tiền, chưa thể mở lại phiên.',
        );
      const reverted = await unitOfWork.withTransaction(async (mongoSession) => {
        const result = await tableSessionRepository.updateStatus(
          active._id.toString(),
          active.version,
          {
            status: 'OPEN',
          },
          mongoSession,
        );
        if (!result) throw new ConflictError('CONFLICT', 'Phiên đang thay đổi, vui lòng thử lại.');
        await auditRepository.log(
          {
            actorType: 'USER',
            actorId: input.actor.id ?? null,
            action: 'tableSession.reopened',
            entityType: 'TableSession',
            entityId: result.id,
            metadata: { tableId: input.tableId, from: 'CHECKOUT', to: 'OPEN' },
          },
          mongoSession,
        );
        await createSessionStatusEvents(result, mongoSession);
        return result;
      });
      return { session: reverted, created: false };
    }
    return { session: active, created: false };
  }

  if (input.actor.type === 'GUEST' && !config.guestAutoOpen) {
    throw new ForbiddenError('Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên.');
  }

  try {
    const session = await unitOfWork.withTransaction(async (mongoSession) => {
      await lockReservationTable(input.tableId, mongoSession);
      await assertWalkInAllowed(input.tableId, mongoSession);
      const created = await tableSessionRepository.create(
        {
          tableId: input.tableId,
          openedBy: input.actor.id ?? null,
          source: input.actor.type,
        },
        mongoSession,
      );
      await auditRepository.log(
        {
          actorType: input.actor.type === 'GUEST' ? 'SYSTEM' : 'USER',
          actorId: input.actor.id ?? null,
          action: input.actor.type === 'GUEST' ? 'tableSession.autoOpened' : 'tableSession.opened',
          entityType: 'TableSession',
          entityId: created._id.toString(),
          metadata: { tableId: input.tableId, source: input.actor.type },
        },
        mongoSession,
      );
      await createSessionStatusEvents(created, mongoSession);
      return created;
    });
    return { session, created: true };
  } catch (e: unknown) {
    const mongoCode = e !== null && typeof e === 'object' && 'code' in e ? e.code : undefined;
    if (mongoCode === 11000 || e instanceof ConflictError) {
      const raced = await tableSessionRepository.findActiveByTable(input.tableId);
      if (raced) return { session: raced, created: false };
    }
    throw e;
  }
}

export async function openSession(tableId: string, openedBy: string) {
  const table = await tableRepository.findById(tableId);
  if (!table || !table.isActive) throw new NotFoundError('Bàn không khả dụng.');
  return ensureActiveSession({
    tableId: table._id.toString(),
    actor: { type: 'STAFF', id: openedBy },
  });
}

export async function transition(
  id: string,
  expectedVersion: number,
  next: TableSessionStatus,
  closedBy: string | null,
) {
  const session = await tableSessionRepository.findById(id);
  if (!session) throw new NotFoundError('Phiên không tồn tại.');
  const allowed = allowedTransitions(session.status);
  if (!allowed.includes(next)) {
    throw new ConflictError(
      'STATE_TRANSITION_INVALID',
      `Không thể chuyển phiên từ ${session.status} sang ${next}.`,
    );
  }
  const updated = await unitOfWork.withTransaction(async (mongoSession) => {
    // Updating the session serializes closing against new order creation.
    const update: Parameters<typeof tableSessionRepository.updateStatus>[2] =
      next === 'CLOSED'
        ? { status: next, closedBy, closedReason: 'STAFF' }
        : { status: next, closedBy };
    const result = await tableSessionRepository.updateStatus(
      id,
      expectedVersion,
      update,
      mongoSession,
    );
    if (!result) throw new ConflictError('CONFLICT', 'Phiên đã thay đổi, vui lòng tải lại.');
    if (result.collectionExpiresAt && result.collectionExpiresAt.getTime() > Date.now())
      throw new ConflictError(
        'PAYMENT_CLAIMED',
        'Bàn đang được thu tiền. Hãy kết thúc thao tác thu tiền trước khi đổi trạng thái phiên.',
      );
    if (next === 'CLOSED') {
      const unfinished = await OrderModel.exists({
        tableSessionId: id,
        status: { $nin: ['SERVED', 'CANCELLED'] },
      }).session(mongoSession);
      if (unfinished)
        throw new ForbiddenError('Cần phục vụ hoặc hủy các đơn còn lại trước khi đóng phiên.');
      const outstanding = await OrderModel.exists({
        tableSessionId: id,
        status: { $ne: 'CANCELLED' },
        paymentStatus: 'UNPAID',
      }).session(mongoSession);
      if (outstanding)
        throw new ForbiddenError('Cần xử lý và thanh toán hết đơn trước khi đóng phiên.');
      const bill = await finalizeSessionBill(result, closedBy, mongoSession);
      await TableSessionModel.updateOne(
        { _id: id },
        { $set: { billId: bill.id } },
        { session: mongoSession },
      );
      result.billId = bill._id;
      await tableRepository.invalidateQr(session.tableId.toString(), mongoSession);
      await guestSessionRepository.revokeByTableSession(id, mongoSession);
      await ServiceRequestModel.updateMany(
        { tableSessionId: id, status: 'OPEN' },
        { $set: { status: 'RESOLVED', resolvedBy: closedBy, resolvedAt: new Date() } },
        { session: mongoSession },
      );
    }
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId: closedBy,
        action: 'tableSession.transition',
        entityType: 'TableSession',
        entityId: id,
        metadata: { from: session.status, to: next },
      },
      mongoSession,
    );
    await createSessionStatusEvents(result, mongoSession, next === 'CLOSED');
    return result;
  });
  if (!updated)
    throw new ConflictError('CONFLICT', 'Phiên đã được cập nhật bởi người khác, vui lòng tải lại.');
  return updated;
}

async function createSessionStatusEvents(
  session: TableSessionDoc,
  mongoSession: import('mongoose').ClientSession,
  resolvedServiceRequests = false,
): Promise<void> {
  const tableSessionId = session.id;
  const payload = {
    tableSessionId,
    status: session.status,
    source: session.source,
    version: session.version,
  };
  const base = {
    aggregateType: 'TableSession',
    aggregateId: tableSessionId,
    aggregateVersion: session.version,
    payload,
  } as const;
  await outboxRepository.createRealtimeEvents(
    [
      { ...base, eventType: 'tableSession.statusChanged', target: { scope: 'staff' } },
      {
        ...base,
        eventType: 'tableSession.statusChanged',
        target: { scope: 'session', tableSessionId },
      },
      ...(resolvedServiceRequests
        ? [
            {
              ...base,
              eventType: 'serviceRequest.resolved' as const,
              target: { scope: 'staff' as const },
            },
          ]
        : []),
    ],
    mongoSession,
  );
}

function allowedTransitions(from: TableSessionStatus): TableSessionStatus[] {
  if (from === 'OPEN') return ['CHECKOUT', 'CLOSED'];
  if (from === 'CHECKOUT') return ['OPEN', 'CLOSED'];
  return [];
}

export async function joinAsGuest(tablePublicToken: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await unitOfWork.withTransaction(async (mongoSession) => {
        const ticket = verifyTableTicket(tablePublicToken);
        const table = await tableRepository.claimAdmission(
          ticket.tableId,
          ticket.epoch,
          mongoSession,
          ticket.fixed,
        );
        if (!table) throw new ForbiddenError('QR đã bị thu hồi. Vui lòng quét mã mới tại bàn.');
        let session = await tableSessionRepository.findActiveByTable(table.id, mongoSession);
        let sessionCreated = false;
        if (!session) {
          await assertWalkInAllowed(table.id, mongoSession);
          if (!config.guestAutoOpen)
            throw new ForbiddenError('Bàn chưa mở phiên phục vụ, vui lòng báo nhân viên.');
          session = await tableSessionRepository.create(
            { tableId: table.id, source: 'GUEST' },
            mongoSession,
          );
          sessionCreated = true;
          await auditRepository.log(
            {
              actorType: 'SYSTEM',
              action: 'tableSession.autoOpened',
              entityType: 'TableSession',
              entityId: session.id,
              metadata: { tableId: table.id, source: 'GUEST' },
            },
            mongoSession,
          );
          await createSessionStatusEvents(session, mongoSession);
        }
        if (session.status !== 'OPEN')
          throw new ForbiddenError('Bàn đang kết thúc phiên, vui lòng liên hệ nhân viên.');
        const guestToken = randomToken(32);
        const receiptToken = randomToken(32);
        const participantId = randomToken(8);
        const created = await guestSessionRepository.create(
          {
            tableSessionId: session.id,
            participantId,
            tokenHash: sha256(guestToken),
            receiptTokenHash: sha256(receiptToken),
            expiresAt: new Date(Date.now() + 12 * 60 * 60_000),
          },
          mongoSession,
        );
        return {
          guestToken,
          receiptToken,
          guestId: created.id,
          participantId,
          tableSession: session,
          table,
          created: sessionCreated,
        };
      });
    } catch (error) {
      if (
        ((error as { code?: number }).code === 11000 ||
          (error instanceof ConflictError && error.code === 'TABLE_SESSION_ALREADY_OPEN')) &&
        attempt < 3
      )
        continue;
      throw error;
    }
  }
}

export async function guestCanOrder(tableSessionId: string): Promise<void> {
  const session = await tableSessionRepository.findById(tableSessionId);
  if (!session) throw new NotFoundError();
  if (session.status === 'CLOSED')
    throw new ForbiddenError('Phiên đã kết thúc, vui lòng liên hệ nhân viên.');
  if (session.status === 'CHECKOUT')
    throw new ForbiddenError(
      'Phiên đang thanh toán, không thể thêm món mới. Vui lòng liên hệ nhân viên.',
    );
}

export async function listOpenSessions() {
  const sessions = await tableSessionRepository.listOpen();
  return Promise.all(
    sessions.map(async (session) => {
      const table = await tableRepository.findById(session.tableId.toString());
      const orderCount = await orderRepository.list({
        tableSessionId: session._id.toString(),
        limit: 1,
      });
      return { session, table, orderCount: orderCount.total };
    }),
  );
}

export async function transferSession(
  id: string,
  targetTableId: string,
  expectedVersion: number,
  actorId: string,
) {
  return unitOfWork.withTransaction(async (session) => {
    const [source, target] = await Promise.all([
      tableSessionRepository.findById(id, session),
      tableRepository.findById(targetTableId, session),
    ]);
    if (!source) throw new NotFoundError('Phiên không tồn tại.');
    if (source.collectionExpiresAt && source.collectionExpiresAt.getTime() > Date.now())
      throw new ConflictError('PAYMENT_CLAIMED', 'Bàn đang được thu tiền, chưa thể chuyển bàn.');
    if (!target?.isActive) throw new NotFoundError('Bàn đích không hoạt động.');
    if (source.status !== 'OPEN')
      throw new ConflictError('STATE_TRANSITION_INVALID', 'Chỉ chuyển được phiên đang mở.');
    if (source.version !== expectedVersion)
      throw new ConflictError('CONFLICT', 'Phiên vừa được cập nhật.');
    await assertGiftTransferAllowed(id, session);
    if (source.tableId.toString() === targetTableId)
      throw new ValidationError('Bàn đích phải khác bàn hiện tại.');
    if (await tableSessionRepository.findActiveByTable(targetTableId, session))
      throw new ConflictError('TABLE_SESSION_ALREADY_OPEN', 'Bàn đích đang có phiên phục vụ.');
    await lockReservationTable(targetTableId, session);
    await assertWalkInAllowed(targetTableId, session);
    await moveSessionReservation(id, targetTableId, session);
    let moved;
    try {
      moved = await TableSessionModel.findOneAndUpdate(
        { _id: id, status: 'OPEN', version: expectedVersion },
        {
          $set: { tableId: target._id },
          $inc: { version: 1 },
          $push: {
            tableTransfers: {
              fromTableId: source.tableId,
              toTableId: target._id,
              by: actorId,
              at: new Date(),
            },
          },
        },
        { new: true, session },
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictError('TABLE_SESSION_ALREADY_OPEN', 'Bàn đích vừa được sử dụng.');
      throw error;
    }
    if (!moved) throw new ConflictError('CONFLICT', 'Phiên vừa được cập nhật.');
    await tableRepository.invalidateQr(source.tableId.toString(), session);
    await tableRepository.invalidateQr(targetTableId, session);
    await OrderModel.updateMany(
      { tableSessionId: source._id },
      { $set: { tableId: target._id } },
      { session },
    );
    await auditRepository.log(
      {
        actorType: 'USER',
        actorId,
        action: 'tableSession.transferred',
        entityType: 'TableSession',
        entityId: id,
        metadata: { fromTableId: source.tableId.toString(), toTableId: targetTableId },
      },
      session,
    );
    await outboxRepository.createRealtimeEvents(
      [
        {
          eventType: 'tableSession.statusChanged',
          aggregateType: 'TableSession',
          aggregateId: id,
          aggregateVersion: moved.version,
          target: { scope: 'session', tableSessionId: id },
          payload: {
            tableSessionId: id,
            status: moved.status,
            tableId: targetTableId,
            tableName: target.name,
            version: moved.version,
          },
        },
        {
          eventType: 'tableSession.statusChanged',
          aggregateType: 'TableSession',
          aggregateId: id,
          aggregateVersion: moved.version,
          target: { scope: 'staff' },
          payload: {
            tableSessionId: id,
            status: moved.status,
            tableId: targetTableId,
            tableName: target.name,
            version: moved.version,
          },
        },
      ],
      session,
    );
    return moved;
  });
}

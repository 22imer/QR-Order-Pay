import type { ClientSession } from 'mongoose';
import { TableSessionModel, type TableSessionDoc } from '../models/TableSession.js';
import { ConflictError } from '../errors/AppError.js';
import { completeSessionReservation } from '../services/reservationGuards.js';

export interface ITableSessionRepository {
  findActiveByTable(
    tableId: string,
    session?: ClientSession | null,
  ): Promise<TableSessionDoc | null>;
  findById(id: string, session?: ClientSession | null): Promise<TableSessionDoc | null>;
  create(
    data: { tableId: string; openedBy?: string | null; source?: 'STAFF' | 'GUEST' },
    session?: ClientSession | null,
  ): Promise<TableSessionDoc>;
  updateStatus(
    id: string,
    expectedVersion: number,
    update: {
      status: 'OPEN' | 'CHECKOUT' | 'CLOSED';
      closedBy?: string | null;
      closedReason?: 'PAID' | 'STAFF' | 'IDLE' | null;
      billId?: string | null;
    },
    session?: ClientSession | null,
  ): Promise<TableSessionDoc | null>;
  listOpen(): Promise<TableSessionDoc[]>;
  listIdleCandidates(cutoff: Date): Promise<TableSessionDoc[]>;
}

export const tableSessionRepository: ITableSessionRepository = {
  async findActiveByTable(tableId, session) {
    return TableSessionModel.findOne({ tableId, status: { $in: ['OPEN', 'CHECKOUT'] } }, null, {
      session: session ?? undefined,
    });
  },
  async findById(id, session) {
    return TableSessionModel.findById(id, null, { session: session ?? undefined });
  },
  async create(data, session) {
    try {
      return await TableSessionModel.create(
        [
          {
            tableId: data.tableId,
            openedBy: data.openedBy ?? null,
            source: data.source ?? 'STAFF',
          },
        ],
        { session: session ?? undefined },
      ).then((d) => d[0]!);
    } catch (e: unknown) {
      const err = e as { code?: number };
      if (err.code === 11000) {
        throw new ConflictError(
          'TABLE_SESSION_ALREADY_OPEN',
          'Bàn này đang có phiên phục vụ, hãy đóng phiên cũ trước.',
        );
      }
      throw e;
    }
  },
  async updateStatus(id, expectedVersion, update, session) {
    const filter = { _id: id, version: expectedVersion };
    const options = { new: true, session: session ?? undefined };

    if (update.status === 'CLOSED') {
      const closed = await TableSessionModel.findOneAndUpdate(
        filter,
        {
          $set: {
            status: update.status,
            closedAt: new Date(),
            closedBy: update.closedBy ?? null,
            closedReason: update.closedReason ?? 'STAFF',
            ...(update.billId !== undefined ? { billId: update.billId } : {}),
          },
          $inc: { version: 1 },
        },
        options,
      );
      if (closed && session) await completeSessionReservation(id, session);
      return closed;
    }

    // Mở lại phiên (OPEN / CHECKOUT) phải sạch mọi dấu vết đã đóng trước đó.
    return TableSessionModel.findOneAndUpdate(
      filter,
      {
        $set: {
          status: update.status,
          closedBy: null,
          ...(update.billId !== undefined ? { billId: update.billId } : {}),
        },
        $unset: { closedAt: 1, closedReason: 1 },
        $inc: { version: 1 },
      },
      options,
    );
  },
  async listOpen() {
    return TableSessionModel.find({ status: { $in: ['OPEN', 'CHECKOUT'] } });
  },
  async listIdleCandidates(cutoff) {
    return TableSessionModel.find({ status: 'OPEN', source: 'GUEST', startedAt: { $lt: cutoff } });
  },
};

import type { ClientSession } from 'mongoose';
import { TableModel, type TableDoc } from '../models/Table.js';
import { ReservationModel } from '../models/Reservation.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError } from '../errors/AppError.js';

export interface ITableRepository {
  list(): Promise<TableDoc[]>;
  findById(id: string, session?: ClientSession | null): Promise<TableDoc | null>;
  findByCode(code: string): Promise<TableDoc | null>;
  findByPublicTokenHash(hash: string): Promise<TableDoc | null>;
  findByDisplayTokenHash(hash: string): Promise<TableDoc | null>;
  provisionDisplay(id: string, hash: string, session: ClientSession): Promise<TableDoc | null>;
  claimAdmission(
    id: string,
    epoch: number,
    session: ClientSession,
    fixed?: boolean,
  ): Promise<TableDoc | null>;
  invalidateQr(id: string, session: ClientSession): Promise<void>;
  create(data: {
    code: string;
    name: string;
    capacity: number;
    publicTokenHash: string;
  }): Promise<TableDoc>;
  update(
    id: string,
    update: Partial<{ name: string; capacity: number; isActive: boolean; publicTokenHash: string }>,
  ): Promise<TableDoc | null>;
}

export const tableRepository: ITableRepository = {
  async list() {
    return TableModel.find().sort({ code: 1 });
  },
  async findById(id, session) {
    return TableModel.findById(id, null, { session: session ?? undefined });
  },
  async findByCode(code) {
    return TableModel.findOne({ code });
  },
  async findByPublicTokenHash(hash) {
    return TableModel.findOne({ publicTokenHash: hash });
  },
  async findByDisplayTokenHash(hash) {
    return TableModel.findOne({ displayTokenHash: hash, isActive: true });
  },
  async provisionDisplay(id, hash, session) {
    return TableModel.findByIdAndUpdate(
      id,
      { $set: { displayTokenHash: hash }, $inc: { qrEpoch: 1, staticQrEpoch: 1 } },
      { new: true, session },
    );
  },
  async claimAdmission(id, epoch, session, fixed = false) {
    const field = fixed ? 'staticQrEpoch' : 'qrEpoch';
    return TableModel.findOneAndUpdate(
      {
        _id: id,
        isActive: true,
        $or: [{ [field]: epoch }, ...(epoch === 0 ? [{ [field]: { $exists: false } }] : [])],
      },
      { $inc: { admissionCount: 1 } },
      { new: true, session },
    );
  },
  async invalidateQr(id, session) {
    await TableModel.updateOne({ _id: id }, { $inc: { qrEpoch: 1 } }, { session });
  },
  async create(data) {
    return TableModel.create(data);
  },
  async update(id, update) {
    return unitOfWork.withTransaction(async (session) => {
      const table = await TableModel.findByIdAndUpdate(
        id,
        { $inc: { admissionCount: 1 } },
        { new: true, session },
      );
      if (!table) return null;
      if (update.isActive === false || update.capacity !== undefined) {
        const held = await ReservationModel.exists({
          tableId: id,
          $or: [
            { status: 'CONFIRMED', arrivalDeadline: { $gt: new Date() } },
            { status: 'CHECKED_IN' },
          ],
          ...(update.isActive === false ? {} : { partySize: { $gt: update.capacity! } }),
        }).session(session);
        if (held)
          throw new ConflictError(
            'TABLE_HAS_RESERVATIONS',
            'Bàn còn lịch đặt. Hãy xử lý lịch trước khi ngừng bàn hoặc giảm số chỗ.',
          );
      }
      return TableModel.findByIdAndUpdate(id, update, { new: true, session });
    });
  },
};

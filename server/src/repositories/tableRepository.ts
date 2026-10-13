import type { ClientSession } from 'mongoose';
import { TableModel, type TableDoc } from '../models/Table.js';

export interface ITableRepository {
  list(): Promise<TableDoc[]>;
  findById(id: string, session?: ClientSession | null): Promise<TableDoc | null>;
  findByCode(code: string): Promise<TableDoc | null>;
  findByPublicTokenHash(hash: string): Promise<TableDoc | null>;
  findByDisplayTokenHash(hash: string): Promise<TableDoc | null>;
  provisionDisplay(id: string, hash: string, session: ClientSession): Promise<TableDoc | null>;
  claimAdmission(id: string, epoch: number, session: ClientSession): Promise<TableDoc | null>;
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
      { $set: { displayTokenHash: hash }, $inc: { qrEpoch: 1 } },
      { new: true, session },
    );
  },
  async claimAdmission(id, epoch, session) {
    return TableModel.findOneAndUpdate(
      {
        _id: id,
        isActive: true,
        $or: [{ qrEpoch: epoch }, ...(epoch === 0 ? [{ qrEpoch: { $exists: false } }] : [])],
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
    return TableModel.findByIdAndUpdate(id, update, { new: true });
  },
};

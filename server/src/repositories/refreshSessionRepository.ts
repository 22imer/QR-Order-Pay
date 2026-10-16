import type { ClientSession } from 'mongoose';
import { RefreshSessionModel } from '../models/RefreshSession.js';

export interface IRefreshSessionRepository {
  create(data: {
    userId: string;
    tokenHash: string;
    authVersion?: number;
    expiresAt: Date;
    userAgent?: string;
    ip?: string;
    session?: ClientSession | null;
  }): Promise<{ id: string; tokenHash: string; expiresAt: Date }>;
  findByHash(
    tokenHash: string,
  ): Promise<{
    id: string;
    userId: string;
    authVersion: number;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null>;
  revokeByHash(tokenHash: string): Promise<boolean>;
  revokeAllForUser(userId: string, session?: ClientSession): Promise<number>;
}

export const refreshSessionRepository: IRefreshSessionRepository = {
  async create(data) {
    const doc = await RefreshSessionModel.create(
      [
        {
          userId: data.userId,
          tokenHash: data.tokenHash,
          authVersion: data.authVersion ?? 0,
          expiresAt: data.expiresAt,
          userAgent: data.userAgent ?? '',
          ip: data.ip ?? '',
        },
      ],
      { session: data.session ?? undefined },
    );
    const created = doc[0];
    if (!created) throw new Error('Failed to create refresh session');
    return {
      id: created._id.toString(),
      tokenHash: created.tokenHash,
      expiresAt: created.expiresAt,
    };
  },
  async findByHash(tokenHash) {
    const doc = await RefreshSessionModel.findOne({ tokenHash });
    if (!doc) return null;
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      authVersion: doc.authVersion ?? 0,
      expiresAt: doc.expiresAt,
      revokedAt: doc.revokedAt ?? null,
    };
  },
  async revokeByHash(tokenHash) {
    const r = await RefreshSessionModel.updateOne(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return r.modifiedCount > 0;
  },
  async revokeAllForUser(userId, session) {
    const r = await RefreshSessionModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { session },
    );
    return r.modifiedCount ?? 0;
  },
};

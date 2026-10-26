import crypto from 'node:crypto';
import { z } from 'zod';
import type { ClientSession } from 'mongoose';
import {
  GAME_MAX_PLAYERS,
  GAME_START_DELAY_MS,
  GAME_SPIN_MS,
  GAME_LOBBY_MS,
  GAME_COOLDOWN_MS,
  gameCreateSchema,
  gameCommandSchema,
  gameJoinSchema,
  gameRemovePlayerSchema,
  type GameRound,
  type GameFeed,
} from '@may-cafe/contracts';
import { MiniGameRoundModel, MiniGameActionModel, type MiniGameDoc } from '../models/MiniGame.js';
import { TableSessionModel } from '../models/TableSession.js';
import { GuestSessionModel } from '../models/GuestSession.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { outboxRepository } from '../repositories/outboxRepository.js';

export interface GameActor {
  tableSessionId: string;
  participantId: string;
}
const hash = (value: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const gameIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
async function lockSession(actor: GameActor, session: ClientSession) {
  const active = await TableSessionModel.findOneAndUpdate(
    { _id: actor.tableSessionId, status: 'OPEN' },
    { $inc: { version: 1 } },
    { session, new: true },
  );
  if (!active) throw new ForbiddenError('Chỉ chơi khi phiên bàn đang mở.');
}
async function eligiblePlayers(tableSessionId: string, session?: ClientSession) {
  const ids = await GuestSessionModel.distinct('participantId', {
    tableSessionId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).session(session ?? null);
  return new Set(ids.map(String));
}
async function changed(
  round: MiniGameDoc,
  action: string,
  actor: GameActor | null,
  session: ClientSession,
) {
  await auditRepository.log(
    {
      actorType: actor ? 'GUEST' : 'SYSTEM',
      participantId: actor?.participantId,
      action: `game.${action}`,
      entityType: 'MiniGameRound',
      entityId: round.id,
      metadata: { playerCount: round.players.length },
    },
    session,
  );
  await outboxRepository.createRealtimeEvents(
    [
      {
        eventType: 'game.changed',
        aggregateType: 'MiniGameRound',
        aggregateId: round.id,
        aggregateVersion: round.version,
        target: { scope: 'session', tableSessionId: String(round.tableSessionId) },
        payload: { refresh: true },
      },
    ],
    session,
  );
}
function view(
  round: MiniGameDoc,
  actor: GameActor,
  open: boolean,
  eligible: Set<string>,
  now = Date.now(),
): GameRound {
  const phase =
    round.status === 'DRAWN'
      ? now >= round.revealsAt!.getTime()
        ? 'FINISHED'
        : 'SPINNING'
      : round.status === 'EXPIRED'
        ? 'EXPIRED'
        : round.status === 'CANCELLED' || !open
          ? 'CANCELLED'
          : now >= round.expiresAt.getTime()
            ? 'EXPIRED'
            : 'WAITING';
  const players = round.players.map((p) => ({
    id: p.publicId,
    name: p.name,
    isYou: p.participantId === actor.participantId,
    isHost: p.participantId === round.hostParticipantId,
    eligible:
      round.status === 'DRAWN' ||
      eligible.has(p.managedByHost ? round.hostParticipantId : p.participantId),
    managedByHost: p.managedByHost,
  }));
  const isHost = actor.participantId === round.hostParticipantId;
  return {
    id: round.id,
    phase,
    version: round.version,
    players,
    isHost,
    canSpin: open && phase === 'WAITING' && isHost && players.filter((p) => p.eligible).length >= 2,
    winnerId: round.winnerId ?? null,
    spinStartsAt: round.spinStartsAt?.getTime() ?? null,
    revealsAt: round.revealsAt?.getTime() ?? null,
    expiresAt: round.expiresAt.getTime(),
    createdAt: round.createdAt.getTime(),
  };
}
async function oneView(round: MiniGameDoc, actor: GameActor) {
  const tableSession = await TableSessionModel.findById(actor.tableSessionId);
  return view(
    round,
    actor,
    tableSession?.status === 'OPEN',
    await eligiblePlayers(actor.tableSessionId),
  );
}
export async function gameFeed(actor: GameActor): Promise<GameFeed> {
  const tableSession = await TableSessionModel.findById(actor.tableSessionId);
  if (!tableSession || tableSession.status === 'CLOSED')
    throw new ForbiddenError('Phiên đã kết thúc.');
  const rounds = await MiniGameRoundModel.find({ tableSessionId: actor.tableSessionId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(11);
  const eligible = await eligiblePlayers(actor.tableSessionId),
    now = Date.now();
  const views = rounds.map((r) => view(r, actor, tableSession.status === 'OPEN', eligible, now));
  const lastDraw = await MiniGameRoundModel.findOne({
    tableSessionId: actor.tableSessionId,
    status: 'DRAWN',
  }).sort({ createdAt: -1, _id: -1 });
  return {
    current: views[0] ?? null,
    history: views.slice(1),
    serverNow: now,
    nextRoundAt: lastDraw?.revealsAt ? lastDraw.revealsAt.getTime() + GAME_COOLDOWN_MS : 0,
    open: tableSession.status === 'OPEN',
  };
}
export async function createGame(actor: GameActor, raw: unknown): Promise<GameRound> {
  const input = gameCreateSchema.parse(raw),
    requestHash = hash(input);
  const owner = {
    tableSessionId: actor.tableSessionId,
    hostParticipantId: actor.participantId,
    requestId: input.requestId,
  };
  const replay = async () => {
    const old = await MiniGameRoundModel.findOne(owner);
    if (old && old.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Yêu cầu đã dùng cho vòng khác.');
    return old ? oneView(old, actor) : null;
  };
  const old = await replay();
  if (old) return old;
  try {
    const round = await unitOfWork.withTransaction(async (session) => {
      await lockSession(actor, session);
      const now = Date.now();
      const waiting = await MiniGameRoundModel.findOne({
        tableSessionId: actor.tableSessionId,
        status: 'WAITING',
      }).session(session);
      if (waiting && waiting.expiresAt.getTime() > now)
        throw new ConflictError('GAME_ACTIVE', 'Bàn đang có vòng chờ tham gia.');
      if (waiting) {
        waiting.status = 'EXPIRED';
        waiting.version++;
        await waiting.save({ session });
        await changed(waiting, 'expired', null, session);
      }
      const drawn = await MiniGameRoundModel.findOne({
        tableSessionId: actor.tableSessionId,
        status: 'DRAWN',
      })
        .sort({ createdAt: -1, _id: -1 })
        .session(session);
      if (drawn?.revealsAt && drawn.revealsAt.getTime() + GAME_COOLDOWN_MS > now)
        throw new ConflictError(
          'GAME_COOLDOWN',
          'Chờ vòng quay kết thúc và nghỉ 5 giây trước vòng mới.',
        );
      if (
        (await MiniGameRoundModel.countDocuments({
          tableSessionId: actor.tableSessionId,
          createdAt: { $gt: new Date(now - 60000) },
        }).session(session)) >= 6
      )
        throw new ConflictError('GAME_LIMIT', 'Tối đa 6 vòng mới mỗi phút cho một bàn.');
      const [created] = await MiniGameRoundModel.create(
        [
          {
            ...owner,
            requestHash,
            expiresAt: new Date(now + GAME_LOBBY_MS),
            players: [
              {
                publicId: crypto.randomUUID(),
                participantId: actor.participantId,
                name: input.name,
              },
            ],
          },
        ],
        { session },
      );
      await changed(created!, 'created', actor, session);
      return created!;
    });
    return oneView(round, actor);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
}
export type GameAction = 'join' | 'leave' | 'spin' | 'cancel' | 'add-player' | 'remove-player';
export async function actOnGame(
  actor: GameActor,
  rawId: string,
  kind: GameAction,
  raw: unknown,
): Promise<GameRound> {
  const id = gameIdSchema.parse(rawId);
  const joinInput = kind === 'join' || kind === 'add-player' ? gameJoinSchema.parse(raw) : null;
  const removeInput = kind === 'remove-player' ? gameRemovePlayerSchema.parse(raw) : null;
  const input = joinInput ?? removeInput ?? gameCommandSchema.parse(raw);
  const requestHash = hash({ kind, ...input });
  const actionKey = {
    roundId: id,
    actorParticipantId: actor.participantId,
    requestId: input.requestId,
  };
  const scoped = (session?: ClientSession) =>
    MiniGameRoundModel.findOne({ _id: id, tableSessionId: actor.tableSessionId }).session(
      session ?? null,
    );
  const replay = async () => {
    const round = await scoped();
    if (!round) throw new NotFoundError('Vòng chơi không thuộc phiên bàn này.');
    const action = await MiniGameActionModel.findOne(actionKey);
    if (action && action.requestHash !== requestHash)
      throw new ConflictError('IDEMPOTENCY_CONFLICT', 'Yêu cầu đã dùng với thao tác khác.');
    return action ? oneView(round, actor) : null;
  };
  const old = await replay();
  if (old) return old;
  try {
    const round = await unitOfWork.withTransaction(async (session) => {
      await lockSession(actor, session);
      const current = await scoped(session);
      if (!current) throw new NotFoundError('Vòng không tồn tại.');
      if (current.version !== input.expectedVersion)
        throw new ConflictError('GAME_CHANGED', 'Danh sách vừa thay đổi. Vui lòng tải lại.');
      if (current.status !== 'WAITING' || current.expiresAt.getTime() <= Date.now())
        throw new ConflictError('GAME_NOT_WAITING', 'Vòng đã quay, bị hủy hoặc hết hạn.');
      const index = current.players.findIndex((p) => p.participantId === actor.participantId);
      const isHost = current.hostParticipantId === actor.participantId;
      if (kind === 'join' || kind === 'add-player') {
        const manual = kind === 'add-player';
        if (manual && !isHost) throw new ForbiddenError('Chỉ chủ vòng được thêm người chơi.');
        const name = joinInput!.name;
        if (
          current.players.some(
            (p) =>
              (manual || p.participantId !== actor.participantId) &&
              p.name.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi'),
          )
        )
          throw new ConflictError(
            'GAME_NAME_TAKEN',
            'Tên này đã có trong vòng. Hãy chọn tên khác.',
          );
        if (!manual && index >= 0) current.players[index]!.name = name;
        else {
          if (current.players.length >= GAME_MAX_PLAYERS)
            throw new ConflictError('GAME_FULL', 'Vòng đã đủ 12 người tham gia.');
          current.players.push({
            publicId: crypto.randomUUID(),
            participantId: manual ? `manual:${crypto.randomUUID()}` : actor.participantId,
            managedByHost: manual,
            name,
          });
        }
      } else if (kind === 'remove-player') {
        if (!isHost) throw new ForbiddenError('Chỉ chủ vòng được xóa tên đã thêm.');
        const target = current.players.findIndex(
          (p) => p.publicId === removeInput!.playerId && p.managedByHost,
        );
        if (target < 0) throw new NotFoundError('Không tìm thấy tên do chủ vòng thêm.');
        current.players.splice(target, 1);
      } else if (kind === 'leave') {
        if (isHost) throw new ForbiddenError('Người tạo hãy hủy vòng nếu muốn rời.');
        if (index < 0) throw new ConflictError('GAME_NOT_JOINED', 'Bạn chưa tham gia vòng này.');
        current.players.splice(index, 1);
      } else {
        if (!isHost) throw new ForbiddenError('Chỉ người tạo vòng được quay hoặc hủy.');
        if (kind === 'cancel') current.status = 'CANCELLED';
        else {
          const eligible = await eligiblePlayers(actor.tableSessionId, session);
          const roster = current.players.filter((p) =>
            eligible.has(p.managedByHost ? current.hostParticipantId : p.participantId),
          );
          if (roster.length < 2)
            throw new ConflictError(
              'GAME_NEEDS_PLAYERS',
              'Cần ít nhất 2 người tham gia còn hiệu lực.',
            );
          current.set('players', roster);
          current.winnerId = roster[crypto.randomInt(roster.length)]!.publicId;
          current.spinStartsAt = new Date(Date.now() + GAME_START_DELAY_MS);
          current.revealsAt = new Date(current.spinStartsAt.getTime() + GAME_SPIN_MS);
          current.status = 'DRAWN';
        }
      }
      current.version++;
      await current.save({ session });
      await MiniGameActionModel.create([{ ...actionKey, requestHash }], { session });
      await changed(current, kind, actor, session);
      return current;
    });
    return oneView(round, actor);
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
}

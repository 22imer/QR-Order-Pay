import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { config } from '../config/index.js';
import { logger } from '../infrastructure/logger.js';
import { sha256 } from '../utils/crypto.js';
import { guestSessionRepository } from '../repositories/guestSessionRepository.js';
import { tableSessionRepository } from '../repositories/tableSessionRepository.js';
import type { RealtimeEventEnvelope, Role } from '@may-cafe/contracts';
import { verifyAccessToken } from '../utils/crypto.js';
import { GUEST_COOKIE } from '../middlewares/guest.js';
import { UserModel } from '../models/User.js';
import { socketConnected, socketDisconnected } from '../infrastructure/metrics.js';
import { createAdapter } from '@socket.io/redis-adapter';
import { socketRedisClients } from '../infrastructure/redis.js';

interface ServerToClientEvents {
  'reservation.changed': (payload: RealtimeEventEnvelope) => void;
  'gift.changed': (payload: RealtimeEventEnvelope) => void;
  'game.changed': (payload: RealtimeEventEnvelope) => void;
  'jukebox.changed': (payload: RealtimeEventEnvelope) => void;
  'workforce.changed': (payload: RealtimeEventEnvelope) => void;
  'order.created': (payload: RealtimeEventEnvelope) => void;
  'order.statusChanged': (payload: RealtimeEventEnvelope) => void;
  'menu.availabilityChanged': (payload: RealtimeEventEnvelope) => void;
  'serviceRequest.created': (payload: RealtimeEventEnvelope) => void;
  'serviceRequest.resolved': (payload: RealtimeEventEnvelope) => void;
  'payment.confirmed': (payload: RealtimeEventEnvelope) => void;
  'tableSession.statusChanged': (payload: RealtimeEventEnvelope) => void;
  'cancelRequest.created': (payload: RealtimeEventEnvelope) => void;
  'cancelRequest.resolved': (payload: RealtimeEventEnvelope) => void;
}

let io: IOServer<Record<string, never>, ServerToClientEvents> | null = null;

export function getIO(): IOServer<Record<string, never>, ServerToClientEvents> | null {
  return io;
}

export function createSocketServer(
  httpServer: HttpServer,
): IOServer<Record<string, never>, ServerToClientEvents> {
  io = new IOServer(httpServer, {
    cors: { origin: config.allowedOrigins, credentials: true },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || config.allowedOrigins.includes(origin));
    },
  });
  const redis = socketRedisClients();
  if (redis) io.adapter(createAdapter(redis.publisher, redis.subscriber));

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.accessToken as string | undefined;
      const guestToken = socket.handshake.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${GUEST_COOKIE}=`))
        ?.slice(GUEST_COOKIE.length + 1);
      const role = socket.handshake.auth?.role as Role | undefined;
      if (role === 'STAFF' || role === 'ADMIN') {
        if (config.trafficClass === 'guest') return next(new Error('UNAUTHENTICATED'));
        if (!token) return next(new Error('UNAUTHENTICATED'));
        const payload = verifyAccessToken(token);
        const user = await UserModel.findById(payload.sub);
        if (
          !user?.isActive ||
          !['STAFF', 'ADMIN'].includes(user.role) ||
          user.role !== payload.role ||
          (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
        )
          return next(new Error('UNAUTHENTICATED'));
        (socket.data as { role?: string; userId?: string }).role = payload.role;
        (socket.data as { role?: string; userId?: string }).userId = payload.sub;
        return next();
      }
      if (guestToken) {
        if (config.trafficClass === 'internal') return next(new Error('UNAUTHENTICATED'));
        const hash = sha256(guestToken);
        const guest = await guestSessionRepository.findActiveByTokenHash(hash);
        if (!guest) return next(new Error('UNAUTHENTICATED'));
        const tableSession = await tableSessionRepository.findById(guest.tableSessionId);
        if (!tableSession || tableSession.status === 'CLOSED')
          return next(new Error('SESSION_CLOSED'));
        (
          socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }
        ).guestId = guest.id;
        (
          socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }
        ).tableSessionId = guest.tableSessionId;
        (
          socket.data as { guestId?: string; tableSessionId?: string; participantId?: string }
        ).participantId = guest.participantId;
        return next();
      }
      next(new Error('UNAUTHENTICATED'));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'socket auth failed');
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as {
      role?: string;
      userId?: string;
      guestId?: string;
      tableSessionId?: string;
      participantId?: string;
    };
    let authCheck: ReturnType<typeof setInterval> | undefined;
    if (data.role === 'ADMIN' || data.role === 'STAFF') {
      socket.join('staff');
      socket.join(`staff:${data.userId}`);
      socketConnected('staff');
      authCheck = setInterval(() => {
        void (async () => {
          try {
            const payload = verifyAccessToken(socket.handshake.auth.accessToken as string);
            const user = await UserModel.findById(data.userId);
            if (
              !user?.isActive ||
              user.role !== payload.role ||
              (user.authVersion ?? 0) !== (payload.authVersion ?? 0)
            )
              socket.disconnect(true);
          } catch {
            socket.disconnect(true);
          }
        })();
      }, 10_000);
      authCheck.unref();
    } else if (data.tableSessionId && data.participantId) {
      socket.join(`guest:${data.tableSessionId}:${data.participantId}`);
      socket.join(`session:${data.tableSessionId}`);
      socketConnected('guest');
    }
    socket.on('disconnect', () => {
      if (authCheck) clearInterval(authCheck);
      if (data.role === 'ADMIN' || data.role === 'STAFF') socketDisconnected('staff');
      else if (data.tableSessionId && data.participantId) socketDisconnected('guest');
    });
  });

  return io;
}

export function publishStaff(
  event: keyof ServerToClientEvents,
  payload: RealtimeEventEnvelope,
): void {
  io?.to('staff').emit(event, payload);
}

export function publishSession(
  tableSessionId: string,
  event: keyof ServerToClientEvents,
  payload: RealtimeEventEnvelope,
): void {
  io?.to(`session:${tableSessionId}`).emit(event, payload);
}

export function publishGuest(
  tableSessionId: string,
  participantId: string,
  event: keyof ServerToClientEvents,
  payload: RealtimeEventEnvelope,
): void {
  io?.to(`guest:${tableSessionId}:${participantId}`).emit(event, payload);
}

export function publishMenuChange(payload: RealtimeEventEnvelope): void {
  io?.emit('menu.availabilityChanged', payload);
}

export function publishAll(
  event: keyof ServerToClientEvents,
  payload: RealtimeEventEnvelope,
): void {
  io?.emit(event, payload);
}

export function closeSessionSockets(tableSessionId: string): void {
  io?.in(`session:${tableSessionId}`).disconnectSockets(true);
}

export function closeGuestSockets(tableSessionId: string, participantId: string): void {
  io?.in(`guest:${tableSessionId}:${participantId}`).disconnectSockets(true);
}

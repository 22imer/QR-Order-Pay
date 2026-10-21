import { realtimeEventEnvelopeSchema, type RealtimeEventEnvelope } from '@may-cafe/contracts';
import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef } from 'react';

let socket: Socket | null = null;
let identity = '';
const subscribers = new Set<{ event: string; handler: (payload: unknown) => void }>();
export class RealtimeEventGate {
  private readonly seenEventIds = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly entityVersions = new Map<string, number>();

  constructor(private readonly capacity = 1_000) {}

  accept(envelope: RealtimeEventEnvelope): boolean {
    if (this.seenEventIds.has(envelope.eventId)) return false;
    this.remember(envelope.eventId);
    const entityKey = `${envelope.eventType}:${envelope.entityId}`;
    const previous = this.entityVersions.get(entityKey);
    if (
      envelope.entityVersion > 0 &&
      previous !== undefined &&
      envelope.entityVersion <= previous
    )
      return false;
    if (envelope.entityVersion > 0)
      this.entityVersions.set(entityKey, envelope.entityVersion);
    return true;
  }

  resetVersions(): void {
    this.entityVersions.clear();
  }

  private remember(eventId: string): void {
    this.seenEventIds.add(eventId);
    this.seenOrder.push(eventId);
    if (this.seenOrder.length > this.capacity) {
      const oldest = this.seenOrder.shift();
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }
}

const eventGates = new Set<RealtimeEventGate>();

function connect(key: string, auth: Record<string, string>): Socket {
  if (socket && identity === key) return socket;
  disconnectSocket();
  identity = key;
  socket = io((import.meta.env.VITE_SOCKET_URL as string | undefined) ?? '/', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth,
    withCredentials: true,
  });
  for (const { event, handler } of subscribers) socket.on(event, handler);
  return socket;
}

export function connectStaffSocket(accessToken: string): Socket {
  return connect(`staff:${accessToken}`, { accessToken, role: 'STAFF' });
}

export function connectGuestSocket(participantId: string): Socket {
  return connect(`guest:${participantId}`, { role: 'GUEST' });
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  identity = '';
  for (const gate of eventGates) gate.resetVersions();
}

export function getSocket(): Socket | null {
  return socket;
}

/**
 * Event envelopes are deduplicated by eventId. Versions are compared only inside
 * the same event/entity pair; a gap is still delivered because consumers refetch
 * their authorised API snapshot instead of trying to reconstruct missed data.
 */
export function useSocketEvent(
  event: string,
  callback: (data?: unknown, envelope?: RealtimeEventEnvelope) => void,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    // Each subscriber must receive the event once. A shared gate lets the first
    // layout subscriber consume it before the page can refresh its own data.
    const gate = new RealtimeEventGate();
    eventGates.add(gate);
    const handler = (payload: unknown) => {
      const parsed = realtimeEventEnvelopeSchema.safeParse(payload);
      if (!parsed.success) {
        callbackRef.current(payload);
        return;
      }
      const envelope = parsed.data;
      if (!gate.accept(envelope)) return;
      callbackRef.current(envelope.data, envelope);
    };
    const entry = { event, handler };
    subscribers.add(entry);
    socket?.on(event, handler);
    return () => {
      eventGates.delete(gate);
      subscribers.delete(entry);
      socket?.off(event, handler);
    };
  }, [event]);
}

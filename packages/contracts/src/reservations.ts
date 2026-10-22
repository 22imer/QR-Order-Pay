import { z } from 'zod';

export const RESERVATION_MINUTES = 60;
export const RESERVATION_GRACE_MINUTES = 15;
const id = z.string().regex(/^[a-f\d]{24}$/i);
export const reservationSearchSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    partySize: z.coerce.number().int().min(1).max(30),
  })
  .strict();
export const reservationCreateSchema = z
  .object({
    requestId: z.string().uuid(),
    tableId: id,
    startsAt: z.string().datetime({ offset: true }),
    partySize: z.number().int().min(1).max(30),
    name: z.string().trim().min(1).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,24}$/, 'SĐT không hợp lệ.'),
    note: z.string().trim().max(280).default(''),
  })
  .strict();
export const reservationActionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(3).max(280).optional(),
  })
  .strict();
export type ReservationCreate = z.infer<typeof reservationCreateSchema>;
export type ReservationStatus = 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export interface Reservation {
  id: string;
  code: string;
  tableId: string;
  tableName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  arrivalDeadline: string;
  name: string;
  phone: string;
  note: string;
  status: ReservationStatus;
  version: number;
  tableSessionId: string | null;
  checkedInAt: string | null;
  closedAt: string | null;
  reason: string;
}
export interface ReservationAvailability {
  tables: Array<{ id: string; name: string; code: string; capacity: number }>;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  graceMinutes: number;
}

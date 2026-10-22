import { z } from 'zod';
import { handler } from './pickupController.js';
import * as reservations from '../services/reservationService.js';

export const availability = (staff: boolean) =>
  handler(staff, (req) => reservations.reservationAvailability(req.query));
export const list = (staff: boolean) =>
  handler(staff, (req, a) => reservations.listReservations(a, req.query));
export const create = (staff: boolean) =>
  handler(staff, (req, a) => reservations.createReservation(a, req.body));
export const action = (staff: boolean, kind: 'cancel' | 'check-in') =>
  handler(staff, (req, a) =>
    reservations.actOnReservation(
      a,
      z
        .string()
        .regex(/^[a-f\d]{24}$/i)
        .parse(req.params['id']),
      kind,
      req.body,
    ),
  );

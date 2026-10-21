import type { Request, Response, NextFunction } from 'express';
import * as workforce from '../services/workforceService.js';
import { previewWorkSchedule, copyWorkSchedule } from '../services/workforceCopyService.js';
import { workforceToCsv } from '../services/workforceReportsService.js';

type Handler = (req: Request) => Promise<unknown>;
const handle =
  (work: Handler) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await work(req) });
    } catch (error) {
      next(error);
    }
  };
const id = (req: Request) => String(req.params['id'] ?? '');
export const staffWeek = handle((req) => workforce.workforceWeek(req.user!.id, false, req.query));
export const adminWeek = handle((req) => workforce.workforceWeek(req.user!.id, true, req.query));
export const create = handle(async (req) => ({
  shift: await workforce.createWorkShift(req.user!.id, req.body),
}));
export const update = handle(async (req) => ({
  shift: await workforce.updateWorkShift(id(req), req.user!.id, req.body),
}));
export const cancel = handle(async (req) => ({
  shift: await workforce.cancelWorkShift(id(req), req.user!.id, req.body),
}));
export const clockIn = handle(async (req) => ({
  shift: await workforce.clockWorkShift(id(req), req.user!.id, 'in', req.body),
}));
export const clockOut = handle(async (req) => ({
  shift: await workforce.clockWorkShift(id(req), req.user!.id, 'out', req.body),
}));
export const correction = handle(async (req) => ({
  shift: await workforce.correctWorkAttendance(id(req), req.user!.id, req.body),
}));
export const policy = handle((req) => workforce.saveStaffingPolicy(req.user!.id, req.body));
export const copyPreview = handle((req) => previewWorkSchedule(req.user!.id, req.body));
export const copy = handle((req) => copyWorkSchedule(req.user!.id, req.body));
export const exportCsv =
  (admin: boolean) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const report = await workforce.workforceWeek(req.user!.id, admin, req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bang-cong-${report.from}.csv"`);
      res.send(workforceToCsv(report));
    } catch (error) {
      next(error);
    }
  };

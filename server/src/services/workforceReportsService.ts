import type { WorkforcePeaks, WorkforceCash, WorkforceWeek } from '@may-cafe/contracts';
import { OrderModel } from '../models/Order.js';
import { CashShiftModel } from '../models/CashShift.js';

export async function workforcePeaks(
  selectedStart: Date,
  now: Date,
  ordersPerStaffHour: number,
): Promise<WorkforcePeaks> {
  const today = new Date(
    `${new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)}T00:00:00+07:00`,
  );
  const until = new Date(Math.min(selectedStart.getTime(), today.getTime()));
  const from = new Date(until.getTime() - 28 * 86400000);
  const rows = await OrderModel.aggregate<{ _id: { day: number; hour: number }; count: number }>([
    {
      $match: {
        createdAt: { $gte: from, $lt: until },
        paymentStatus: 'PAID',
        status: { $ne: 'CANCELLED' },
      },
    },
    {
      $group: {
        _id: {
          day: { $isoDayOfWeek: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
          hour: { $hour: { date: '$createdAt', timezone: 'Asia/Ho_Chi_Minh' } },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const paidOrders = rows.reduce((n, r) => n + r.count, 0),
    minimumOrders = 20;
  return {
    from: from.toISOString(),
    until: until.toISOString(),
    weeks: 4,
    paidOrders,
    minimumOrders,
    ordersPerStaffHour,
    enoughData: paidOrders >= minimumOrders,
    items:
      paidOrders < minimumOrders
        ? []
        : rows
            .filter((r) => r.count >= 3)
            .sort((a, b) => b.count - a.count || a._id.day - b._id.day || a._id.hour - b._id.hour)
            .slice(0, 12)
            .map((r) => ({
              day: r._id.day,
              hour: r._id.hour,
              orders: r.count,
              occurrences: 4,
              averageOrders: Math.round((r.count / 4) * 100) / 100,
              recommendedStaff: Math.max(1, Math.ceil(r.count / 4 / ordersPerStaffHour)),
            })),
  };
}

export async function workforceCash(start: Date, end: Date): Promise<WorkforceCash> {
  const filter = {
    $or: [
      { openedAt: { $gte: start, $lt: end } },
      { closedAt: { $gte: start, $lt: end } },
      { status: 'OPEN' },
    ],
  };
  const [items, total, summary] = await Promise.all([
    CashShiftModel.find(filter).sort({ status: -1, openedAt: -1 }).limit(50).lean(),
    CashShiftModel.countDocuments(filter),
    CashShiftModel.aggregate<{ count: number; difference: number }>([
      { $match: { status: 'CLOSED', closedAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          difference: { $sum: { $ifNull: ['$difference', 0] } },
        },
      },
    ]),
  ]);
  return {
    total,
    closedCount: summary[0]?.count ?? 0,
    totalDifference: summary[0]?.difference ?? 0,
    items: items.map((s) => ({
      id: String(s._id),
      code: s.code,
      status: s.status as 'OPEN' | 'CLOSED',
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openedByName: s.openedByName,
      closedByName: s.closedByName,
      expectedCash: s.expectedCash ?? null,
      countedCash: s.countedCash ?? null,
      difference: s.difference ?? null,
      reconciliationNote: s.reconciliationNote ?? '',
    })),
  };
}

const csvCell = (value: string | number | null) => {
  const raw = value === null ? '' : String(value);
  let first = 0;
  while (first < raw.length && (raw.charCodeAt(first) <= 32 || raw[first]!.trim() === '')) first++;
  const safe = typeof value === 'string' && /^[=+@-]/.test(raw.slice(first)) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
const vnTime = (value: string | null) =>
  value
    ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
    : '';
export function workforceToCsv(data: WorkforceWeek): string {
  const rows: Array<Array<string | number | null>> = [
    ['Bảng công Fantastic cafe', data.from, 'Giờ Việt Nam UTC+7'],
    [
      'Giờ thực tế chỉ cộng ca đã chốt, cắt theo tuần; không tính lương. Số KDS là công đoạn, sao thuộc đơn đã giao.',
    ],
    ['Tổng hợp tuần'],
    [
      'Nhân viên',
      'Phút lịch',
      'Phút thực tế trong tuần',
      'Ca vắng',
      'Ca trễ',
      'Ca chưa ra',
      'Nhận',
      'Pha',
      'Sẵn sàng',
      'Giao',
      'Thao tác ngoài ca',
      'Pha TB (phút)',
      'Mẫu pha',
      'Sao đơn',
      'Đơn có đánh giá',
    ],
    ...data.metrics.map((m) => [
      m.staffName,
      m.scheduledMinutes,
      m.workedMinutes,
      m.absentShifts,
      m.lateShifts,
      m.openAttendances,
      m.confirmed,
      m.preparing,
      m.ready,
      m.served,
      m.outsideShiftActions,
      m.averagePreparationMinutes,
      m.preparationSamples,
      m.averageOrderRating,
      m.reviewedOrders,
    ]),
    [],
    ['Chi tiết ca bắt đầu/giao tuần (thời lượng cả ca, không cắt tuần)'],
    [
      'Mã ca',
      'Nhân viên',
      'Tên ca',
      'Bắt đầu lịch',
      'Kết thúc lịch',
      'Trạng thái',
      'Giờ bấm vào gốc',
      'Giờ bấm ra gốc',
      'Vào hiệu lực',
      'Ra hiệu lực',
      'Phút thực tế cả ca',
      'Phút trễ sau dung sai',
      'Lý do sửa',
      'Người sửa',
      'Lý do hủy',
      'Ghi chú',
    ],
    ...data.shifts.map((s) => [
      s.id,
      s.staffName,
      s.label,
      vnTime(s.startsAt),
      vnTime(s.endsAt),
      s.attendance,
      vnTime(s.clockInAt),
      vnTime(s.clockOutAt),
      vnTime(s.effectiveInAt),
      vnTime(s.effectiveOutAt),
      s.workedMinutes,
      s.lateMinutes,
      s.correctionReason,
      s.correctedByName,
      s.cancelReason,
      s.note,
    ]),
  ];
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}`;
}

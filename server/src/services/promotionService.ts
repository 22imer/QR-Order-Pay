import type { ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import {
  voucherCreateSchema,
  voucherUpdateSchema,
  voucherDtoSchema,
  benefitSelectionSchema,
  LOYALTY_RULES,
} from '@may-cafe/contracts';
import { VoucherModel, VoucherUseModel, type VoucherDoc } from '../models/Voucher.js';
import { MemberModel, PointEntryModel } from '../models/Member.js';
import type { OrderDoc } from '../models/Order.js';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '../errors/AppError.js';
import { auditRepository } from '../repositories/auditRepository.js';
import { unitOfWork } from '../infrastructure/unitOfWork.js';

export interface BenefitSelection {
  voucherCode?: string;
  redeemPoints?: number;
  memberId?: string | null;
}
export interface Benefits {
  subtotal: number;
  total: number;
  memberId: string | null;
  voucherId: string | null;
  voucherCode: string;
  voucherVersion: number;
  voucherDiscount: number;
  pointsDiscount: number;
  redeemedPoints: number;
  voucherAllowsPoints: boolean;
  maxRedeemPoints: number;
}
export function voucherDto(v: VoucherDoc) {
  return voucherDtoSchema.parse({
    ...v.toObject(),
    id: v.id,
    startsAt: v.startsAt.toISOString(),
    endsAt: v.endsAt.toISOString(),
  });
}
export async function listVouchers() {
  return { items: (await VoucherModel.find().sort({ createdAt: -1 }).limit(200)).map(voucherDto) };
}
export async function saveVoucher(id: string | null, body: unknown, actorId: string) {
  const input = id ? voucherUpdateSchema.parse(body) : voucherCreateSchema.parse(body);
  const expectedVersion = 'expectedVersion' in input ? input.expectedVersion : undefined;
  const {
    code,
    name,
    type,
    value,
    minSubtotal,
    maxDiscount,
    startsAt,
    endsAt,
    maxUses,
    perMemberLimit,
    memberRequired,
    allowPointRedemption,
    isActive,
  } = input;
  const fields = {
    code,
    name,
    type,
    value,
    minSubtotal,
    maxDiscount,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    maxUses,
    perMemberLimit,
    memberRequired,
    allowPointRedemption,
    isActive,
  };
  try {
    return await unitOfWork.withTransaction(async (session) => {
      let voucher: VoucherDoc;
      if (id) {
        const old = await VoucherModel.findById(id).session(session);
        if (!old) throw new NotFoundError();
        if (old.usedCount > maxUses)
          throw new ValidationError('Tổng lượt không thể nhỏ hơn số lượt đang giữ/đã dùng.');
        if (old.code !== code)
          throw new ValidationError('Mã voucher không được thay đổi. Hãy tạo mã mới.');
        const updated = await VoucherModel.findOneAndUpdate(
          { _id: id, version: expectedVersion },
          { $set: fields, $inc: { version: 1 } },
          { new: true, session },
        );
        if (!updated) throw new ConflictError('CONFLICT', 'Voucher vừa được cập nhật.');
        voucher = updated;
      } else {
        const [created] = await VoucherModel.create([fields], { session });
        if (!created) throw new Error('Failed to create voucher');
        voucher = created;
      }
      await auditRepository.log(
        {
          actorType: 'USER',
          actorId,
          action: id ? 'voucher.updated' : 'voucher.created',
          entityType: 'Voucher',
          entityId: voucher.id,
          metadata: { code },
        },
        session,
      );
      return voucherDto(voucher);
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new ConflictError('VOUCHER_EXISTS', 'Mã voucher đã tồn tại.');
    throw e;
  }
}
export async function priceBenefits(
  subtotal: number,
  selection: BenefitSelection,
  session?: ClientSession | null,
): Promise<Benefits> {
  const parsed = benefitSelectionSchema.parse({
    voucherCode: selection.voucherCode,
    redeemPoints: selection.redeemPoints,
  });
  const points = parsed.redeemPoints ?? 0;
  const member = selection.memberId
    ? await MemberModel.findOne({ _id: selection.memberId, isActive: true }).session(
        session ?? null,
      )
    : null;
  if (selection.memberId && !member)
    throw new UnauthorizedError('Tài khoản thành viên không khả dụng.');
  const result: Benefits = {
    subtotal,
    total: subtotal,
    memberId: member?.id ?? null,
    voucherId: null,
    voucherCode: '',
    voucherVersion: 0,
    voucherDiscount: 0,
    pointsDiscount: 0,
    redeemedPoints: points,
    voucherAllowsPoints: true,
    maxRedeemPoints: 0,
  };
  if (parsed.voucherCode) {
    const voucher = await VoucherModel.findOne({ code: parsed.voucherCode }).session(
      session ?? null,
    );
    if (
      !voucher ||
      !voucher.isActive ||
      voucher.startsAt.getTime() > Date.now() ||
      voucher.endsAt.getTime() <= Date.now()
    )
      throw new ConflictError(
        'VOUCHER_INVALID',
        'Voucher không tồn tại, chưa có hiệu lực hoặc đã hết hạn.',
      );
    if (voucher.memberRequired && !member)
      throw new UnauthorizedError('Voucher yêu cầu đăng nhập thành viên.');
    if (subtotal < voucher.minSubtotal)
      throw new ValidationError(`Đơn cần đạt ${voucher.minSubtotal}đ để dùng voucher.`);
    if (voucher.usedCount >= voucher.maxUses)
      throw new ConflictError('VOUCHER_EXHAUSTED', 'Voucher đã hết lượt.');
    if (voucher.perMemberLimit && member) {
      const used = await VoucherUseModel.countDocuments({
        voucherId: voucher._id,
        memberId: member._id,
        state: { $ne: 'RELEASED' },
      }).session(session ?? null);
      if (used >= voucher.perMemberLimit)
        throw new ConflictError('VOUCHER_MEMBER_LIMIT', 'Bạn đã dùng hết lượt cho voucher này.');
    }
    result.voucherId = voucher.id;
    result.voucherCode = voucher.code;
    result.voucherVersion = voucher.version;
    result.voucherAllowsPoints = voucher.allowPointRedemption === true;
    const discount =
      voucher.type === 'FIXED' ? voucher.value : Math.floor((subtotal * voucher.value) / 100);
    result.voucherDiscount = Math.min(subtotal, discount, voucher.maxDiscount ?? subtotal);
  }
  const afterVoucher = subtotal - result.voucherDiscount;
  const financialLimit = Math.floor(
    (afterVoucher * LOYALTY_RULES.maxRedeemPercent) / 100 / LOYALTY_RULES.redeemValueVnd,
  );
  result.maxRedeemPoints = result.voucherAllowsPoints
    ? Math.min(member?.points ?? 0, financialLimit)
    : 0;
  if (points) {
    if (!member) throw new UnauthorizedError('Đăng nhập thành viên để đổi điểm.');
    if (!result.voucherAllowsPoints)
      throw new ValidationError(
        'Voucher này không cho phép dùng kèm điểm. Hãy bỏ voucher hoặc đặt số điểm đổi về 0.',
      );
    if (points > member.points)
      throw new ConflictError('POINTS_INSUFFICIENT', 'Không đủ điểm để đổi.');
    if (points > financialLimit)
      throw new ValidationError(
        `Chỉ được đổi tối đa ${financialLimit} điểm, tương đương 50% số tiền còn lại sau voucher.`,
      );
    result.pointsDiscount = points * LOYALTY_RULES.redeemValueVnd;
  }
  result.total = subtotal - result.voucherDiscount - result.pointsDiscount;
  return result;
}
export async function reserveBenefits(
  orderId: string,
  orderCode: string,
  benefits: Benefits,
  session: ClientSession,
) {
  // All member orders take the same write lock as account changes/redemption, even when earning only.
  if (benefits.memberId) {
    const member = await MemberModel.findOneAndUpdate(
      { _id: benefits.memberId, isActive: true, points: { $gte: benefits.redeemedPoints } },
      { $inc: { points: -benefits.redeemedPoints, version: 1 } },
      { new: true, session },
    );
    if (!member)
      throw new ConflictError('POINTS_INSUFFICIENT', 'Thành viên hoặc số điểm vừa thay đổi.');
    if (benefits.redeemedPoints)
      await PointEntryModel.create(
        [
          {
            memberId: member._id,
            orderId,
            orderCode,
            type: 'REDEEM',
            points: -benefits.redeemedPoints,
            balanceAfter: member.points,
          },
        ],
        { session },
      );
  }
  if (benefits.voucherId) {
    const voucher = await VoucherModel.findOneAndUpdate(
      {
        _id: benefits.voucherId,
        version: benefits.voucherVersion,
        isActive: true,
        $expr: { $lt: ['$usedCount', '$maxUses'] },
      },
      { $inc: { usedCount: 1 } },
      { new: true, session },
    );
    if (!voucher)
      throw new ConflictError('VOUCHER_EXHAUSTED', 'Voucher vừa thay đổi hoặc hết lượt.');
    // The voucher write serializes concurrent checks for both global and per-member limits.
    if (voucher.perMemberLimit && benefits.memberId) {
      const used = await VoucherUseModel.countDocuments({
        voucherId: voucher._id,
        memberId: benefits.memberId,
        state: { $ne: 'RELEASED' },
      }).session(session);
      if (used >= voucher.perMemberLimit)
        throw new ConflictError('VOUCHER_MEMBER_LIMIT', 'Bạn đã dùng hết lượt cho voucher này.');
    }
    await VoucherUseModel.create(
      [{ voucherId: voucher._id, memberId: benefits.memberId, orderId }],
      { session },
    );
  }
}
export async function settleOrderBenefits(order: OrderDoc, next: string, session: ClientSession) {
  if (next === 'PREPARING')
    await VoucherUseModel.updateOne(
      { orderId: order._id, state: 'RESERVED' },
      { $set: { state: 'CONSUMED' } },
      { session },
    );
  if (next === 'CANCELLED') {
    const use = await VoucherUseModel.findOneAndUpdate(
      { orderId: order._id, state: 'RESERVED' },
      { $set: { state: 'RELEASED' } },
      { new: true, session },
    );
    if (use)
      await VoucherModel.updateOne(
        { _id: use.voucherId },
        { $inc: { usedCount: -1 } },
        { session },
      );
    if (
      order.memberId &&
      order.redeemedPoints &&
      !(await PointEntryModel.exists({ orderId: order._id, type: 'RETURN' }).session(session))
    ) {
      const member = await MemberModel.findByIdAndUpdate(
        order.memberId,
        { $inc: { points: order.redeemedPoints, version: 1 } },
        { new: true, session },
      );
      if (!member) throw new Error('Order member missing');
      await PointEntryModel.create(
        [
          {
            memberId: member._id,
            orderId: order._id,
            orderCode: order.code,
            type: 'RETURN',
            points: order.redeemedPoints,
            balanceAfter: member.points,
          },
        ],
        { session },
      );
    }
  }
  if (next === 'SERVED' && order.paymentStatus === 'PAID' && order.memberId) {
    if (await PointEntryModel.exists({ orderId: order._id, type: 'EARN' }).session(session)) return;
    const points = Math.floor(order.total / LOYALTY_RULES.earnEveryVnd);
    const member = await MemberModel.findByIdAndUpdate(
      order.memberId,
      { $inc: { points, version: 1 } },
      { new: true, session },
    );
    if (!member) throw new Error('Order member missing');
    await PointEntryModel.create(
      [
        {
          memberId: member._id,
          orderId: order._id,
          orderCode: order.code,
          type: 'EARN',
          points,
          balanceAfter: member.points,
        },
      ],
      { session },
    );
    order.earnedPoints = points;
    await mongoose
      .model('Order')
      .updateOne({ _id: order._id }, { $set: { earnedPoints: points } }, { session });
  }
}

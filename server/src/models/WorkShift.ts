import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const workShiftSchema = new Schema(
  {
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    staffName: { type: String, required: true },
    label: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    note: { type: String, default: '' },
    status: {
      type: String,
      enum: ['SCHEDULED', 'WORKING', 'COMPLETED', 'CANCELLED'],
      default: 'SCHEDULED',
    },
    requestId: { type: String, required: true },
    requestHash: { type: String, required: true },
    clockInAt: { type: Date, default: null },
    clockOutAt: { type: Date, default: null },
    effectiveInAt: { type: Date, default: null },
    effectiveOutAt: { type: Date, default: null },
    correctionReason: { type: String, default: '' },
    correctedByName: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    version: { type: Number, default: 0 },
    activityVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);
workShiftSchema.index({ requestId: 1 }, { unique: true });
workShiftSchema.index({ staffId: 1, startsAt: 1, endsAt: 1 });
workShiftSchema.index({ startsAt: 1, endsAt: 1 });
workShiftSchema.index(
  { staffId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'WORKING' },
    name: 'one_working_shift_per_staff',
  },
);
export type WorkShiftDoc = HydratedDocument<InferSchemaType<typeof workShiftSchema>>;
export const WorkShiftModel = model('WorkShift', workShiftSchema);

const staffingPolicySchema = new Schema(
  {
    _id: { type: String },
    version: { type: Number, default: 0 },
    ordersPerStaffHour: { type: Number, default: 6 },
    rules: {
      type: [
        {
          day: Number,
          startMinute: Number,
          endMinute: Number,
          minStaff: Number,
          label: String,
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
export const StaffingPolicyModel = model('StaffingPolicy', staffingPolicySchema);

const workActivitySchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  stage: { type: String, enum: ['CONFIRMED', 'PREPARING', 'READY', 'SERVED'], required: true },
  at: { type: Date, required: true },
  staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  staffName: { type: String, required: true },
  workShiftId: { type: Schema.Types.ObjectId, ref: 'WorkShift', default: null },
  preparationStaffId: { type: Schema.Types.ObjectId, default: null },
  preparationStaffName: { type: String, default: '' },
  preparationShiftId: { type: Schema.Types.ObjectId, default: null },
  preparationMs: { type: Number, default: null },
});
workActivitySchema.index({ orderId: 1, stage: 1 }, { unique: true });
workActivitySchema.index({ at: 1, staffId: 1 });
workActivitySchema.index({ workShiftId: 1 });
workActivitySchema.index({ preparationShiftId: 1 });
export const WorkActivityModel = model('WorkActivity', workActivitySchema);

const workScheduleCopySchema = new Schema(
  {
    _id: { type: String, required: true },
    requestHash: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shiftIds: { type: [Schema.Types.ObjectId], required: true },
  },
  { timestamps: true },
);
workScheduleCopySchema.index({ createdAt: -1 });
export const WorkScheduleCopyModel = model('WorkScheduleCopy', workScheduleCopySchema);

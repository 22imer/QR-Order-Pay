import { Schema, model } from 'mongoose';
const settings = new Schema(
  {
    _id: { type: String, default: 'main' },
    version: { type: Number, default: 0 },
    lockVersion: { type: Number, default: 0 },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
export const FreestyleSettingsModel = model('FreestyleSettings', settings);
const save = new Schema(
  {
    userId: { type: String, required: true },
    requestId: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true },
);
save.index({ userId: 1, requestId: 1 }, { unique: true });
export const FreestyleSaveModel = model('FreestyleSave', save);

import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const trackSchema = new Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, required: true },
    audioUrl: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);
export const JukeboxTrackModel = model('JukeboxTrack', trackSchema);
const stateSchema = new Schema(
  {
    _id: { type: String, default: 'main' },
    version: { type: Number, default: 0 },
    playbackVersion: { type: Number, default: 0 },
    current: {
      type: new Schema(
        { trackId: String, title: String, artist: String, audioUrl: String },
        { _id: false },
      ),
      default: null,
    },
    leaseUserId: { type: String, default: null },
    leaseDeviceId: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
export type JukeboxStateDoc = HydratedDocument<InferSchemaType<typeof stateSchema>>;
export const JukeboxStateModel = model('JukeboxState', stateSchema);
const voteSchema = new Schema(
  {
    tableSessionId: { type: Schema.Types.ObjectId, required: true, unique: true },
    trackId: { type: Schema.Types.ObjectId, default: null },
    used: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    selectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
voteSchema.index({ trackId: 1, selectedAt: 1 });
export const JukeboxVoteModel = model('JukeboxVote', voteSchema);
const actionSchema = new Schema(
  {
    actor: { type: String, required: true },
    requestId: { type: String, required: true },
    hash: { type: String, required: true },
    resultId: { type: String, default: null },
  },
  { timestamps: true },
);
actionSchema.index({ actor: 1, requestId: 1 }, { unique: true });
export const JukeboxActionModel = model('JukeboxAction', actionSchema);

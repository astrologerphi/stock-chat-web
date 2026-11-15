import mongoose, { Schema } from 'mongoose';
import type { Diagram, Leader, PromptConfig, ScoreEntry } from '../shared/types.ts';

export const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017';
export const DB_NAME = process.env.MONGO_DB ?? 'Local1114';
export const COLLECTION = 'Coll01';

/**
 * Every document lives in the single `Coll01` collection; mongoose discriminators
 * (keyed by `docType`) separate stocks from app configuration.
 */
const baseSchema = new Schema({}, { collection: COLLECTION, discriminatorKey: 'docType', timestamps: true });
const Base = mongoose.model('Coll01Doc', baseSchema);

export interface StockDoc {
  symbol: string;
  name: string;
  image: string;
  exchange: string;
  exchangeFullName: string;
  country: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  price: number | null;
  changePercentage: number | null;
  active: boolean;
  floatShares: number | null;
  outstandingShares: number | null;
  floatRatio: number | null;
  heat: number | null;
  heatUpdatedAt: Date | null;
  profile?: {
    description?: string;
    website?: string;
    ceo?: string;
    employees?: number | null;
    ipoDate?: string;
    range?: string;
  };
  leaders: Leader[];
  profileUpdatedAt: Date | null;
  scores: Record<string, ScoreEntry>;
  llmTags: string[];
  tags: string[];
  tagEdits: { added: string[]; removed: string[] };
  introduction: string;
  diagrams: Diagram[];
  lastLlmRunAt: Date | null;
  llmModel: string | null;
  llmError: string | null;
}

const stockSchema = new Schema({
  symbol: { type: String, required: true },
  name: String,
  image: String,
  exchange: String,
  exchangeFullName: String,
  country: String,
  sector: String,
  industry: String,
  marketCap: Number,
  price: Number,
  changePercentage: Number,
  active: { type: Boolean, default: true },
  floatShares: Number,
  outstandingShares: Number,
  floatRatio: Number,
  heat: { type: Number, default: null },
  heatUpdatedAt: { type: Date, default: null },
  profile: {
    description: String,
    website: String,
    ceo: String,
    employees: Number,
    ipoDate: String,
    range: String,
  },
  leaders: [{ _id: false, name: String, title: String, pay: Number, currencyPay: String, gender: String, yearBorn: Number }],
  profileUpdatedAt: { type: Date, default: null },
  scores: { type: Schema.Types.Mixed, default: {} },
  llmTags: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  tagEdits: { added: { type: [String], default: [] }, removed: { type: [String], default: [] } },
  introduction: { type: String, default: '' },
  diagrams: [{ _id: false, promptId: String, title: String, horizontal: String, vertical: String }],
  lastLlmRunAt: { type: Date, default: null },
  llmModel: { type: String, default: null },
  llmError: { type: String, default: null },
});

const stockOnly = { partialFilterExpression: { docType: 'stock' } };
stockSchema.index({ symbol: 1 }, { unique: true, ...stockOnly });
stockSchema.index({ active: 1, marketCap: -1 }, stockOnly);
stockSchema.index({ active: 1, heat: -1 }, stockOnly);
stockSchema.index({ active: 1, floatRatio: -1 }, stockOnly);
stockSchema.index({ active: 1, lastLlmRunAt: -1 }, stockOnly);
stockSchema.index({ country: 1 }, stockOnly);
stockSchema.index({ exchange: 1 }, stockOnly);
stockSchema.index({ tags: 1 }, stockOnly);

export interface ConfigDoc {
  key: string;
  prompts?: PromptConfig;
  lastSyncedAt?: Date | null;
}

const promptItem = { _id: false, id: String, title: String, description: String };
const configSchema = new Schema({
  key: { type: String, required: true },
  prompts: {
    scorePrompts: [promptItem],
    svgPrompts: [promptItem],
    introPrompt: String,
  },
  lastSyncedAt: Date,
});
configSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { docType: 'config' } });

export const Stock = Base.discriminator('stock', stockSchema);
export const Config = Base.discriminator('config', configSchema);

export async function connectDb(): Promise<void> {
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  // createIndexes (not syncIndexes): both models share one collection, so neither may drop the other's indexes.
  await Promise.all([Stock.createIndexes(), Config.createIndexes()]);
}

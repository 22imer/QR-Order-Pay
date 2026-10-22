import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const giftItemInputSchema = z
  .object({
    productId: objectId,
    variantId: objectId.nullable(),
    sugarLevel: z.string().max(40),
    iceLevel: z.string().max(40),
    toppingIds: z.array(objectId).max(20),
    note: z.string().trim().max(280).default(''),
    quantity: z.number().int().min(1).max(10),
  })
  .strict();
export const giftCreateSchema = z
  .object({
    requestId: z.string().uuid(),
    recipientTableId: objectId,
    recipientSessionId: objectId,
    message: z.string().trim().max(140).default(''),
    items: z.array(giftItemInputSchema).min(1).max(10),
    showSenderTable: z.boolean().default(false),
  })
  .strict();
export const giftActionSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    decision: z.enum(['ACCEPT', 'DECLINE', 'CANCEL']),
  })
  .strict();
export type GiftCreate = z.infer<typeof giftCreateSchema>;
export interface GiftView {
  id: string;
  direction: 'SENT' | 'RECEIVED';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'ORDERED';
  recipientTableName: string;
  showSenderTable: boolean;
  senderTable?: { name: string; code: string };
  message: string;
  items: Array<
    z.infer<typeof giftItemInputSchema> & {
      name: string;
      variantName: string;
      toppingNames: string[];
    }
  >;
  expiresAt: string;
  createdAt: string;
  version: number;
  orderStatus: string | null;
  orderId?: string | null;
}
export interface GiftTable {
  tableId: string;
  sessionId: string;
  name: string;
  code: string;
  available: boolean;
}
export interface GiftDelivery {
  recipientTableName: string;
  recipientTableCode: string;
  message: string;
}

import { z } from 'zod';
export const CUP_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const CUP_PHOTO_MAX_PIXELS = 16000000;
export const cupPhotoIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const cupPhotoViewSchema = z.object({
  id: cupPhotoIdSchema,
  width: z.number(),
  height: z.number(),
  expiresAt: z.string(),
});
export type CupPhotoView = z.infer<typeof cupPhotoViewSchema>;
export const cupPrintInputSchema = z
  .object({
    requestId: z.string().uuid(),
    orderId: cupPhotoIdSchema,
    itemIndex: z.number().int().min(0).max(9999),
    copies: z.number().int().min(1).max(50),
    paper: z.enum(['A4', 'LABEL_60_80']),
  })
  .strict();
export interface CupPrintOrder {
  id: string;
  code: string;
  destination: string;
  status: string;
  createdAt: string;
  items: {
    index: number;
    name: string;
    size: string;
    quantity: number;
    available: boolean;
    attempts: number;
  }[];
}

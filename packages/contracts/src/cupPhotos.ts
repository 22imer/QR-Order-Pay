import { z } from 'zod';
export const CUP_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const CUP_PHOTO_MAX_PIXELS = 16000000;
export const cupPhotoIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const latteStyleSchema = z.enum(['SOFT', 'BOLD', 'DOTS']);
export type LatteStyle = z.infer<typeof latteStyleSchema>;
export const LATTE_STYLES = [
  { id: 'SOFT', name: 'Latte mềm', description: 'Tông cà phê mịn, giữ nhiều sắc độ.' },
  { id: 'BOLD', name: 'Cacao đậm', description: 'Nét tương phản rõ trên nền bọt sáng.' },
  { id: 'DOTS', name: 'Chấm nghệ thuật', description: 'Tạo hình bằng các chấm màu cà phê.' },
] as const;
export const cupPhotoViewSchema = z.object({
  id: cupPhotoIdSchema,
  width: z.number(),
  height: z.number(),
  expiresAt: z.string(),
  kind: z.enum(['PHOTO', 'LATTE_ART']).optional(),
  latteStyle: latteStyleSchema.optional(),
});
export type CupPhotoView = z.infer<typeof cupPhotoViewSchema>;
export interface LatteArtVariants {
  sourceId: string;
  variants: CupPhotoView[];
}
export const latteArtGenerateSchema = z.object({}).strict();
export const latteArtExportSchema = z
  .object({
    requestId: z.string().uuid(),
    orderId: cupPhotoIdSchema,
    itemIndex: z.number().int().min(0).max(9999),
  })
  .strict();
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
    kind?: 'PHOTO' | 'LATTE_ART';
    latteStyle?: LatteStyle;
  }[];
}

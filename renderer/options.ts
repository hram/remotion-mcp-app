import { z } from "zod";

export const inspectFramesSchema = z
  .object({
    frames: z.array(z.number().int().nonnegative()).min(1).max(24).optional(),
    count: z.number().int().min(1).max(24).optional(),
    scale: z
      .number()
      .positive()
      .max(1)
      .optional()
      .describe(
        "Render preview frames at this scale (0 < scale <= 1), instead of rendering full size and shrinking. Cannot be combined with previewWidth.",
      ),
    previewWidth: z
      .number()
      .int()
      .min(1)
      .max(1920)
      .optional()
      .describe(
        "Render preview frames at this width, preserving aspect ratio and never upscaling. Default: fit within 480x480.",
      ),
    imageFormat: z
      .enum(["png", "jpeg"])
      .optional()
      .describe(
        "Format of rendered frames and the contact sheet. Default: png; use jpeg for compressed drafts.",
      ),
    jpegQuality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "JPEG quality (1–100, default 80). Only valid with imageFormat: jpeg.",
      ),
  })
  .superRefine((options, ctx) => {
    if (options.scale !== undefined && options.previewWidth !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["previewWidth"],
        message: "Use either scale or previewWidth, not both.",
      });
    }
    if (options.jpegQuality !== undefined && options.imageFormat !== "jpeg") {
      ctx.addIssue({
        code: "custom",
        path: ["jpegQuality"],
        message: "jpegQuality requires imageFormat: jpeg.",
      });
    }
  });

export const exportVideoSchema = z.object({
  codec: z.literal("h264").optional(),
  outputName: z.string().optional(),
  muted: z
    .boolean()
    .optional()
    .describe(
      "Omit all audio from the final MP4. Default: false (preserves existing behavior).",
    ),
});

export type InspectFramesOptions = z.infer<typeof inspectFramesSchema>;
export type ExportVideoOptions = z.infer<typeof exportVideoSchema>;

export function resolvePreviewOptions(
  width: number,
  height: number,
  options: InspectFramesOptions = {},
) {
  const parsed = inspectFramesSchema.parse(options);
  const scale =
    parsed.scale ??
    (parsed.previewWidth !== undefined
      ? Math.min(1, parsed.previewWidth / width)
      : Math.min(1, 480 / Math.max(width, height)));
  if (Math.round(width * scale) < 1 || Math.round(height * scale) < 1) {
    throw new Error(
      "Preview scale is too small: rendered width and height must be at least 1 pixel.",
    );
  }
  return {
    scale,
    imageFormat: parsed.imageFormat ?? "png",
    jpegQuality:
      parsed.imageFormat === "jpeg" ? (parsed.jpegQuality ?? 80) : undefined,
  };
}

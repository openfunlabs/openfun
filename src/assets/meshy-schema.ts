import { z } from "zod";

export const keySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const taskIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,128}$/);
const localPath = z.string().min(1).max(4096);
const stylePrompt = z.string().trim().min(1).max(800);
const exactlyOne = (a: unknown, b: unknown) =>
  Number(a !== undefined) + Number(b !== undefined) === 1;
export const modelParamsSchema = z
  .object({
    key: keySchema.describe(
      "Stable asset revision, e.g. guard-v1. Reuse to recover; a new revision creates a new paid task.",
    ),
    reference: localPath
      .optional()
      .describe(
        "Project-local PNG/JPEG to upload to Meshy. Supply exactly one of reference or prompt.",
      ),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(600)
      .optional()
      .describe(
        "Text-to-3D generates untextured geometry first. Use world_process_model refine to texture the completed preview.",
      ),
    targetPolycount: z.number().int().min(100).max(300000).default(10000),
    texturePrompt: stylePrompt.optional(),
    pose: z.enum(["a-pose", "t-pose"]).optional(),
  })
  .refine(
    (p) => exactlyOne(p.reference, p.prompt),
    "Supply exactly one of reference or prompt",
  )
  .refine(
    (p) => !p.prompt || !p.texturePrompt,
    "Text previews have no textures; provide texturePrompt in the later refine task",
  );
const source = {
  sourceKey: keySchema
    .optional()
    .describe(
      "Completed model task in this project. Exactly one of sourceKey or model is required.",
    ),
  model: localPath
    .optional()
    .describe(
      "Project-local self-contained GLB (including Blender exports); uploaded to Meshy.",
    ),
};
export const processModelSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("refine"),
      key: keySchema,
      sourceKey: keySchema,
      texturePrompt: stylePrompt.optional(),
      reference: localPath.optional(),
    })
    .refine(
      (p) => !(p.texturePrompt && p.reference),
      "Use a texture prompt or image, not both",
    ),
  z
    .object({
      operation: z.literal("retexture"),
      key: keySchema,
      ...source,
      texturePrompt: stylePrompt.optional(),
      reference: localPath.optional(),
      preserveUV: z.boolean().optional(),
    })
    .refine(
      (p) => exactlyOne(p.sourceKey, p.model),
      "Supply exactly one model source",
    )
    .refine(
      (p) => exactlyOne(p.texturePrompt, p.reference),
      "Supply exactly one texture prompt or reference",
    ),
  z
    .object({
      operation: z.literal("rig"),
      key: keySchema,
      ...source,
      heightMeters: z.number().positive().max(100).default(1.7),
    })
    .refine(
      (p) => exactlyOne(p.sourceKey, p.model),
      "Supply exactly one model source",
    ),
  z.object({
    operation: z.literal("animate"),
    key: keySchema,
    sourceKey: keySchema,
    actionId: z
      .number()
      .int()
      .nonnegative()
      .describe(
        "Fetch a real ID with world_animation_library; do not invent IDs. Source must be a completed rig task.",
      ),
  }),
]);
export const outputSchema = z.enum(["model", "walking", "running"]);
export const modelStatusSchema = z.object({
  key: keySchema,
  output: outputSchema
    .default("model")
    .describe(
      "For rig tasks, optionally download a returned walking/running clip. No new generation.",
    ),
  taskId: taskIdSchema
    .optional()
    .describe(
      "Recover an uncertain submission using an existing task ID. Never resubmit because of a timeout.",
    ),
});
export const animationLibrarySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z
    .enum([
      "WalkAndRun",
      "BodyMovements",
      "DailyActions",
      "Fighting",
      "Dancing",
    ])
    .optional(),
  actionIds: z.array(z.number().int().nonnegative()).min(1).max(50).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export const operationSchema = z.enum([
  "image",
  "text-preview",
  "refine",
  "retexture",
  "rig",
  "animate",
]);
export type Operation = z.infer<typeof operationSchema>;
export type Output = z.infer<typeof outputSchema>;
export const assetSchema = z.string().regex(/^[a-f0-9]{64}\.glb$/);
export const jobSchema = z.object({
  version: z.literal(1),
  key: keySchema,
  requestHash: z.string(),
  // Existing alpha.19 task files are image-to-3D tasks.
  operation: operationSchema.default("image"),
  reference: z.string().optional(),
  sourceKey: keySchema.optional(),
  status: z.enum([
    "SUBMITTING",
    "UNKNOWN",
    "SUBMITTED",
    "PENDING",
    "IN_PROGRESS",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
  ]),
  taskId: taskIdSchema.optional(),
  progress: z.number().optional(),
  consumedCredits: z.number().nonnegative().optional(),
  asset: assetSchema.optional(),
  outputs: z
    .object({
      model: assetSchema.optional(),
      walking: assetSchema.optional(),
      running: assetSchema.optional(),
    })
    .optional(),
  availableOutputs: z.array(outputSchema).max(3).optional(),
});
export type Job = z.infer<typeof jobSchema>;
export const endpoints: Record<Operation, string> = {
  image: "/openapi/v1/image-to-3d",
  "text-preview": "/openapi/v2/text-to-3d",
  refine: "/openapi/v2/text-to-3d",
  retexture: "/openapi/v1/retexture",
  rig: "/openapi/v1/rigging",
  animate: "/openapi/v1/animations",
};

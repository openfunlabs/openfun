import { z } from "zod";

export const vectorSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const kindSchema = z.enum([
  "tree",
  "rock",
  "house",
  "crystal",
  "npc",
  "beacon",
]);
export const assetNameSchema = z.string().regex(/^[a-f0-9]{64}\.glb$/);
export const worldSpecSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z
      .string()
      .max(12000)
      .default("A stylized world waiting to be explored."),
    seed: z.string().min(1).max(128).default("openfun"),
    palette: z
      .object({ ground: colorSchema, sky: colorSchema, accent: colorSchema })
      .default({ ground: "#5d8466", sky: "#92b5ca", accent: "#f2ba68" }),
    rules: z.array(z.string().max(1000)).max(32).default([]),
    density: z.number().int().min(1).max(24).default(8),
    assets: z.partialRecord(kindSchema, assetNameSchema).default({}),
  })
  .strict();

export const entitySchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: kindSchema,
    name: z.string().min(1).max(160),
    position: vectorSchema,
    rotation: z.number().finite().default(0),
    scale: vectorSchema
      .default([1, 1, 1])
      .refine(
        (v) => v.every((n) => n > 0 && n <= 30),
        "Scale must be in (0, 30]",
      ),
    color: colorSchema,
    asset: assetNameSchema.optional(),
    state: z
      .object({
        removed: z.boolean().optional(),
        open: z.boolean().optional(),
        dialogue: z.string().max(4000).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const chunkPlanSchema = z
  .object({ entities: z.array(entitySchema.omit({ id: true })).max(64) })
  .strict();
export const recipeSchema = z
  .object({
    name: z.string().min(1).max(120),
    parts: z
      .array(
        z
          .object({
            shape: z.enum(["box", "sphere", "cylinder", "cone"]),
            position: vectorSchema.refine(
              (v) => v.every((n) => Math.abs(n) <= 64),
              "Part position must be within 64 meters",
            ),
            scale: vectorSchema.refine(
              (v) => v.every((n) => n >= 0.02 && n <= 30),
              "Scale must be in [0.02, 30]",
            ),
            color: colorSchema,
            rotation: vectorSchema
              .refine(
                (v) => v.every((n) => Math.abs(n) <= Math.PI * 2),
                "Rotation must be within ±2π radians",
              )
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(128),
  })
  .strict();

export const commandSchema = z
  .object({
    id: z.string().min(1).max(160),
    type: z.enum(["move", "interact"]),
    entityId: z.string().max(160).optional(),
    position: vectorSchema.optional(),
  })
  .strict();

export type WorldSpec = z.infer<typeof worldSpecSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Kind = z.infer<typeof kindSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type WorldCommand = z.infer<typeof commandSchema>;
export type ChunkPlan = z.infer<typeof chunkPlanSchema>;
export interface Chunk {
  id: string;
  x: number;
  z: number;
  size: number;
  entities: Entity[];
  specRevision: number;
}
export interface Snapshot {
  world: WorldSpec & { id: string; revision: number };
  player: { position: [number, number, number] };
  chunks: Chunk[];
  revision: number;
}
export interface PortableWorld {
  formatVersion: 1;
  worldId: string;
  releaseId: string;
  spec: WorldSpec;
  specRevision: number;
  chunks: Chunk[];
  player: Snapshot["player"];
  revision: number;
}

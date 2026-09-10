import { z } from "zod";
export const polishOptions = z.object({
  focus: z
    .string()
    .trim()
    .max(2000)
    .default(
      "Improve the most consequential observed weaknesses while preserving the game's identity.",
    ),
});
export const roundReport = z.object({
  outcome: z.enum(["improved", "finished", "no_gain", "needs_input"]),
  summary: z.string().trim().min(1).max(2000),
  checks: z.array(z.string().max(500)).max(12),
  remaining: z.array(z.string().max(500)).max(12),
});
export type RoundReport = z.infer<typeof roundReport>;
export const polishState = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  status: z.enum(["running", "paused", "ready", "applied", "stopped"]),
  options: polishOptions,
  round: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  baseline: z.string(),
  worldContext: z.string(),
  acceptedHash: z.string(),
  accepted: z.number().int().nonnegative(),
  noGain: z.number().int().nonnegative(),
  reports: z.array(roundReport).max(20),
  reason: z.string().max(2000),
  checkpoint: z
    .string()
    .regex(/^before-[0-9]+-[a-f0-9-]+\.openfun$/)
    .optional(),
});
export type PolishState = z.infer<typeof polishState>;

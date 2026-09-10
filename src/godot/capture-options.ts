import { z } from "zod";

const time = z.number().finite().min(0).max(120);
const position = z.tuple([
  z.number().min(0).max(1920),
  z.number().min(0).max(1200),
]);
const base = { at: time, pressed: z.boolean() };
export const previewOptionsSchema = z
  .object({
    mode: z.enum(["headless", "windowed"]).default("headless"),
    width: z.number().int().min(320).max(1920).default(1280),
    height: z.number().int().min(240).max(1200).default(800),
    seconds: z.number().finite().min(1).max(120).default(3),
    warmupSeconds: z.number().finite().min(0).max(30).default(1),
    targetFps: z.number().int().min(15).max(240).default(60),
    demo: z.boolean().default(false),
    captureTimes: z.array(time).max(6).optional(),
    inputs: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              ...base,
              kind: z.literal("action"),
              name: z.string().min(1).max(80),
            })
            .strict(),
          z
            .object({
              ...base,
              kind: z.literal("key"),
              name: z.string().min(1).max(40),
            })
            .strict(),
          z
            .object({
              ...base,
              kind: z.literal("mouse_button"),
              button: z.number().int().min(1).max(3),
              position: position.optional(),
            })
            .strict(),
        ]),
      )
      .max(64)
      .default([]),
  })
  .strict();
export type PreviewOptions = z.input<typeof previewOptionsSchema>;
export function parsePreviewOptions(options: PreviewOptions) {
  const parsed = previewOptionsSchema.parse(options);
  if (parsed.warmupSeconds > parsed.seconds)
    throw new Error("Warmup must not exceed test duration");
  const captureTimes = parsed.captureTimes ?? [parsed.seconds];
  if (
    captureTimes.some(
      (t, i) => t > parsed.seconds || (i > 0 && t <= captureTimes[i - 1]!),
    ) ||
    parsed.inputs.some((input) => input.at >= parsed.seconds)
  )
    throw new Error(
      "Capture times must increase within duration; inputs must occur before the end",
    );
  for (const input of parsed.inputs) {
    if (
      input.kind === "mouse_button" &&
      input.position &&
      (input.position[0] >= parsed.width || input.position[1] >= parsed.height)
    )
      throw new Error("Mouse position must be inside the preview viewport");
  }
  return {
    ...parsed,
    captureTimes,
    inputs: [...parsed.inputs].sort((a, b) => a.at - b.at),
  };
}
export function frameIntervalSummary(samples: number[]) {
  if (samples.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error("Invalid frame timing sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!
      : null;
  return {
    samples: sorted.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
    over50Ms: sorted.filter((n) => n > 50).length,
  };
}

export function frameBudgetSummary(samples: number[], targetFps: number) {
  if (!Number.isFinite(targetFps) || targetFps <= 0)
    throw new Error("Invalid target FPS");
  const timing = frameIntervalSummary(samples);
  const budgetMs = 1000 / targetFps;
  const overBudget = samples.filter((ms) => ms > budgetMs).length;
  return {
    targetFps,
    budgetMs,
    measuredSeconds: samples.reduce((sum, ms) => sum + ms, 0) / 1000,
    overBudget,
    overBudgetPercent: samples.length
      ? (100 * overBudget) / samples.length
      : null,
    overTwoBudgets: samples.filter((ms) => ms > 2 * budgetMs).length,
    over100Ms: samples.filter((ms) => ms > 100).length,
    p95WithinBudget: timing.p95Ms === null ? null : timing.p95Ms <= budgetMs,
    note: "Observed diagnostic intervals, not a pass/fail verdict or GPU timing. VSync/OS jitter affects strict budget counts; inspect the route, warmup, p95/p99 and repeated stalls before judging.",
  };
}

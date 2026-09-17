import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

const text = z.string().trim().min(1).max(2000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const references = z.array(text).max(100);
const gateIds = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"] as const;
const dimensionIds = [
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "Q5",
  "Q6",
  "Q7",
  "Q8",
  "Q9",
  "Q10",
] as const;

/** A review record is a human/assisted judgment, never an automated quality certificate. */
export const evaluationReport = z.strictObject({
  specification: z.literal("evaluation-v1.2"),
  runId: text,
  case: text,
  phase: z.enum(["first-delivery", "polish", "continuation"]),
  projectDigest: digest,
  reviewer: text,
  outcome: z.enum(["complete", "incomplete", "blocked"]),
  humanPlaytest: z.strictObject({
    status: z.enum(["pending", "completed"]),
    notes: text,
    evidence: references,
  }),
  evidence: z
    .array(
      z.strictObject({
        id: text,
        file: text,
        sha256: digest,
        projectDigest: digest,
        capturedAt: z.iso.datetime(),
        kind: z.enum([
          "gameplay",
          "image",
          "audio",
          "state",
          "performance",
          "provenance",
          "inspection",
          "human-feedback",
        ]),
        scene: text,
        procedure: text,
        observation: text,
      }),
    )
    .max(500),
  gates: z
    .array(
      z.strictObject({
        id: z.enum(gateIds),
        result: z.enum(["pass", "fail", "unverified", "not_applicable"]),
        reason: text,
        evidence: references,
      }),
    )
    .length(gateIds.length),
  dimensions: z
    .array(
      z.strictObject({
        id: z.enum(dimensionIds),
        score: z.union([z.number().int().min(0).max(4), z.enum(["NV", "N/A"])]),
        observation: text,
        limitation: text,
        confidence: z.enum(["low", "medium", "high"]),
        judgment: z.enum(["human", "proxy"]),
        evidence: references,
      }),
    )
    .length(dimensionIds.length),
});

export type EvaluationReport = z.infer<typeof evaluationReport>;

function outside(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  );
}

/** Read-only: validates receipts, not whether the recorded observations are true. */
export async function validateEvaluationReport(
  input: unknown,
  artifactRoot: string,
) {
  const parsed = evaluationReport.safeParse(input);
  if (!parsed.success)
    return {
      recordValid: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
      recordedThresholdsMet: false,
      productAccepted: false as const,
    };
  const report = parsed.data;
  const issues: string[] = [];
  const evidence = new Map(report.evidence.map((item) => [item.id, item]));
  if (evidence.size !== report.evidence.length)
    issues.push("Duplicate evidence IDs");
  for (const [name, rows] of [
    ["gates", report.gates],
    ["dimensions", report.dimensions],
  ] as const) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      issues.push(`Duplicate ${name} IDs`);
  }
  const root = await realpath(artifactRoot);
  for (const item of report.evidence) {
    if (item.projectDigest !== report.projectDigest)
      issues.push(
        `${item.id}: evidence belongs to a different project snapshot`,
      );
    const path = resolve(root, item.file);
    if (isAbsolute(item.file) || outside(root, path)) {
      issues.push(
        `${item.id}: evidence path must be relative and inside the artifact directory`,
      );
      continue;
    }
    try {
      const actual = await realpath(path);
      if (outside(root, actual)) {
        issues.push(
          `${item.id}: evidence symlink leaves the artifact directory`,
        );
        continue;
      }
      if (!(await stat(actual)).isFile()) {
        issues.push(`${item.id}: evidence must be a file`);
        continue;
      }
      const hasher = createHash("sha256");
      for await (const chunk of createReadStream(actual)) hasher.update(chunk);
      const hash = hasher.digest("hex");
      if (hash !== item.sha256)
        issues.push(`${item.id}: evidence digest mismatch`);
    } catch (error) {
      issues.push(
        `${item.id}: cannot read evidence (${(error as NodeJS.ErrnoException).code ?? "error"})`,
      );
    }
  }
  const checkReferences = (
    label: string,
    refs: string[],
    required: boolean,
  ) => {
    if (required && refs.length === 0)
      issues.push(`${label}: evidence required`);
    if (new Set(refs).size !== refs.length)
      issues.push(`${label}: duplicate evidence references`);
    for (const id of refs)
      if (!evidence.has(id)) issues.push(`${label}: unknown evidence ${id}`);
  };
  for (const row of report.gates)
    checkReferences(
      row.id,
      row.evidence,
      ["pass", "fail"].includes(row.result),
    );
  for (const row of report.dimensions)
    checkReferences(row.id, row.evidence, typeof row.score === "number");
  checkReferences(
    "humanPlaytest",
    report.humanPlaytest.evidence,
    report.humanPlaytest.status === "completed",
  );
  if (
    report.humanPlaytest.status === "completed" &&
    !report.humanPlaytest.evidence.some(
      (id) => evidence.get(id)?.kind === "human-feedback",
    )
  ) {
    issues.push("humanPlaytest: completed requires human-feedback evidence");
  }
  const recordValid = issues.length === 0;
  return {
    recordValid,
    issues,
    recordedThresholdsMet:
      recordValid &&
      report.outcome === "complete" &&
      report.gates.every((row) =>
        ["pass", "not_applicable"].includes(row.result),
      ) &&
      report.gates.some((row) => row.result === "pass") &&
      report.dimensions.every(
        (row) =>
          row.score === "N/A" ||
          (typeof row.score === "number" && row.score >= 3),
      ) &&
      report.dimensions.some((row) => typeof row.score === "number"),
    humanPlaytest: report.humanPlaytest.status,
    productAccepted: false as const,
    limitation:
      "Only record structure, references and file digests were checked. Independent evidence review, applicability, repeated trials and human playtest determine product acceptance.",
  };
}

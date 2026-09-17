import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  validateEvaluationReport,
  type EvaluationReport,
} from "../evaluation/report.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openfun-evidence-"));
  const bytes =
    "Engineering fixture, not a generated-game quality observation.";
  await writeFile(join(root, "play.txt"), bytes);
  const report: EvaluationReport = {
    specification: "evaluation-v1.3",
    runId: "fixture",
    case: "A",
    phase: "first-delivery",
    projectDigest: "a".repeat(64),
    reviewer: "test fixture",
    outcome: "complete",
    humanPlaytest: { status: "pending", notes: "No human trial", evidence: [] },
    evidence: [
      {
        id: "play",
        file: "play.txt",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        projectDigest: "a".repeat(64),
        capturedAt: "2026-09-16T00:00:00Z",
        kind: "inspection",
        scene: "fixture",
        procedure: "fixture only",
        observation: "fixture only",
      },
    ],
    gates: ["G1", "G2", "G3", "G4", "G5", "G6", "G7"].map((id) => ({
      id: id as EvaluationReport["gates"][number]["id"],
      result: "pass",
      reason: "Test record only",
      evidence: ["play"],
    })),
    dimensions: [
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
    ].map((id) => ({
      id: id as EvaluationReport["dimensions"][number]["id"],
      score: 3,
      observation: "Test record only",
      limitation: "No actual game",
      confidence: "low",
      judgment: "proxy",
      evidence: ["play"],
    })),
  };
  return { root, report };
}

test("valid receipts never certify product quality or human enjoyment", async (t) => {
  const { root, report } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await validateEvaluationReport(report, root);
  assert.equal(result.recordValid, true);
  assert.equal(result.recordedThresholdsMet, true);
  assert.equal(result.productAccepted, false);
  assert.equal(result.humanPlaytest, "pending");
  report.dimensions[0]!.score = "NV";
  assert.equal(
    (await validateEvaluationReport(report, root)).recordedThresholdsMet,
    false,
  );
  report.dimensions[0]!.score = 3;
  report.gates[0]!.result = "fail";
  assert.equal(
    (await validateEvaluationReport(report, root)).recordedThresholdsMet,
    false,
  );
  report.gates[0]!.result = "pass";
  report.outcome = "incomplete";
  assert.equal(
    (await validateEvaluationReport(report, root)).recordedThresholdsMet,
    false,
  );
});

test("rejects stale, fabricated, incomplete and ambiguous evidence records", async (t) => {
  const { root, report } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const mutations: [string, (r: EvaluationReport) => void][] = [
    [
      "different project snapshot",
      (r) => {
        r.evidence[0]!.projectDigest = "b".repeat(64);
      },
    ],
    [
      "digest mismatch",
      (r) => {
        r.evidence[0]!.sha256 = "b".repeat(64);
      },
    ],
    [
      "cannot read",
      (r) => {
        r.evidence[0]!.file = "missing.txt";
      },
    ],
    [
      "Duplicate gates",
      (r) => {
        r.gates[1]!.id = "G1";
      },
    ],
    [
      "Duplicate dimensions",
      (r) => {
        r.dimensions[1]!.id = "Q1";
      },
    ],
    [
      "Duplicate evidence",
      (r) => {
        r.evidence.push({ ...r.evidence[0]! });
      },
    ],
    [
      "unknown evidence",
      (r) => {
        r.gates[0]!.evidence = ["invented"];
      },
    ],
    [
      "evidence required",
      (r) => {
        r.dimensions[0]!.evidence = [];
      },
    ],
    [
      "duplicate evidence references",
      (r) => {
        r.gates[0]!.evidence = ["play", "play"];
      },
    ],
    [
      "human-feedback",
      (r) => {
        r.humanPlaytest = {
          status: "completed",
          notes: "Claim only",
          evidence: ["play"],
        };
      },
    ],
  ];
  for (const [message, mutate] of mutations) {
    const copy = structuredClone(report);
    mutate(copy);
    const result = await validateEvaluationReport(copy, root);
    assert.equal(result.recordValid, false, message);
    assert.equal(result.recordedThresholdsMet, false, message);
    assert.ok(
      result.issues.some((issue) => issue.includes(message)),
      result.issues.join("; "),
    );
  }
  for (const specification of ["evaluation-v1.1", "evaluation-v1.2"]) {
    assert.equal(
      (await validateEvaluationReport({ ...report, specification }, root))
        .recordValid,
      false,
    );
  }
});

test("2D evaluation rejects deferred case B before reading a CLI or creating a trial", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../evaluation/run.mjs", import.meta.url)),
      "--case",
      "B",
      "--cli",
      "/nonexistent/openfun/dist/cli.js",
      "--model",
      "fixture",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Case B \(3D\) is deferred/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
});

test("evidence files cannot escape the run directory directly or through symlinks", async (t) => {
  const { root, report } = await fixture();
  const other = await mkdtemp(join(tmpdir(), "openfun-outside-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  });
  const external = join(other, "external.txt");
  await writeFile(external, "outside");
  await symlink(external, join(root, "linked.txt"));
  for (const file of [external, "../outside.txt", "linked.txt", "."]) {
    report.evidence[0]!.file = file;
    assert.equal(
      (await validateEvaluationReport(report, root)).recordValid,
      false,
      file,
    );
  }
});

test("review CLI reports valid low scores without accepting quality and fails on tampered evidence", async (t) => {
  const { root, report } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  report.dimensions[0]!.score = 1;
  const path = join(root, "review.json");
  await writeFile(path, JSON.stringify(report));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../evaluation/validate.ts", import.meta.url)),
        path,
      ],
      { encoding: "utf8" },
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).recordedThresholdsMet, false);
  assert.equal(JSON.parse(valid.stdout).productAccepted, false);
  await writeFile(join(root, "play.txt"), "Changed after review");
  const invalid = run();
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).recordValid, false);
  await writeFile(path, "{broken");
  assert.equal(run().status, 1);
});

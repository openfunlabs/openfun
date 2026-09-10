import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frameIntervalSummary,
  frameBudgetSummary,
  parsePreviewOptions,
} from "../../src/godot/capture-options.js";

test("capture schedules are bounded and ordered without changing caller inputs", () => {
  const inputs = [
    { kind: "key" as const, at: 2, name: "Space", pressed: false },
    { kind: "key" as const, at: 1, name: "Space", pressed: true },
  ];
  const parsed = parsePreviewOptions({ inputs, captureTimes: [0.5, 1.5, 3] });
  assert.deepEqual(
    parsed.inputs.map((i) => i.at),
    [1, 2],
  );
  assert.equal(inputs[0]!.at, 2);
  assert.throws(
    () => parsePreviewOptions({ seconds: 2, captureTimes: [1, 1] }),
    /increase/,
  );
  assert.throws(
    () => parsePreviewOptions({ seconds: 2, inputs }),
    /before the end/,
  );
  assert.throws(() => parsePreviewOptions({ seconds: 121 }));
  assert.throws(
    () =>
      parsePreviewOptions({
        width: 320,
        inputs: [
          {
            at: 0,
            kind: "mouse_button",
            button: 1,
            pressed: true,
            position: [320, 0],
          },
        ],
      }),
    /viewport/,
  );
  assert.throws(() => parsePreviewOptions({ captureTimes: Array(7).fill(1) }));
  assert.deepEqual(parsePreviewOptions({}).captureTimes, [3]);
});

test("frame timing exposes spikes and does not claim zero latency without samples", () => {
  const samples = [...Array(98).fill(16), 60, 120];
  assert.deepEqual(frameIntervalSummary(samples), {
    samples: 100,
    p50Ms: 16,
    p95Ms: 16,
    p99Ms: 60,
    maxMs: 120,
    over50Ms: 2,
  });
  assert.equal(frameIntervalSummary([]).p95Ms, null);
  assert.throws(() => frameIntervalSummary([NaN]));
  assert.throws(() => frameIntervalSummary([-1]));
});

test("preview mode defaults to headless and permits agent-selected rendering", () => {
  assert.equal(parsePreviewOptions({}).mode, "headless");
  assert.equal(parsePreviewOptions({ mode: "windowed" }).mode, "windowed");
  assert.throws(() => parsePreviewOptions({ mode: "auto" } as never));
});

test("performance diagnostics support capture-free routes and explicit warmup", () => {
  const p = parsePreviewOptions({
    mode: "windowed",
    seconds: 60,
    warmupSeconds: 5,
    captureTimes: [],
  });
  assert.deepEqual(p.captureTimes, []);
  assert.equal(p.seconds, 60);
  assert.throws(
    () => parsePreviewOptions({ seconds: 2, warmupSeconds: 3 }),
    /Warmup/,
  );
  const b = frameBudgetSummary([10, 20, 40, 120], 50);
  assert.equal(b.overBudget, 2);
  assert.equal(b.overBudgetPercent, 50);
  assert.equal(b.overTwoBudgets, 1);
  assert.equal(b.over100Ms, 1);
  assert.equal(b.measuredSeconds, 0.19);
  assert.equal(frameBudgetSummary([], 60).p95WithinBudget, null);
  assert.throws(() => frameBudgetSummary([NaN], 60));
});

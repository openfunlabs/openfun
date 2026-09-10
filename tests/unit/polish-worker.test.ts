import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import workerExtension from "../../src/polish/worker-extension.js";

test("worker requires an error-free rendered preview after edits and blocks changes after reporting", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "openfun-polish-report-"));
  await mkdir(join(cwd, ".openfun"));
  const previous = process.env.OPENFUN_POLISH_WORKER;
  process.env.OPENFUN_POLISH_WORKER = "1";
  t.after(async () => {
    if (previous === undefined) delete process.env.OPENFUN_POLISH_WORKER;
    else process.env.OPENFUN_POLISH_WORKER = previous;
    await rm(cwd, { recursive: true, force: true });
  });
  const hooks = new Map<string, Function>();
  let tool: any;
  workerExtension({
    on: (event: string, handler: Function) => hooks.set(event, handler),
    registerTool: (definition: unknown) => {
      tool = definition;
    },
  } as unknown as ExtensionAPI);
  const ctx = { cwd } as ExtensionContext;
  const report = {
    outcome: "finished",
    summary: "Improved UI",
    checks: ["Inspected actual gameplay"],
    remaining: [],
  };
  const finish = () =>
    tool.execute("report", report, undefined, undefined, ctx);
  await assert.rejects(finish(), /preview/);
  const preview = (errors: string[] = []) =>
    hooks.get("tool_result")!({
      toolName: "world_preview_game",
      isError: false,
      content: [
        {
          type: "text",
          text: JSON.stringify({ frames: [{}], consoleErrors: errors }),
        },
        { type: "image", data: "fixture", mimeType: "image/png" },
      ],
    });
  preview(["SCRIPT ERROR"]);
  await assert.rejects(finish(), /preview/);
  preview();
  hooks.get("tool_result")!({ toolName: "edit", isError: false });
  await assert.rejects(finish(), /preview/);
  preview();
  await finish();
  assert.equal(hooks.get("tool_call")!({ toolName: "write" }).block, true);
});

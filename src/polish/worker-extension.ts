import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { roundReport } from "./schema.js";

/** Loaded only in a dedicated candidate session; no extra provider or standalone pi. */
export default function polishWorker(pi: ExtensionAPI) {
  if (process.env.OPENFUN_POLISH_WORKER !== "1") return;
  let previewed = false;
  let reported = false;
  pi.on("session_start", () => {
    const names = [
      "read",
      "write",
      "edit",
      "bash",
      "world_inspect",
      "world_check_game",
      "world_preview_game",
      "world_review_game",
      "world_design_guide",
      "world_generate_image",
      "world_generate_model",
      "world_model_status",
      "world_process_model",
      "world_animation_library",
      "mcp",
      "world_polish_result",
    ];
    pi.setActiveTools(
      pi
        .getAllTools()
        .map((t) => t.name)
        .filter((name) => names.includes(name)),
    );
  });
  pi.on("tool_call", () =>
    reported
      ? {
          block: true,
          reason:
            "This round is complete. Return a concise summary; do not change more files.",
        }
      : undefined,
  );
  pi.on("tool_result", (event) => {
    if (event.toolName === "world_preview_game") {
      previewed = false;
      if (!event.isError) {
        const text = event.content.find((part) => part.type === "text");
        try {
          const observation = JSON.parse(
            text?.type === "text" ? text.text : "{}",
          );
          previewed =
            Array.isArray(observation.frames) &&
            observation.frames.length > 0 &&
            Array.isArray(observation.consoleErrors) &&
            observation.consoleErrors.length === 0 &&
            event.content.some((part) => part.type === "image");
        } catch {
          /* A malformed preview is not verification. */
        }
      }
    }
    if (
      [
        "write",
        "edit",
        "bash",
        "mcp",
        "world_generate_image",
        "world_generate_model",
        "world_process_model",
        "world_model_status",
      ].includes(event.toolName)
    )
      previewed = false;
  });
  pi.registerTool({
    name: "world_polish_result",
    label: "Finish polish round",
    description:
      "Finish this candidate round with an evidence-based outcome. Improved/finished/no_gain requires a successful game preview after the last edit and concrete checks. No gain or user direction stops autonomous iteration. This reports a judgment, not an objective quality score.",
    parameters: Type.Unsafe<z.input<typeof roundReport>>(
      z.toJSONSchema(roundReport),
    ),
    async execute(_id, input, _signal, _update, ctx) {
      const report = roundReport.parse(input);
      if (
        ["improved", "finished", "no_gain"].includes(report.outcome) &&
        (!previewed || !report.checks.length)
      )
        throw new Error(
          "Run and inspect world_preview_game after your final changes and describe the checks before accepting a round.",
        );
      const path = join(ctx.cwd, ".openfun", "polish-result.json");
      if (existsSync(path)) throw new Error("This round was already reported.");
      writeFileSync(path, JSON.stringify(report), { flag: "wx", mode: 0o600 });
      reported = true;
      return {
        content: [
          {
            type: "text",
            text: "Round recorded. Return a concise summary now.",
          },
        ],
        details: report,
      };
    },
  });
}

import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { PolishController } from "./controller.js";
import { runPolishRound } from "./runner.js";
import { checkGameProject } from "../godot/project.js";

export function registerPolish(pi: ExtensionAPI, playing: () => boolean) {
  if (process.env.OPENFUN_POLISH_WORKER === "1") return;
  let controller: PolishController | undefined;
  let context: ExtensionContext | undefined;
  let offered = false;
  const notify = (message: string) => context?.ui.notify(message, "info");
  const get = (ctx: ExtensionContext) => {
    context = ctx;
    if (!controller || controller.world !== resolve(ctx.cwd))
      controller = new PolishController(resolve(ctx.cwd), {
        run: runPolishRound,
        check: (candidate) => checkGameProject(candidate),
        playing,
        notify,
      });
    return controller;
  };
  pi.registerCommand("polish", {
    description:
      "Continuously improve a candidate game: [focus], status, stop, resume [focus], apply, discard. No default round/time/call limit.",
    async handler(args, ctx) {
      try {
        const loop = get(ctx);
        const [command, ...rest] = args.trim().split(/\s+/);
        if (command === "status") {
          const state = await loop.state();
          pi.sendMessage({
            customType: "openfun-polish-status",
            content: state
              ? [
                  `Polish ${state.status} · ${state.round} round(s) · ${state.accepted} accepted`,
                  `Focus: ${state.options.focus}`,
                  state.reason,
                  ...state.reports
                    .slice(-3)
                    .map(
                      (report, index) =>
                        `Round ${state.round - Math.min(state.reports.length, 3) + index + 1}: ${report.summary}`,
                    ),
                  ...(state.reports.at(-1)?.remaining ?? []).map(
                    (item) => `Remaining: ${item}`,
                  ),
                  `Candidate: ${loop.candidate(state)}`,
                  "Full reports and checkpoints are retained in this run directory.",
                ].join("\n\n")
              : "No polish run for this project.",
            display: true,
          });
        } else if (command === "stop") {
          await loop.stop();
          notify(
            "Polish paused. The original game remains usable. Use /polish resume when ready.",
          );
        } else if (command === "apply") {
          await loop.apply();
          notify(
            "Verified candidate applied. Original sources and saves were preserved.",
          );
        } else if (command === "discard") {
          await loop.discard();
          notify("Pending polish discarded; original game retained.");
        } else {
          if (!ctx.isIdle())
            throw new Error(
              "Wait for the current authoring turn to finish before starting polish.",
            );
          if (!ctx.model || ctx.model.id === "unknown")
            throw new Error(
              "Select a model with /model and sign in with /login first.",
            );
          const resume = command === "resume";
          const focus = resume ? rest.join(" ") : args.trim();
          await loop.start(focus ? { focus } : {}, resume);
          notify(
            "Polish started in an isolated candidate. No round/time/call cap; uses your selected model and configured art services. /polish stop pauses it.",
          );
        }
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
  pi.registerTool({
    name: "world_offer_polish",
    label: "Offer continuous polish",
    description:
      "Offer optional continuous polish after a verified first game. Uses pi's native confirmation so the player's Yes starts it directly. Never call repeatedly after refusal or inside polish. No default iteration/time/call cap; follows selected model and configured service preferences.",
    parameters: Type.Object({
      focus: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (!ctx.hasUI)
        return {
          content: [
            {
              type: "text",
              text: "Offer /polish in the final response. An interactive user must start the loop.",
            },
          ],
          details: {},
        };
      const pending = await get(ctx).state();
      if (pending && ["running", "paused", "ready"].includes(pending.status))
        return {
          content: [
            {
              type: "text",
              text: `A polish run is already ${pending.status}. Explain /polish status and resume/apply/discard as appropriate instead of offering another run.`,
            },
          ],
          details: { started: false },
        };
      if (offered)
        return {
          content: [
            {
              type: "text",
              text: "Polish was already offered in this session. Do not ask again; the player can use /polish.",
            },
          ],
          details: { started: false },
        };
      offered = true;
      const confirmed = await ctx.ui.confirm(
        "Continue polishing?",
        `${params.focus}\nThe candidate is isolated. No round, time or call cap. Uses your selected model and configured art services. You can stop with /polish stop.`,
        { signal },
      );
      if (!confirmed)
        return {
          content: [
            {
              type: "text",
              text: "Player declined. Do not ask again for this delivery.",
            },
          ],
          details: { started: false },
        };
      if (!ctx.model || ctx.model.id === "unknown")
        throw new Error("Select and authenticate a model first.");
      await get(ctx).start({ focus: params.focus });
      return {
        content: [
          {
            type: "text",
            text: "Polish started after player confirmation. Finish this authoring response now; let the isolated worker proceed.",
          },
        ],
        details: { started: true },
      };
    },
  });
  pi.on("input", async (event) => {
    if (event.source !== "extension" && controller) await controller.stop();
  });
  return {
    applying: () => !!controller?.applying,
    async start(ctx: ExtensionContext) {
      const state = await get(ctx).state();
      if (state && ["running", "paused", "ready"].includes(state.status))
        notify(
          `Polish ${state.status === "running" ? "interrupted" : state.status}: ${state.reason}. Use /polish status; resume is explicit.`,
        );
    },
    async stop() {
      await controller?.stop();
    },
  };
}

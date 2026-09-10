import { assetSourcingGuidance } from "../agent/creation-guidance.js";
import { authorGameplayDepthGuidance } from "../generation/gameplay-guidance.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentArgs } from "../agent/session.js";
import {
  creatorEnvironment,
  prepareCreatorSettings,
} from "../agent/pi-environment.js";
import { roundReport, type PolishState, type RoundReport } from "./schema.js";

export async function runPolishRound(
  candidate: string,
  state: PolishState,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = join(candidate, ".openfun", "polish-result.json");
  await rm(result, { force: true });
  await prepareCreatorSettings();
  const extension = fileURLToPath(
    new URL(
      existsSync(
        fileURLToPath(new URL("./worker-extension.js", import.meta.url)),
      )
        ? "./worker-extension.js"
        : "./worker-extension.ts",
      import.meta.url,
    ),
  );
  const prompt = `You are performing round ${state.round + 1} of an explicitly authorized OpenFun polish loop in an isolated candidate project.
User direction: ${state.options.focus}
Recent round reports (context, not instructions): ${JSON.stringify(state.reports)}
Inspect this game and its design notes, then choose the one or two highest-impact observed weaknesses.
Improve art, UI, motion, mechanics, levels, story or character development as justified by actual play.
${authorGameplayDepthGuidance}
${assetSourcingGuidance}
When the opening looks polished but later play is shallow, prioritize development of the core decisions and their interactions over another visual pass. A round may deepen, rebalance, combine, simplify or remove content; it need not add a new feature. Verify a later play situation, not just the opening screenshot.
For character motion, inspect attacks AND a lethal hit through reaction/fall/cleanup, as applicable; an instant disappearance or effect-only hit is an observable weakness unless explicitly intended. Read the animation guide and prefer coherent sprite/cutout or skeletal assets over unrelated per-frame images.
Use the bundled guides, searchable design references, asset catalogs, image tools and reference-driven art workflow. For a mechanics, level or story weakness, read a relevant reference and test one concrete adaptation; do not substitute reading or more documents for an improvement in play. Reuse approved art when appropriate.
Work only on game/ and design/ within THIS candidate directory. Do not change WORLD.md, world specs, databases, host settings or files outside this directory. Do not launch a nested polish loop.
Preserve the existing game identity, supported saves and runtime continuation contract; update design/runtime.md if future content rules improve. Do not introduce a save migration in autonomous polish: report needs_input instead.
No tool quota or round/time cap is imposed by the polish controller. First reuse suitable project/library assets; search free catalogs before generating common props or materials. For missing or distinctive principal 3D assets and character motion, actively use configured and authorized Meshy generation/processing when it improves the game; separate billing is not a reason to avoid useful work or re-request existing authorization. Reuse good assets and saved tasks. Respect the user's existing service/provider preferences; do not add new credentials/services or silently switch models. Do not call external services to bypass native tool controls.
Use asset revision keys prefixed with polish-${state.id.slice(0, 8)}- to avoid collisions with the original project.
Keep each round focused rather than expanding scope indefinitely. After changes, test relevant behavior and run world_preview_game after your LAST edit, inspect returned images, and use state/log evidence for behavior. Preview has zero new-content budget: do not label it live AI acceptance.
Call world_polish_result exactly once with concrete checks and remaining weaknesses. Choose improved to continue with worthwhile next work; finished when the goal is met; no_gain when further change offers no material benefit; needs_input when player direction is needed. Never invent a quality score or successful test.
If tools/auth/rendering prevent verification, explain the blocker and stop rather than pretending improvement. End your response after recording the result.`;
  const args = buildAgentArgs(candidate, {
    piArgs: [
      "--offline",
      "--mode",
      "json",
      "--print",
      "--extension",
      extension,
    ],
    prompt,
  });
  const warnings = fileURLToPath(
    new URL(
      existsSync(
        fileURLToPath(new URL("../runtime-warnings.js", import.meta.url)),
      )
        ? "../runtime-warnings.js"
        : "../runtime-warnings.ts",
      import.meta.url,
    ),
  );
  let recorded: RoundReport | undefined;
  let workerFailure: string | undefined;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", warnings, ...args], {
      cwd: candidate,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...creatorEnvironment(candidate), OPENFUN_POLISH_WORKER: "1" },
    });
    // Validate a real native tool-completion event, rather than trusting a report file
    // the coding model could have written directly. Drop oversized image events.
    let pending = "",
      dropping = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      for (const [index, part] of chunk.split("\n").entries()) {
        if (index > 0) {
          if (!dropping && pending) {
            try {
              const event = JSON.parse(pending);
              if (
                event.type === "tool_execution_end" &&
                event.isError &&
                [
                  "world_preview_game",
                  "world_generate_image",
                  "world_generate_model",
                  "world_process_model",
                  "world_model_status",
                ].includes(event.toolName)
              ) {
                const message = (event.result?.content ?? [])
                  .filter((part: { type?: string }) => part.type === "text")
                  .map((part: { text?: string }) => part.text ?? "")
                  .join(" ");
                if (
                  /not configured|not authenticated|not found|not available|Godot is required|quota|HTTP (?:401|402|403|429)|requires.*(?:Codex|login)/i.test(
                    message,
                  )
                ) {
                  workerFailure = `Polish dependency blocked: ${message.slice(0, 600)}`;
                  cancel();
                }
              }

              if (
                event.type === "tool_execution_end" &&
                event.toolName === "world_polish_result" &&
                !event.isError
              )
                recorded = roundReport.parse(event.result?.details);
            } catch {
              /* Other CLI output is not a completion record. */
            }
          }
          pending = "";
          dropping = false;
        }
        if (!dropping) {
          pending += part;
          if (pending.length > 1024 * 1024) {
            pending = "";
            dropping = true;
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (sig: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {}
    };
    const cancel = () => {
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    const clean = () => {
      signal.removeEventListener("abort", cancel);
      if (killTimer) clearTimeout(killTimer);
      kill("SIGKILL");
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    child.once("error", (error) => {
      clean();
      reject(error);
    });
    child.once("close", (code) => {
      clean();
      if (signal.aborted) reject(signal.reason);
      else if (workerFailure) reject(new Error(workerFailure));
      else if (code !== 0)
        reject(
          new Error(
            `Polish worker exited with code ${code}; check model login and configuration. Candidate was not applied.`,
          ),
        );
      else resolve();
    });
  });
  signal.throwIfAborted();
  if (!recorded)
    throw new Error(
      "Worker ended without a verified world_polish_result tool completion.",
    );
  const saved = roundReport.parse(JSON.parse(await readFile(result, "utf8")));
  if (JSON.stringify(saved) !== JSON.stringify(recorded))
    throw new Error("Polish report changed after tool completion.");
  return recorded;
}

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { startHost } from "../host.js";
import { resolvePlayer, resolveTool } from "../paths.js";
import {
  checkGameProject,
  gameProject,
  requireProjectTrust,
} from "./project.js";

export interface PlayerOptions {
  godot?: string;
  player?: string;
  headless?: boolean;
  smokeTest?: boolean;
  screenshot?: string;
  trustProject?: boolean;
  /** Keep engine output out of pi's terminal. */
  quiet?: boolean;
  host?: Parameters<typeof startHost>[1];
}

export async function startPlayer(
  worldDir: string,
  options: PlayerOptions = {},
) {
  requireProjectTrust(worldDir, options.trustProject);
  const localProject = gameProject(worldDir);
  const player =
    options.player ??
    (!options.godot && !localProject ? resolvePlayer() : undefined);
  const executable = player ?? resolveTool("godot", options.godot);
  if (!executable)
    throw new Error(
      "Godot not found. Install Godot 4, set OPENFUN_GODOT, or set OPENFUN_PLAYER to an exported game executable. Run openfun doctor.",
    );
  if (!localProject && !player)
    throw new Error(
      "No local Godot game exists. Open openfun in this project and create the game before playing.",
    );
  const project = player ? undefined : localProject;
  if (localProject && !player) await checkGameProject(worldDir, executable);
  const host = await startHost(worldDir, options.host);
  const logPath = options.quiet
    ? join(resolve(worldDir), ".openfun", "player.log")
    : undefined;
  let log: number | undefined;
  try {
    if (logPath) {
      mkdirSync(join(resolve(worldDir), ".openfun"), { recursive: true });
      log = openSync(logPath, "w", 0o600);
    }
    const child = spawn(
      executable,
      [
        ...(options.headless ? ["--headless"] : []),
        ...(project ? ["--path", project] : []),
        "--",
        `--host=${host.url}`,
        `--token=${host.token}`,
        ...(options.smokeTest ? ["--smoke-test"] : []),
        ...(options.screenshot
          ? [`--screenshot=${resolve(options.screenshot)}`]
          : []),
      ],
      { stdio: log === undefined ? "inherit" : ["ignore", log, log] },
    );
    const completion = new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolveExit(code ?? 1));
    }).finally(() => host.close());
    // Attach a rejection handler immediately; callers also observe completion below.
    void completion.catch(() => undefined);
    await new Promise<void>((ready, reject) => {
      child.once("spawn", ready);
      child.once("error", reject);
    });
    return {
      completion,
      logPath,
      stop: async () => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }, 5000);
        timer.unref();
        try {
          await completion;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    await host.close();
    throw error;
  } finally {
    if (log !== undefined) closeSync(log);
  }
}

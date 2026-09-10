import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rememberWorld } from "../world/library.js";
import { ensureGameProject } from "../godot/project.js";
import {
  bundledPlugins,
  creatorEnvironment,
  prepareCreatorSettings,
} from "./pi-environment.js";

export interface AgentOptions {
  /** Native pi flags, for example --provider, --model, --thinking, or -p. */
  piArgs?: string[];
  /** Optional explicit first message. Opening a world alone never calls a model. */
  prompt?: string;
}

/** Resolve the installed, version-pinned pi CLI rather than relying on PATH. */
export function getPiCli(): string {
  const entry = fileURLToPath(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const cli = join(dirname(entry), "bundle", "cli.js");
  if (!existsSync(cli)) {
    throw new Error(
      "The installed pi package is incomplete. Run pnpm install again.",
    );
  }
  return cli;
}

function extensionPath(): string {
  for (const extension of ["js", "ts"]) {
    const path = fileURLToPath(
      new URL(`./extension.${extension}`, import.meta.url),
    );
    if (existsSync(path)) return path;
  }
  throw new Error("OpenFun world extension is missing. Run pnpm build.");
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

export interface ModelPreferences {
  provider: string;
  model: string;
  thinkingLevel?: string;
}

export function readModelPreferences(
  worldDir: string,
): ModelPreferences | undefined {
  try {
    const file = join(resolve(worldDir), ".openfun", "agent.json");
    if (statSync(file).size > 8192) return undefined;
    const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!saved || typeof saved !== "object") return undefined;
    const { provider, model, thinkingLevel } = saved as Record<string, unknown>;
    const validName = (value: unknown): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      !/[\u0000-\u001f\u007f]/.test(value);
    if (!validName(provider) || !validName(model)) return undefined;
    // Pi exposes this sentinel when no provider has an available model yet.
    if (provider === "unknown" && model === "unknown") return undefined;
    return {
      provider,
      model,
      ...(typeof thinkingLevel === "string" &&
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
        thinkingLevel,
      )
        ? { thinkingLevel }
        : {}),
    };
  } catch {
    // Missing or damaged local preferences fall back to pi's own defaults.
    return undefined;
  }
}

function savedModelArgs(worldDir: string, userArgs: string[]): string[] {
  if (hasFlag(userArgs, "--provider") || hasFlag(userArgs, "--model"))
    return [];
  const saved = readModelPreferences(worldDir);
  if (!saved) return [];
  return [
    "--provider",
    saved.provider,
    "--model",
    saved.model,
    ...(!hasFlag(userArgs, "--thinking") && saved.thinkingLevel
      ? ["--thinking", saved.thinkingLevel]
      : []),
  ];
}

export function buildAgentArgs(
  worldDir: string,
  options: AgentOptions = {},
): string[] {
  const plugins = bundledPlugins(options.piArgs);
  const args = [
    getPiCli(),
    "--extension",
    extensionPath(),
    ...plugins.flatMap((plugin) =>
      plugin.enabled && !plugin.overridden ? ["--extension", plugin.path] : [],
    ),
    "--session-dir",
    join(resolve(worldDir), ".openfun", "sessions"),
    ...savedModelArgs(worldDir, options.piArgs ?? []),
    ...(options.piArgs ?? []),
  ];
  if (options.prompt !== undefined) args.push("--", options.prompt);
  return args;
}

/**
 * Use the bundled pi terminal and tools with OpenFun-owned settings and credentials.
 * Only world-specific sessions and non-secret model preferences live in the world.
 */
export async function launchAgent(
  worldDir: string,
  options: AgentOptions = {},
): Promise<number> {
  const cwd = realpathSync(resolve(worldDir));
  await ensureGameProject(cwd);
  rememberWorld(cwd);
  mkdirSync(join(cwd, ".openfun", "sessions"), { recursive: true });
  await prepareCreatorSettings();
  const args = buildAgentArgs(cwd, options);
  return new Promise<number>((resolveExit, reject) => {
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
    const child = spawn(process.execPath, ["--import", warnings, ...args], {
      cwd,
      stdio: "inherit",
      env: creatorEnvironment(cwd),
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      resolveExit(code ?? (signal === "SIGINT" ? 130 : 1));
    });
  });
}

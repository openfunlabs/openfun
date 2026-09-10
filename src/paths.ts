import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

function toolConfig(): Record<string, string> {
  let config: Record<string, string> = {};
  for (const file of [
    join(process.env.OPENFUN_HOME ?? join(homedir(), ".openfun"), "tools.json"),
  ]) {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (raw && typeof raw === "object")
        for (const key of ["blender", "godot", "player"]) {
          const value = (raw as Record<string, unknown>)[key];
          if (typeof value === "string") config[key] = value;
        }
    } catch {
      /* Optional development/user configuration. */
    }
  }
  return config;
}

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "package.json"))) {
  const parent = dirname(root);
  if (parent === root) throw new Error("Cannot locate Openfun installation");
  root = parent;
}
export const projectRoot = root;
export function resolvePlayer(): string | undefined {
  const local = toolConfig();
  const candidate = process.env.OPENFUN_PLAYER ?? local.player;
  return candidate && existsSync(candidate) ? candidate : undefined;
}
export function resolveTool(
  tool: "blender" | "godot",
  override?: string,
): string | undefined {
  const envName = `OPENFUN_${tool.toUpperCase()}`;
  const local = toolConfig();
  const candidates = [
    override,
    process.env[envName],
    local[tool],
    tool === "blender"
      ? "/Applications/Blender.app/Contents/MacOS/Blender"
      : "/Applications/Godot.app/Contents/MacOS/Godot",
    tool,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status === 0) return candidate;
  }
  return undefined;
}

/** Remember detected executables outside the npm installation; never pack host paths. */
export function saveToolConfiguration() {
  const home = process.env.OPENFUN_HOME ?? join(homedir(), ".openfun");
  mkdirSync(home, { recursive: true });
  const path = join(home, "tools.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid OpenFun tools.json");
    existing = value as Record<string, unknown>;
  }
  const detected = {
    blender: resolveTool("blender"),
    godot: resolveTool("godot"),
    player: resolvePlayer(),
  };
  for (const key of ["blender", "godot", "player"] as const)
    if (detected[key]) existing[key] = detected[key];
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(existing, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temporary, path);
  return { configuration: path, ...detected };
}

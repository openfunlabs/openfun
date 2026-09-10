import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  truncateToVisualLines,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { projectRoot } from "../paths.js";
import {
  agentDirectory,
  bundledPiRoot,
  bundledPlugins,
} from "./pi-environment.js";

export function openfunVersion(): string {
  return JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"))
    .version;
}
function plain(value: string): string {
  return value.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    " ",
  );
}
export function headerLines(
  theme: Theme,
  worldName: string,
  worldDir: string,
  width: number,
): string[] {
  const lines = [
    theme.bold(theme.fg("accent", "OpenFun")) +
      theme.fg("dim", `  v${openfunVersion()}`),
    theme.fg("text", plain(worldName)),
    theme.fg("dim", plain(worldDir)),
    "",
    theme.fg("dim", "Type / for commands."),
  ];
  return lines.flatMap(
    (line) =>
      truncateToVisualLines(line, 1000, Math.max(1, width), 0).visualLines,
  );
}
export function installOpenfunHeader(
  ctx: ExtensionContext,
  worldName: string,
  worldDir: string,
) {
  if (ctx.mode !== "tui") return;
  ctx.ui.setHeader((_tui, theme) => ({
    render: (width) => headerLines(theme, worldName, worldDir, width),
    invalidate() {},
  }));
  ctx.ui.setTitle(`OpenFun · ${plain(worldName)}`);
}
export function aboutOpenfun(worldDir: string) {
  const piVersion = JSON.parse(
    readFileSync(join(bundledPiRoot(), "package.json"), "utf8"),
  ).version;
  return [
    `OpenFun v${openfunVersion()}`,
    "Game creation and play CLI · Godot + Blender",
    `Current project: ${plain(worldDir)}`,
    `Settings and credentials: ${agentDirectory()}`,
    "",
    `Bundled agent engine: pi ${piVersion} (included with OpenFun)`,
    `Plugin configuration: ${bundledPlugins()
      .map(
        (p) =>
          `${p.name} ${p.enabled ? (p.overridden ? "custom override" : "enabled") : "disabled"}`,
      )
      .join(" · ")}`,
    "Plugin load errors appear in startup diagnostics. Configure startup details in /settings.",
    "OpenFun uses its own settings and credentials, independently of standalone pi installations.",
    "Third-party components and licenses: THIRD_PARTY_NOTICES.md.",
  ].join("\n");
}

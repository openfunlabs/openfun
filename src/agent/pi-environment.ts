import {
  existsSync,
  readFileSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
  cpSync,
  renameSync,
} from "node:fs";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "../paths.js";
import { openfunHome } from "../world/library.js";

/** OpenFun never discovers or imports a standalone pi profile. */
export function agentDirectory(): string {
  return join(openfunHome(), "agent");
}

export function bundledPiRoot(): string {
  return dirname(
    dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    ),
  );
}

/** pi's supported branding manifest changes project discovery to .openfun.
 * Resource junctions point only to our pinned dependency, never a global install.
 */
export function preparePiPackage(): string {
  const root = realpathSync(bundledPiRoot());
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const product = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  );
  const identity = createHash("sha256")
    .update(`${root}:${manifest.version}:openfun-${product.version}`)
    .digest("hex")
    .slice(0, 12);
  const target = join(openfunHome(), "runtime", `pi-${identity}`);
  mkdirSync(target, { recursive: true });
  for (const name of ["dist", "docs", "examples"]) {
    const source = join(root, name),
      link = join(target, name);
    if (!existsSync(source)) continue;
    if (existsSync(link) && realpathSync(link) === realpathSync(source))
      continue;
    rmSync(link, { force: true, recursive: true });
    symlinkSync(
      source,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const name of ["README.md", "README.zh-CN.md"]) {
    // Keep repository links branch-relative in source. Runtime docs belong to pi.
    const readme = readFileSync(join(projectRoot, name), "utf8").replace(
      /\]\((docs\/[^)]+|CONTRIBUTING\.md|LICENSE|THIRD_PARTY_NOTICES\.md)\)/g,
      "](https://github.com/openfunlabs/openfun/blob/main/$1)",
    );
    writeFileSync(join(target, name), readme);
  }
  // Keep the engine's real VERSION for its protocol/internal logic. Its release
  // notes are not OpenFun release notes; /about exposes both product identities.
  writeFileSync(
    join(target, "CHANGELOG.md"),
    "# OpenFun\n\nSee OpenFun's README and /about for product information.\n",
  );
  const branded = JSON.stringify({
    ...manifest,
    piConfig: { name: "OpenFun", configDir: ".openfun" },
  });
  const file = join(target, "package.json");
  if (!existsSync(file) || readFileSync(file, "utf8") !== branded)
    writeFileSync(file, branded);
  return target;
}

/** Upstream 2.32.1 hard-codes OS keyring service names. Patch an isolated
 * cached copy, retaining its license and resolving dependencies from our install.
 * Neither the installed dependency nor any standalone pi files are modified.
 */
function isolatedMcpExtension(): string {
  const source = dirname(
    realpathSync(fileURLToPath(import.meta.resolve("pi-mcp-adapter"))),
  );
  const scope = createHash("sha256")
    .update(openfunHome())
    .digest("hex")
    .slice(0, 16);
  const version = JSON.parse(
    readFileSync(join(source, "package.json"), "utf8"),
  ).version;
  const id = createHash("sha256")
    .update(`${source}:${version}:openfun-keyring-v1`)
    .digest("hex")
    .slice(0, 12);
  const target = join(openfunHome(), "runtime", `mcp-${id}`);
  if (existsSync(join(target, "index.ts"))) return join(target, "index.ts");
  const temporary = `${target}-${randomUUID()}`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    cpSync(source, temporary, {
      recursive: true,
      filter: (path) =>
        path === source ||
        !path
          .slice(source.length + 1)
          .split(/[\\/]/)
          .includes("node_modules"),
    });
    for (const name of [
      "mcp-auth.ts",
      "mcp-bearer-store.ts",
      "dist/mcp-bearer-store.js",
    ]) {
      const file = join(temporary, name);
      const text = readFileSync(file, "utf8");
      if (!/pi-mcp-adapter\.(oauth|bearer)/.test(text))
        throw new Error(
          `Bundled MCP credential isolation needs review: ${name}`,
        );
      writeFileSync(
        file,
        text
          .replaceAll("pi-mcp-adapter.oauth", `openfun.${scope}.mcp.oauth`)
          .replaceAll("pi-mcp-adapter.bearer", `openfun.${scope}.mcp.bearer`),
      );
    }
    symlinkSync(
      dirname(source),
      join(temporary, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (!existsSync(join(target, "index.ts"))) throw error;
    }
    return join(target, "index.ts");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Persist only a default through pi's locked settings writer. projectTrusted:false
 * prevents even reading standalone .pi project settings in this unbranded host process.
 */
export async function prepareCreatorSettings(): Promise<void> {
  const settings = SettingsManager.create(openfunHome(), agentDirectory(), {
    projectTrusted: false,
  });
  const errors = settings.drainErrors();
  if (errors.length)
    throw new Error(
      `OpenFun settings could not be read: ${errors.map((item) => item.error.message).join("; ")}`,
    );
  if (settings.getGlobalSettings().quietStartup === undefined) {
    settings.setQuietStartup(true);
    await settings.flush();
    const failures = settings.drainErrors();
    if (failures.length)
      throw new Error(
        `OpenFun startup preference could not be saved: ${failures.map((item) => item.error.message).join("; ")}`,
      );
  }
}

export function creatorEnvironment(worldDir: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("PI_") && key !== "OPENFUN_AGENT_DIR",
    ),
  );
  return {
    ...env,
    OPENFUN_WORLD_DIR: worldDir,
    OPENFUN_HOME: openfunHome(),
    OPENFUN_CODING_AGENT_DIR: agentDirectory(),
    OPENFUN_CODING_AGENT_SESSION_DIR: join(worldDir, ".openfun", "sessions"),
    PI_PACKAGE_DIR: preparePiPackage(),
    PI_SKIP_VERSION_CHECK: "1",
    CONTEXT_MODE_DATA_DIR: join(openfunHome(), "cache"),
  };
}

/** Background tasks read only OpenFun's model defaults, not pi project settings. */
export function modelDefaults(): Pick<
  NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>,
  "defaultProvider" | "defaultModel" | "defaultThinkingLevel"
> {
  const file = join(agentDirectory(), "settings.json");
  if (!existsSync(file)) return {};
  const config = JSON.parse(readFileSync(file, "utf8"));
  return {
    ...(typeof config?.defaultProvider === "string"
      ? { defaultProvider: config.defaultProvider }
      : {}),
    ...(typeof config?.defaultModel === "string"
      ? { defaultModel: config.defaultModel }
      : {}),
    ...(["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      config?.defaultThinkingLevel,
    )
      ? { defaultThinkingLevel: config.defaultThinkingLevel }
      : {}),
  };
}

export function piRuntimePaths() {
  const dir = agentDirectory();
  return {
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  };
}

export type BundledPlugin =
  | "mcp"
  | "context"
  | "questions"
  | "images"
  | "assets3d";
export const bundledPluginNames: BundledPlugin[] = [
  "mcp",
  "context",
  "questions",
  "images",
  "assets3d",
];

function settingsReferences(file: string): string[] {
  try {
    const settings = JSON.parse(readFileSync(file, "utf8"));
    return [settings.packages, settings.extensions].flatMap((list) =>
      Array.isArray(list)
        ? list.flatMap((entry: unknown) => {
            if (typeof entry === "string") return [entry];
            if (
              entry &&
              typeof entry === "object" &&
              "source" in entry &&
              typeof entry.source === "string"
            )
              return [entry.source];
            return [];
          })
        : [],
    );
  } catch {
    // pi reports malformed native settings itself; don't replace its diagnostics.
    return [];
  }
}

/** Only reads OpenFun settings. Never installs into or rewrites the user's pi profile. */
export function bundledPlugins(piArgs: string[] = []) {
  const configPath = join(openfunHome(), "plugins.json");
  const enabled: Record<BundledPlugin, boolean> = {
    mcp: true,
    context: true,
    questions: true,
    images: true,
    assets3d: true,
  };
  if (existsSync(configPath)) {
    const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new Error(`Expected a plugin settings object in ${configPath}`);
    for (const [name, value] of Object.entries(config)) {
      // Alpha.6's removed Plan switch is accepted but no longer loads anything.
      if (name === "plan" && typeof value === "boolean") continue;
      if (
        !bundledPluginNames.includes(name as BundledPlugin) ||
        typeof value !== "boolean"
      )
        throw new Error(
          `Unknown plugin or non-boolean setting '${name}' in ${configPath}`,
        );
      enabled[name as BundledPlugin] = value;
    }
  }
  const piRoot = bundledPiRoot();
  const paths: Record<BundledPlugin, string> = {
    mcp: isolatedMcpExtension(),
    context: resolve(
      dirname(fileURLToPath(import.meta.resolve("context-mode"))),
      "../pi/extension.js",
    ),
    questions: join(piRoot, "examples", "extensions", "questionnaire.ts"),
    images: fileURLToPath(
      new URL(
        existsSync(
          fileURLToPath(new URL("./image-extension.js", import.meta.url)),
        )
          ? "./image-extension.js"
          : "./image-extension.ts",
        import.meta.url,
      ),
    ),
    assets3d: fileURLToPath(
      new URL(
        existsSync(
          fileURLToPath(new URL("./model-extension.js", import.meta.url)),
        )
          ? "./model-extension.js"
          : "./model-extension.ts",
        import.meta.url,
      ),
    ),
  };
  const configured = [
    ...settingsReferences(join(agentDirectory(), "settings.json")),
    ...piArgs,
  ];
  const patterns: Record<BundledPlugin, RegExp> = {
    mcp: /(?:^|[:/])pi-mcp-adapter(?:@|\/|$)/,
    context: /(?:^|[:/])context-mode(?:@|\/|$)/,
    questions:
      /(?:^|[/\\])questionnaire\.[cm]?[jt]s$|(?:^|[:/])@juicesharp\/rpiv-ask-user-question(?:@|\/|$)/,
    images: /(?:^|[/\\])image-extension\.[cm]?[jt]s$/,
    assets3d: /(?:^|[/\\])model-extension\.[cm]?[jt]s$/,
  };
  return bundledPluginNames.map((name) => {
    const overridden = configured.some((reference) =>
      patterns[name].test(reference),
    );
    return { name, path: paths[name], enabled: enabled[name], overridden };
  });
}

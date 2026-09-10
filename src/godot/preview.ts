import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkGameProject,
  inspectGameProject,
  requireProjectTrust,
} from "./project.js";
import { startHost } from "../host.js";
import { importWorld, packWorld } from "../sharing/package.js";
import { projectRoot, resolveTool } from "../paths.js";

import {
  parsePreviewOptions,
  frameIntervalSummary,
  frameBudgetSummary,
  type PreviewOptions,
} from "./capture-options.js";
export type { PreviewOptions } from "./capture-options.js";

export async function captureGamePreview(
  worldDir: string,
  options: PreviewOptions = {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  requireProjectTrust(worldDir);
  const source = inspectGameProject(worldDir);
  if (!source)
    throw new Error("Create a game project before capturing a preview");
  const parsed = parsePreviewOptions(options);
  const { width, height, seconds } = parsed;
  const headless = parsed.mode === "headless";
  const godot = resolveTool("godot");
  if (!godot) throw new Error("Godot is required for a real project preview");
  const root = await mkdtemp(join(tmpdir(), "openfun-preview-"));
  const captureId = `${Date.now()}-${randomUUID()}`;
  const frames = (headless ? [] : parsed.captureTimes).map((at, index) => ({
    at,
    path: join(
      resolve(worldDir),
      "artifacts",
      "previews",
      `${captureId}-${index}.png`,
    ),
  }));
  const imagePath = frames.at(-1)?.path ?? null;
  const reportPath = join(
    resolve(worldDir),
    "artifacts",
    "previews",
    `${captureId}.json`,
  );
  const consoleErrors: string[] = [];
  let output = "";
  try {
    // A package roundtrip isolates ALL gameplay writes and shares only public content.
    const archive = join(root, "preview.openfun"),
      isolated = join(root, "world");
    await packWorld(worldDir, archive);
    await importWorld(archive, isolated);
    requireProjectTrust(isolated, true);
    const game = inspectGameProject(isolated)!;
    await checkGameProject(isolated, godot);
    await mkdir(join(resolve(worldDir), "artifacts", "previews"), {
      recursive: true,
    });
    const hostOptions = {
      generationMode: options.demo ? ("demo" as const) : ("ai" as const),
      generation: { maxNewChunks: 0 },
    };
    {
      const host = await startHost(isolated, hostOptions);
      try {
        const script = join(game.project, "__openfun_capture.gd");
        await writeFile(
          script,
          await readFile(join(projectRoot, "tools", "godot", "capture.gd")),
        );
        if (!headless) {
          // Configure the isolated project's initial window before native startup.
          await promisify(execFile)(
            godot,
            [
              "--headless",
              "--path",
              game.project,
              "--script",
              "res://__openfun_capture.gd",
              "--",
              "--openfun-prepare-preview",
            ],
            { timeout: 20_000, signal },
          );
        }
        const configPath = join(root, "capture.json");
        await writeFile(
          configPath,
          JSON.stringify({
            seconds,
            headless,
            warmupSeconds: parsed.warmupSeconds,
            inputs: parsed.inputs,
            frames,
            reportPath,
          }),
        );
        output = await new Promise<string>((done, reject) => {
          const child = spawn(
            godot!,
            [
              ...(headless ? ["--headless", "--max-fps", "60"] : []),
              "--path",
              game.project,
              "--resolution",
              `${width}x${height}`,
              "--position",
              "0,0",
              "--script",
              "res://__openfun_capture.gd",
              "--",
              `--host=${host.url}`,
              `--token=${host.token}`,
              `--openfun-capture=${configPath}`,
            ],
            {
              stdio: ["ignore", "pipe", "pipe"],
              signal,
              env: { ...process.env, OPENFUN_AUTOMATED_TEST: "1" },
            },
          );
          let logs = "";
          const collect = (chunk: Buffer) => {
            logs = (logs + chunk.toString()).slice(-128 * 1024);
          };
          child.stdout.on("data", collect);
          child.stderr.on("data", collect);
          const timer = setTimeout(
            () => child.kill("SIGKILL"),
            (seconds + 20) * 1000,
          );
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("close", (code) => {
            clearTimeout(timer);
            if (code !== 0 || !logs.includes("OPENFUN_PREVIEW_CAPTURED 0"))
              reject(new Error(`Godot preview did not complete: ${logs}`));
            else done(logs);
          });
        });
        for (const line of output.split("\n"))
          if (/SCRIPT ERROR|^ERROR:|Parse Error/.test(line))
            consoleErrors.push(line);
      } finally {
        await host.close();
      }
    }
    const png = imagePath ? await readFile(imagePath) : null;
    if (png && (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47))
      throw new Error("Preview did not produce a PNG");
    const { frameIntervalsMs, ...observation } = JSON.parse(
      await readFile(reportPath, "utf8"),
    );
    return {
      imagePath,
      mode: headless ? "headless" : "windowed",
      visualVerification: headless
        ? "unverified-no-rendering"
        : frames.length
          ? "requires-image-review"
          : "unverified-no-capture",
      audioVerification: "unverified",
      frames: observation.captures as {
        requestedAt: number;
        observedAt: number;
        path: string;
      }[],
      reportPath,
      observation,
      frameTiming: frameIntervalSummary(frameIntervalsMs),
      frameBudget: frameBudgetSummary(frameIntervalsMs, parsed.targetFps),
      measurement: {
        kind: headless ? "simulation" : "rendered-diagnostic",
        captureFree: frames.length === 0,
        warmupSeconds: parsed.warmupSeconds,
        gpuTimeMeasured: false,
      },
      engine: source.engine,
      width: png?.readUInt32BE(16) ?? width,
      height: png?.readUInt32BE(20) ?? height,
      consoleErrors,
      output,
      isolatedSave: true,
      newModelBudget: 0,
      contentMode: options.demo ? "explicit-demo" : "saved-content-only",
      note: headless
        ? "Headless functional diagnostic: no window, rendered images, audible audio or GPU performance measurement. Scheduled inputs and logs alone do not assert successful gameplay; verify observable state transitions. Visual, animation and audio quality remain unverified. New AI content is disabled in this isolated check. Select mode=windowed when visual, animation, audio or rendered performance checks are needed; no additional user confirmation is required."
        : "This is a real rendered preview, not an assertion that controls, progression or artistic quality are correct. Review the image and test gameplay. Timed inputs and screenshots are diagnostic: inspect actual action effects in images and game logs. Frame intervals include capture/OS/VSync overhead and are not a release-build performance benchmark. No GPU profiling or automatic fun/animation score is performed. New AI content is disabled in the isolated preview.",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

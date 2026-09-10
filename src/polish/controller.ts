import { WorldStore } from "../world/world.js";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  cp,
  open,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import {
  collectProjectFiles,
  restoreProjectFiles,
} from "../sharing/project-files.js";
import { packWorld, importWorld } from "../sharing/package.js";
import { requireProjectTrust } from "../godot/project.js";
import {
  polishOptions,
  polishState,
  roundReport,
  type PolishState,
  type RoundReport,
} from "./schema.js";

export async function saveJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temp, path);
}
async function exists(path: string) {
  return !!(await lstat(path).catch(() => undefined));
}
export async function projectHash(world: string) {
  const files = await collectProjectFiles(world);
  const hash = createHash("sha256");
  for (const [path, bytes] of Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    hash.update(path).update("\0").update(bytes).update("\0");
  return hash.digest("hex");
}
async function contextHash(world: string) {
  const store = new WorldStore(world);
  try {
    return createHash("sha256")
      .update(JSON.stringify(store.inspect().spec))
      .update(await readFile(join(world, "WORLD.md")))
      .digest("hex");
  } finally {
    store.close();
  }
}
async function mergeMeshyLedger(source: string, target: string) {
  if (!(await exists(source))) return;
  if ((await lstat(source)).isSymbolicLink())
    throw new Error("Meshy task ledger must not be a symlink.");
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.json$/.test(name)) continue;
    const file = join(source, name),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
      throw new Error("Invalid Meshy task ledger entry.");
    const data = await readFile(file);
    const dest = join(target, name);
    if (await exists(dest)) {
      const a = JSON.parse(data.toString()),
        b = JSON.parse(await readFile(dest, "utf8"));
      if (a.requestHash !== b.requestHash || a.taskId !== b.taskId)
        throw new Error(`Meshy task key conflict: ${name}`);
      continue;
    }
    await writeFile(dest, data, { flag: "wx", mode: 0o600 });
  }
}
export class PolishController {
  private abort?: AbortController;
  private task?: Promise<void>;
  applying = false;
  readonly root: string;
  constructor(
    readonly world: string,
    private readonly dependencies: {
      run(
        candidate: string,
        state: PolishState,
        signal: AbortSignal,
      ): Promise<RoundReport>;
      check(candidate: string): Promise<unknown>;
      playing(): boolean;
      notify(message: string): void;
      now?: () => number;
    },
  ) {
    this.root = join(world, ".openfun", "polish");
  }
  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }
  private async directory() {
    for (const path of [join(this.world, ".openfun"), this.root]) {
      await mkdir(path, { recursive: true });
      if ((await lstat(path)).isSymbolicLink())
        throw new Error("Polish state directories must not be symbolic links.");
    }
  }
  async state(): Promise<PolishState | undefined> {
    const path = join(this.root, "state.json");
    if (!(await exists(path))) return;
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
      throw new Error("Invalid polish state file.");
    return polishState.parse(JSON.parse(await readFile(path, "utf8")));
  }
  private async save(state: PolishState) {
    await saveJson(join(this.root, "state.json"), state);
  }
  candidate(state: PolishState) {
    return join(this.root, state.id, "candidate");
  }
  private async lock(): Promise<() => Promise<void>> {
    const path = join(this.root, "lock");
    try {
      const file = await open(path, "wx", 0o600);
      await file.writeFile(String(process.pid));
      await file.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Invalid polish lock; inspect it before recovery.");
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(
          "Another polish operation is running for this project.",
        );
      await rm(path);
      return this.lock();
    }
    return async () => {
      await rm(path, { force: true });
    };
  }
  private async copySettings(candidate: string) {
    await mergeMeshyLedger(
      join(this.world, ".openfun", "meshy"),
      join(candidate, ".openfun", "meshy"),
    );
    const source = join(this.world, ".openfun", "agent.json");
    if (await exists(join(this.world, "WORLD.md")))
      await cp(join(this.world, "WORLD.md"), join(candidate, "WORLD.md"));
    if (await exists(source))
      await cp(source, join(candidate, ".openfun", "agent.json"), {
        dereference: false,
      });
  }
  private async restore(state: PolishState) {
    if (!state.checkpoint) return;
    const candidate = this.candidate(state);
    const ledger = join(this.root, state.id, "meshy-ledger");
    await mergeMeshyLedger(join(candidate, ".openfun", "meshy"), ledger);
    await rm(candidate, { recursive: true, force: true });
    await importWorld(join(this.root, state.id, state.checkpoint), candidate);
    requireProjectTrust(candidate, true);
    await this.copySettings(candidate);
    await mergeMeshyLedger(ledger, join(candidate, ".openfun", "meshy"));
    state.checkpoint = undefined;
  }
  async start(input: unknown = {}, resume = false) {
    if (this.task)
      throw new Error("Polish is already running. Use /polish stop first.");
    await this.directory();
    const unlock = await this.lock();
    try {
      let state = await this.state();
      if (state) await this.recoverPromotion(state);
      if (resume) {
        if (!state || !["paused", "running"].includes(state.status))
          throw new Error("No interrupted polish run to resume.");
        await this.restore(state);
        if (input && typeof input === "object" && "focus" in input)
          state.options = polishOptions.parse(input);
      } else {
        if (state && ["paused", "running", "ready"].includes(state.status))
          throw new Error(
            "A previous run is pending. Use resume, apply or discard first.",
          );
        requireProjectTrust(this.world);
        const baseline = await projectHash(this.world);
        state = {
          version: 1,
          id: randomUUID(),
          status: "running",
          options: polishOptions.parse(input),
          round: 0,
          elapsedMs: 0,
          baseline,
          worldContext: await contextHash(this.world),
          acceptedHash: baseline,
          accepted: 0,
          noGain: 0,
          reports: [],
          reason: "Starting",
        };
        const folder = join(this.root, state.id);
        await mkdir(folder);
        await packWorld(this.world, join(folder, "initial.openfun"));
        await importWorld(
          join(folder, "initial.openfun"),
          this.candidate(state),
        );
        requireProjectTrust(this.candidate(state), true);
        await this.copySettings(this.candidate(state));
      }
      state.status = "running";
      state.reason = "Running";
      await this.save(state);
      this.abort = new AbortController();
      this.task = this.loop(state, this.abort.signal).finally(async () => {
        this.task = undefined;
        this.abort = undefined;
        await unlock();
      });
      // Surface errors rather than leave a rejected background promise.
      void this.task.catch((error) =>
        this.dependencies.notify(`Polish stopped: ${String(error)}`),
      );
      return state;
    } catch (error) {
      await unlock();
      throw error;
    }
  }
  async stop() {
    this.abort?.abort(new Error("Polish paused by user"));
    await this.task;
  }
  async idle() {
    await this.task;
  }
  private async loop(state: PolishState, signal: AbortSignal) {
    const started = this.now();
    const used = state.elapsedMs;
    try {
      while (true) {
        signal.throwIfAborted();
        if (
          (await projectHash(this.world)) !== state.baseline ||
          (await contextHash(this.world)) !== state.worldContext
        )
          throw new Error(
            "Original project changed while polishing. Candidate retained for manual review; discard it before starting a fresh run.",
          );
        state.checkpoint = `before-${state.round + 1}-${randomUUID()}.openfun`;
        await packWorld(
          this.candidate(state),
          join(this.root, state.id, state.checkpoint),
        );
        await this.save(state);
        this.dependencies.notify(
          `Polish round ${state.round + 1}: inspect, improve and verify.`,
        );
        const report = roundReport.parse(
          await this.dependencies.run(this.candidate(state), state, signal),
        );
        signal.throwIfAborted();
        const hash = await projectHash(this.candidate(state));
        if (hash === state.acceptedHash && report.outcome === "improved") {
          report.outcome = "no_gain";
          report.summary =
            `No project change was produced. ${report.summary}`.slice(0, 2000);
        }
        if (
          ["improved", "finished"].includes(report.outcome) &&
          hash !== state.acceptedHash
        ) {
          await this.dependencies.check(this.candidate(state));
          signal.throwIfAborted();
          state.accepted++;
          // Godot import may generate UID/import sidecars; seal the post-check tree.
          state.acceptedHash = await projectHash(this.candidate(state));
          state.noGain = 0;
          state.checkpoint = undefined;
        } else {
          await this.restore(state);
          state.noGain++;
        }
        state.round++;
        await saveJson(
          join(this.root, state.id, `round-${state.round}.json`),
          report,
        );
        state.reports = [...state.reports, report].slice(-20);
        state.elapsedMs = used + this.now() - started;
        await this.save(state);
        this.dependencies.notify(
          `Polish round ${state.round}: ${report.summary}`,
        );
        if (
          report.outcome === "finished" ||
          report.outcome === "needs_input" ||
          report.outcome === "no_gain"
        ) {
          state.reason =
            report.outcome === "needs_input"
              ? "User direction needed"
              : "Round goals completed or no further material improvement";
          break;
        }
      }
      state.status =
        state.reports.at(-1)?.outcome === "needs_input"
          ? "paused"
          : state.accepted
            ? "ready"
            : "stopped";
      if (state.reason === "Running") state.reason = "Goals completed";
      state.elapsedMs = used + this.now() - started;
      await this.save(state);
    } catch (error) {
      state.status = "paused";
      state.reason = signal.aborted
        ? String(signal.reason?.message ?? "Interrupted")
        : `Verification or worker failed: ${error instanceof Error ? error.message : String(error)}`;
      state.reason = state.reason.slice(0, 2000);
      state.elapsedMs = used + this.now() - started;
      await this.save(state);
    }
    // Promotion only after the worker has stopped and the source has not changed.
    if (state.status === "ready") {
      try {
        await this.applyInternal(state);
      } catch (error) {
        state.reason =
          `Candidate retained: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            2000,
          );
        await this.save(state);
      }
    }
    this.dependencies.notify(
      `Polish ${state.status}: ${state.reason}. ${state.accepted} accepted round(s). Use /polish status for details.`,
    );
  }
  private async applyInternal(state: PolishState) {
    this.applying = true;
    try {
      return await this.promote(state);
    } finally {
      this.applying = false;
    }
  }
  private async promote(state: PolishState) {
    if (
      this.dependencies.playing() ||
      (await exists(join(this.world, ".openfun", "host.lock")))
    )
      throw new Error("Stop the game before /polish apply.");
    if (
      (await projectHash(this.world)) !== state.baseline ||
      (await contextHash(this.world)) !== state.worldContext
    )
      throw new Error(
        "Original project changed; review the candidate manually. No original files were replaced.",
      );
    if ((await projectHash(this.candidate(state))) !== state.acceptedHash)
      throw new Error("Candidate changed after verification.");
    const folder = join(this.root, state.id);
    await mergeMeshyLedger(
      join(this.candidate(state), ".openfun", "meshy"),
      join(this.world, ".openfun", "meshy"),
    );
    const stage = join(folder, "promotion");
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage);
    await restoreProjectFiles(
      stage,
      new Map(Object.entries(await collectProjectFiles(this.candidate(state)))),
    );
    if (
      this.dependencies.playing() ||
      (await exists(join(this.world, ".openfun", "host.lock")))
    )
      throw new Error("Stop the game before applying.");
    if (
      (await projectHash(this.world)) !== state.baseline ||
      (await contextHash(this.world)) !== state.worldContext
    )
      throw new Error("Original project changed during candidate preparation.");
    const backups: string[] = [],
      installed: string[] = [];
    // Retain original sources for explicit inspection/recovery. Never replace the world's database/save.
    const journal = join(folder, "promotion.json");
    const originalPaths: string[] = [];
    for (const name of ["game", "design"])
      if (await exists(join(this.world, name))) originalPaths.push(name);
    await saveJson(journal, { status: "applying", originalPaths });
    try {
      for (const name of ["game", "design"]) {
        if (await exists(join(this.world, name))) {
          await rename(
            join(this.world, name),
            join(folder, `original-${name}`),
          );
          backups.push(name);
        }
        if (await exists(join(stage, name))) {
          await rename(join(stage, name), join(this.world, name));
          installed.push(name);
        }
      }
      await saveJson(journal, { status: "applied", paths: ["game", "design"] });
    } catch (error) {
      for (const name of installed.reverse())
        await rm(join(this.world, name), { recursive: true, force: true });
      for (const name of backups.reverse())
        await rename(join(folder, `original-${name}`), join(this.world, name));
      await saveJson(journal, { status: "rolled-back" });
      throw error;
    }
    state.status = "applied";
    state.reason =
      "Verified candidate applied; original sources retained in the run directory. Saves were preserved.";
    await this.save(state);
  }
  private async recoverPromotion(state: PolishState) {
    const folder = join(this.root, state.id),
      journal = join(folder, "promotion.json");
    if (!(await exists(journal))) return;
    const record = JSON.parse(await readFile(journal, "utf8"));
    if (record.status === "applied") {
      state.status = "applied";
      state.reason = "Previously applied candidate recovered";
      await this.save(state);
      return;
    }
    if (record.status !== "applying") return;
    if (
      this.dependencies.playing() ||
      (await exists(join(this.world, ".openfun", "host.lock")))
    )
      throw new Error("Stop the game before recovering an interrupted apply.");
    for (const name of ["game", "design"]) {
      const backup = join(folder, `original-${name}`);
      if (await exists(backup)) {
        await rm(join(this.world, name), { recursive: true, force: true });
        await rename(backup, join(this.world, name));
      } else if (
        Array.isArray(record.originalPaths) &&
        !record.originalPaths.includes(name)
      ) {
        await rm(join(this.world, name), { recursive: true, force: true });
      }
    }
    await saveJson(journal, { status: "rolled-back" });
    state.status = "ready";
    state.reason =
      "Interrupted promotion rolled back; verified candidate retained";
    await this.save(state);
  }
  async apply() {
    await this.directory();
    if (this.task) throw new Error("Wait for polish to stop.");
    const unlock = await this.lock();
    try {
      const state = await this.state();
      if (!state) throw new Error("No verified candidate to apply.");
      await this.recoverPromotion(state);
      if (state.status === "applied") return state;
      if (state.status === "paused" && state.accepted) {
        await this.restore(state);
        state.status = "ready";
        await this.save(state);
      }
      if (state.status !== "ready")
        throw new Error("No verified candidate to apply.");
      await this.applyInternal(state);
      return state;
    } finally {
      await unlock();
    }
  }
  async discard() {
    await this.directory();
    await this.stop();
    const unlock = await this.lock();
    try {
      const state = await this.state();
      if (state) await this.recoverPromotion(state);
      if (state && state.status !== "applied") {
        state.status = "stopped";
        state.reason = "Candidate discarded; original retained";
        await this.save(state);
      }
    } finally {
      await unlock();
    }
  }
}

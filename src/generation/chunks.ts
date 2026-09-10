import { readContentDocuments } from "./content-documents.js";
import { chunkPlanSchema, type ChunkPlan } from "../world/schema.js";
import { CHUNK_SIZE, chunkCoord, chunkId, WorldStore } from "../world/world.js";
import type {
  ChunkGenerator,
  GenerationJob,
  GenerationOptions,
  GenerationRequest,
  GenerationView,
} from "./chunk-types.js";
export type {
  ChunkGenerator,
  GenerationOptions,
  GenerationRequest,
  GenerationView,
  HostSnapshot,
} from "./chunk-types.js";

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return result;
}
function safeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Region generation failed";
  return message
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+[^\s"']+)/g, "[redacted]")
    .slice(0, 800);
}
export function buildGenerationRequest(
  store: WorldStore,
  job: GenerationJob,
): GenerationRequest {
  const info = store.readGenerationContext(job.x, job.z);
  const spec = info.spec;
  if (info.specRevision !== job.specRevision)
    throw new Error(
      "World design changed before generation started. Retry this region.",
    );
  const cx = job.x * CHUNK_SIZE,
    cz = job.z * CHUNK_SIZE;
  const neighbors: GenerationRequest["neighbors"] = [];
  for (const chunk of info.neighbors) {
    neighbors.push({
      id: chunk.id,
      x: chunk.x,
      z: chunk.z,
      entities: chunk.entities.slice(0, 16).map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        name: entity.name,
        position: entity.position,
        state: {
          ...entity.state,
          ...(entity.state.dialogue
            ? { dialogue: entity.state.dialogue.slice(0, 300) }
            : {}),
        },
      })),
    });
  }
  return {
    ...readContentDocuments(store.dir),
    worldId: info.worldId,
    spec,
    specRevision: job.specRevision,
    chunk: { id: job.id, x: job.x, z: job.z, size: CHUNK_SIZE },
    neighbors,
    boundaries: {
      groundHeight: 0,
      inset: 2,
      corridorHalfWidth: 2,
      center: [cx, 0, cz],
      portals: [
        [cx - 16, 0, cz],
        [cx + 16, 0, cz],
        [cx, 0, cz - 16],
        [cx, 0, cz + 16],
      ],
    },
  };
}

/** Validate navigable deterministic boundaries in addition to the shared world schema. */
export function validateGeneratedPlan(
  request: GenerationRequest,
  input: unknown,
): ChunkPlan {
  const plan = chunkPlanSchema.parse(input);
  if (plan.entities.length === 0 || plan.entities.length > 24)
    throw new Error("AI region must contain from 1 to 24 entities");
  const allowedAssets = new Set(Object.values(request.spec.assets));
  const cx = request.chunk.x * CHUNK_SIZE,
    cz = request.chunk.z * CHUNK_SIZE;
  const footprint = {
    house: 2.5,
    tree: 1.1,
    rock: 0.8,
    crystal: 0.6,
    npc: 0.5,
    beacon: 0.7,
  };
  const placed: { x: number; z: number; radius: number }[] = [];
  for (const entity of plan.entities) {
    if (entity.asset && !allowedAssets.has(entity.asset))
      throw new Error(
        "AI plan references an asset outside the world asset catalog",
      );
    const x = entity.position[0] - cx,
      z = entity.position[2] - cz;
    const radius =
      footprint[entity.kind] * Math.max(entity.scale[0], entity.scale[2]);
    if (
      entity.position[1] < 0 ||
      entity.position[1] > 10 ||
      Math.abs(x) + radius > 14 ||
      Math.abs(z) + radius > 14
    )
      throw new Error(
        "AI entity footprint crosses a region boundary or height limit",
      );
    if (Math.abs(x) - radius < 2 || Math.abs(z) - radius < 2)
      throw new Error("AI entity blocks a reserved walking corridor");
    if (
      placed.some(
        (other) =>
          Math.hypot(other.x - x, other.z - z) < other.radius + radius + 0.25,
      )
    )
      throw new Error("AI entity footprints overlap");
    placed.push({ x, z, radius });
  }
  return plan;
}

export class GenerationQueue {
  private readonly options: Required<GenerationOptions>;
  private readonly generator: ChunkGenerator;
  private active = new Map<
    string,
    { job: GenerationJob; abort: AbortController; promise: Promise<void> }
  >();
  private attempts = 0;
  private closed = false;
  private paused?: string;
  private center = { x: 0, z: 0 };
  constructor(
    private readonly store: WorldStore,
    generator?: ChunkGenerator,
    options: GenerationOptions = {},
  ) {
    this.options = {
      concurrency: bounded(options.concurrency, 1, 1, 4, "concurrency"),
      maxQueued: bounded(options.maxQueued, 3, 1, 9, "maxQueued"),
      maxNewChunks: bounded(options.maxNewChunks, 12, 0, 100, "maxNewChunks"),
      timeoutMs: bounded(options.timeoutMs, 120000, 1, 300000, "timeoutMs"),
      prefetchRadius: bounded(
        options.prefetchRadius,
        1,
        0,
        1,
        "prefetchRadius",
      ),
    };
    this.generator =
      generator ??
      (async (request, signal) => {
        const { createPiChunkGenerator } = await import("./chunks-pi.js");
        return createPiChunkGenerator(this.store.dir)(request, signal);
      });
    store.recoverGenerationJobs();
  }
  request(
    positionX: number,
    positionZ: number,
    headingX = 0,
    headingZ = 0,
  ): void {
    const x = chunkCoord(positionX),
      z = chunkCoord(positionZ);
    chunkId(x, z);
    this.center = { x, z };
    if (this.closed || this.paused) return;
    const wanted: [number, number][] = [[x, z]];
    // The initial region gets the first call. Preload only the direction being approached,
    // not a nine-call batch on every snapshot. A camera/query cannot request a second ring.
    if (this.options.prefetchRadius && this.store.getChunk(x, z)) {
      const localX = positionX - x * CHUNK_SIZE,
        localZ = positionZ - z * CHUNK_SIZE;
      if (Math.hypot(headingX, headingZ) > 0.01) {
        if (Math.abs(headingX) > Math.abs(headingZ))
          wanted.push([x + Math.sign(headingX), z]);
        else wanted.push([x, z + Math.sign(headingZ)]);
      }
      if (Math.abs(localX) >= 7) wanted.push([x + Math.sign(localX), z]);
      if (Math.abs(localZ) >= 7) wanted.push([x, z + Math.sign(localZ)]);
      if (Math.abs(localX) >= 10 && Math.abs(localZ) >= 10)
        wanted.push([x + Math.sign(localX), z + Math.sign(localZ)]);
    }
    for (const job of this.store.listGenerationJobs()) {
      if (
        job.status === "pending" &&
        Math.max(Math.abs(job.x - x), Math.abs(job.z - z)) > 1
      )
        this.store.failGeneration(
          job.x,
          job.z,
          "Generation cancelled because the player left this area. Retry to resume.",
        );
    }
    for (const [wx, wz] of wanted) {
      if (
        Math.abs(wx) > 1024 ||
        Math.abs(wz) > 1024 ||
        this.store.getChunk(wx, wz)
      )
        continue;
      const pending = this.store
        .listGenerationJobs()
        .filter((job) => job.status === "pending").length;
      if (
        pending >= this.options.maxQueued ||
        pending + this.attempts >= this.options.maxNewChunks
      )
        break;
      this.store.queueGeneration(wx, wz);
    }
    this.pump();
  }
  retry(x: number, z: number): void {
    chunkId(x, z);
    if (Math.max(Math.abs(x - this.center.x), Math.abs(z - this.center.z)) > 1)
      throw new Error("Retry is limited to nearby regions");
    if (this.closed) throw new Error("Generation host is closing");
    if (this.attempts >= this.options.maxNewChunks)
      throw new Error(
        "Generation budget reached. Restart play with a higher --generation-budget.",
      );
    if (
      this.store.listGenerationJobs().filter((job) => job.status === "pending")
        .length >= this.options.maxQueued
    )
      throw new Error("Generation queue is full");
    this.paused = undefined;
    this.store.queueGeneration(x, z, true);
    this.pump();
  }
  cancel(x: number, z: number): void {
    const id = chunkId(x, z);
    this.store.failGeneration(
      x,
      z,
      "Generation cancelled. Retry this region to resume.",
    );
    this.active.get(id)?.abort.abort(new Error("Generation cancelled"));
  }
  private pump(): void {
    if (this.closed || this.paused) return;
    while (
      this.active.size < this.options.concurrency &&
      this.attempts < this.options.maxNewChunks
    ) {
      const next = this.store
        .listGenerationJobs()
        .filter((job) => job.status === "pending" && !this.active.has(job.id))
        .sort(
          (a, b) =>
            Math.abs(a.x - this.center.x) +
            Math.abs(a.z - this.center.z) -
            (Math.abs(b.x - this.center.x) + Math.abs(b.z - this.center.z)),
        )[0];
      if (!next) break;
      const job = this.store.claimGeneration(next.x, next.z);
      if (!job) continue;
      const abort = new AbortController();
      this.attempts++;
      // Defer the run until the active slot has been installed, including synchronous stubs.
      const promise = Promise.resolve()
        .then(() => this.run(job, abort))
        .finally(() => {
          this.active.delete(job.id);
          if (!this.closed) this.pump();
        });
      this.active.set(job.id, { job, abort, promise });
    }
  }
  private async run(job: GenerationJob, abort: AbortController): Promise<void> {
    const timer = setTimeout(
      () =>
        abort.abort(
          new Error(
            "Generation timed out. Retry this region or select a faster model.",
          ),
        ),
      this.options.timeoutMs,
    );
    let onAbort: (() => void) | undefined;
    try {
      const request = buildGenerationRequest(this.store, job);
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(abort.signal.reason ?? new Error("Generation cancelled"));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        if (abort.signal.aborted) onAbort();
      });
      const result = await Promise.race([
        this.generator(request, abort.signal),
        aborted,
      ]);
      abort.signal.throwIfAborted();
      const plan = validateGeneratedPlan(request, result);
      this.store.publishGeneration(job, plan);
    } catch (error) {
      if (!this.closed) {
        const message = safeError(error);
        this.store.failGeneration(job.x, job.z, message, job.attempt);
        if (
          /authenticat|unauthorized|api.?key|\blogin\b|selected pi model is unavailable|\b401\b|\b403\b/i.test(
            message,
          )
        ) {
          this.paused = message;
          for (const pending of this.store.listGenerationJobs())
            if (pending.status === "pending")
              this.store.failGeneration(pending.x, pending.z, message);
        }
      }
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  }
  view(x = this.center.x, z = this.center.z): GenerationView {
    const regions: GenerationView["regions"] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const rx = x + dx,
          rz = z + dz;
        if (Math.abs(rx) > 1024 || Math.abs(rz) > 1024) continue;
        const job = this.store.getGenerationJob(rx, rz);
        const ready = this.store.getChunk(rx, rz);
        regions.push({
          id: chunkId(rx, rz),
          x: rx,
          z: rz,
          status: ready ? "ready" : (job?.status ?? "unrequested"),
          ...(job?.error && !ready ? { error: job.error } : {}),
        });
      }
    const budgetRemaining = Math.max(
      0,
      this.options.maxNewChunks - this.attempts,
    );
    return {
      mode: "ai",
      regions,
      active: this.active.size,
      queued: this.store
        .listGenerationJobs()
        .filter((job) => job.status === "pending").length,
      budgetRemaining,
      ...(this.paused
        ? { blockedReason: this.paused }
        : budgetRemaining === 0
          ? {
              blockedReason:
                "Generation budget reached. Already generated regions remain playable. Restart play with a higher --generation-budget to continue.",
            }
          : {}),
    };
  }
  async idle(): Promise<void> {
    while (this.active.size)
      await Promise.all([...this.active.values()].map((task) => task.promise));
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const task of this.active.values())
      task.abort.abort(new Error("Host closing"));
    await this.idle();
    // A normal stop is resumable just like an interrupted process. Failed/cancelled
    // jobs stay failed; only in-flight jobs return to pending for the next host.
    this.store.recoverGenerationJobs();
  }
}

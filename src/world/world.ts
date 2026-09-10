import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { GenerationJob } from "../generation/chunk-types.js";
import {
  chunkPlanSchema,
  commandSchema,
  entitySchema,
  worldSpecSchema,
  type Chunk,
  type Entity,
  type Kind,
  type PortableWorld,
  type Snapshot,
  type WorldSpec,
} from "./schema.js";

export const CHUNK_SIZE = 32;
export const MAX_CHUNKS = 4096;
const json = (value: unknown) => JSON.stringify(value);
const coord = (value: number) => {
  if (!Number.isInteger(value) || Math.abs(value) > 1024)
    throw new Error(
      "Chunk coordinate must be an integer between -1024 and 1024",
    );
  return value;
};
export const chunkCoord = (position: number) =>
  Math.floor((position + CHUNK_SIZE / 2) / CHUNK_SIZE);
export const chunkId = (x: number, z: number) => `${coord(x)},${coord(z)}`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class WorldStore {
  readonly dir: string;
  private db: DatabaseSync;

  constructor(dir: string) {
    this.dir = resolve(dir);
    const file = join(this.dir, "world.sqlite");
    if (!existsSync(file))
      throw new Error(
        `World not found: ${this.dir}. Run openfun create first.`,
      );
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;",
    );
    if (this.getMeta<number>("formatVersion") !== 1)
      throw new Error("Unsupported world format");
    this.db.exec(`CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, x INTEGER NOT NULL, z INTEGER NOT NULL,
      status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
      spec_revision INTEGER NOT NULL, error TEXT, updated_at INTEGER NOT NULL,
      UNIQUE(x,z));`);
  }

  static create(dir: string, input: unknown): WorldStore {
    const spec = worldSpecSchema.parse(input);
    dir = resolve(dir);
    if (existsSync(join(dir, "world.sqlite")))
      throw new Error("A world already exists here");
    if (existsSync(join(dir, "WORLD.md")))
      throw new Error(
        "WORLD.md already exists without a world database; existing design notes have been preserved",
      );
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "assets"), { recursive: true });
    const db = new DatabaseSync(join(dir, "world.sqlite"));
    try {
      db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE chunks (id TEXT PRIMARY KEY, x INTEGER NOT NULL, z INTEGER NOT NULL, spec_revision INTEGER NOT NULL, UNIQUE(x,z));
        CREATE TABLE entities (id TEXT PRIMARY KEY, chunk_id TEXT NOT NULL REFERENCES chunks(id), data TEXT NOT NULL);
        CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT UNIQUE NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, result TEXT NOT NULL);`);
      const set = db.prepare("INSERT INTO meta(key,value) VALUES (?,?)");
      for (const [key, value] of Object.entries({
        formatVersion: 1,
        worldId: randomUUID(),
        saveId: randomUUID(),
        releaseId: null,
        spec,
        specRevision: 1,
        revision: 0,
        player: { position: [0, 1.7, 8] },
      }))
        set.run(key, json(value));
    } finally {
      db.close();
    }
    const store = new WorldStore(dir);
    store.writeBible();
    return store;
  }

  close() {
    this.db.close();
  }
  private getMeta<T>(key: string): T {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key=?")
      .get(key) as { value: string } | undefined;
    if (!row) throw new Error(`Missing world metadata: ${key}`);
    return JSON.parse(row.value) as T;
  }
  private setMeta(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)")
      .run(key, json(value));
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private bump(): number {
    const next = this.getMeta<number>("revision") + 1;
    this.setMeta("revision", next);
    this.setMeta("releaseId", null);
    return next;
  }
  private record(type: string, payload: unknown) {
    const revision = this.bump();
    this.db
      .prepare(
        "INSERT INTO events(command_id,type,payload,result,created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        type,
        json(payload),
        json({ ok: true, revision }),
        new Date().toISOString(),
      );
    return revision;
  }
  getSpec(): WorldSpec {
    return worldSpecSchema.parse(this.getMeta("spec"));
  }
  inspect() {
    const count = (table: string) =>
      (
        this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    return {
      worldId: this.getMeta<string>("worldId"),
      saveId: this.getMeta<string>("saveId"),
      releaseId: this.getMeta<string | null>("releaseId"),
      specRevision: this.getMeta<number>("specRevision"),
      revision: this.getMeta<number>("revision"),
      spec: this.getSpec(),
      chunks: count("chunks"),
      entities: count("entities"),
      events: count("events"),
      jobs: count("jobs"),
      player: this.getMeta<Snapshot["player"]>("player"),
    };
  }
  private writeBible() {
    const spec = this.getSpec();
    writeFileSync(
      join(this.dir, "WORLD.md"),
      `# ${spec.name}\n\n${spec.description}\n\n${spec.rules.map((rule) => `- ${rule}`).join("\n")}\n\nWorld design revision: ${this.getMeta<number>("specRevision")}. This file is an exported view; edit the design in OpenFun.\n`,
    );
  }
  private checkAsset(asset?: string) {
    if (asset && !existsSync(join(this.dir, "assets", asset)))
      throw new Error(`Missing asset: ${asset}`);
  }
  updateSpec(patch: unknown) {
    const parsed = worldSpecSchema.partial().parse(patch);
    const update = Object.fromEntries(
      Object.keys(patch as object).map((key) => [
        key,
        parsed[key as keyof typeof parsed],
      ]),
    ) as Partial<WorldSpec>;
    this.transaction(() => {
      const previous = this.getSpec();
      if (
        update.seed !== undefined &&
        update.seed !== previous.seed &&
        (
          this.db.prepare("SELECT count(*) AS n FROM chunks").get() as {
            n: number;
          }
        ).n > 0
      )
        throw new Error(
          "The seed is fixed once exploration begins; create a new world to change it",
        );
      const next = worldSpecSchema.parse({
        ...previous,
        ...update,
        assets: { ...previous.assets, ...update.assets },
      });
      for (const asset of Object.values(next.assets)) this.checkAsset(asset);
      this.setMeta("spec", next);
      this.setMeta("specRevision", this.getMeta<number>("specRevision") + 1);
      this.record("world.design", update);
    });
    this.writeBible();
    return this.inspect();
  }
  private entitiesFor(id: string): Entity[] {
    return (
      this.db
        .prepare("SELECT data FROM entities WHERE chunk_id=? ORDER BY id")
        .all(id) as { data: string }[]
    ).map((row) => entitySchema.parse(JSON.parse(row.data)));
  }
  private readChunk(x: number, z: number): Chunk | undefined {
    const row = this.db
      .prepare("SELECT spec_revision FROM chunks WHERE id=?")
      .get(chunkId(x, z)) as { spec_revision: number } | undefined;
    return row
      ? {
          id: chunkId(x, z),
          x,
          z,
          size: CHUNK_SIZE,
          entities: this.entitiesFor(chunkId(x, z)),
          specRevision: row.spec_revision,
        }
      : undefined;
  }
  getChunk(x: number, z: number): Chunk | undefined {
    return this.readChunk(x, z);
  }
  readGenerationContext(x: number, z: number) {
    return this.transaction(() => {
      chunkId(x, z);
      const neighbors: Chunk[] = [];
      for (const [dx, dz] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx!,
          nz = z + dz!;
        if (Math.abs(nx) > 1024 || Math.abs(nz) > 1024) continue;
        const chunk = this.readChunk(nx, nz);
        if (chunk) neighbors.push(chunk);
      }
      return {
        worldId: this.getMeta<string>("worldId"),
        spec: this.getSpec(),
        specRevision: this.getMeta<number>("specRevision"),
        neighbors,
      };
    });
  }
  private defaultEntities(x: number, z: number): Entity[] {
    const spec = this.getSpec();
    let state = parseInt(hash(`${spec.seed}/${x}/${z}`).slice(0, 8), 16);
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const kinds: Kind[] = ["tree", "tree", "rock", "crystal"];
    const entities: Entity[] = [];
    const add = (kind: Kind, px: number, pz: number, name?: string) => {
      entities.push(
        entitySchema.parse({
          id: `${x},${z}:${entities.length}`,
          kind,
          name:
            name ??
            {
              tree: "树木",
              rock: "岩石",
              crystal: "微光晶石",
              house: "林间小屋",
              npc: "守林人",
              beacon: "路标",
            }[kind],
          position: [px, 0, pz],
          rotation: kind === "house" ? 0 : random() * Math.PI * 2,
          scale: [1, 1, 1],
          color:
            kind === "tree"
              ? "#38694f"
              : kind === "rock"
                ? "#8b9796"
                : spec.palette.accent,
          asset: spec.assets[kind],
          state:
            kind === "npc"
              ? {
                  dialogue: `欢迎来到${spec.name}。这里的变化会被记住。收集近处的晶石，沿着小路探索吧。`,
                }
              : {},
        }),
      );
    };
    if (x === 0 && z === 0) {
      add("crystal", 3, 4);
      add("npc", -3, 2);
      add("house", 8, -7);
      add("tree", -7, -5);
    }
    for (let i = 0; i < spec.density; i++) {
      const px = x * 32 + (random() - 0.5) * 26,
        pz = z * 32 + (random() - 0.5) * 26;
      if (Math.abs(px) < 4 || Math.abs(pz) < 2) continue;
      if (
        entities.some(
          (e) => Math.hypot(e.position[0] - px, e.position[2] - pz) < 5,
        )
      )
        continue;
      add(kinds[Math.floor(random() * kinds.length)]!, px, pz);
    }
    return entities;
  }
  generateChunk(x: number, z: number, plan?: unknown): Chunk {
    return this.transaction(() => {
      const existing = this.readChunk(x, z);
      if (existing) return existing;
      if (plan === undefined)
        throw new Error(
          "Unknown chunk requires an AI or authored plan. Use generateDemoChunk only for an explicit demo.",
        );
      return this.publishChunk(x, z, plan, "agent");
    });
  }
  generateDemoChunk(x: number, z: number): Chunk {
    return this.transaction(() =>
      this.publishChunk(
        x,
        z,
        {
          entities: this.defaultEntities(x, z).map(
            ({ id: _id, ...entity }) => entity,
          ),
        },
        "procedural-demo",
      ),
    );
  }
  private publishChunk(
    x: number,
    z: number,
    plan: unknown,
    source: string,
  ): Chunk {
    const id = chunkId(x, z);
    const existing = this.readChunk(x, z);
    if (existing) return existing;
    const count = (
      this.db.prepare("SELECT count(*) AS n FROM chunks").get() as {
        n: number;
      }
    ).n;
    if (count >= MAX_CHUNKS)
      throw new Error("World exploration budget reached (4096 chunks)");
    const entities = chunkPlanSchema
      .parse(plan)
      .entities.map((e, i) => entitySchema.parse({ ...e, id: `${id}:${i}` }));
    for (const e of entities) {
      this.checkBounds(e, x, z);
      this.checkAsset(e.asset);
    }
    const revision = this.getMeta<number>("specRevision");
    this.db
      .prepare("INSERT INTO chunks(id,x,z,spec_revision) VALUES (?,?,?,?)")
      .run(id, x, z, revision);
    for (const e of entities)
      this.db
        .prepare("INSERT INTO entities(id,chunk_id,data) VALUES (?,?,?)")
        .run(e.id, id, json(e));
    this.db.prepare("INSERT INTO jobs(id,status,result) VALUES (?,?,?)").run(
      `${id}@${revision}`,
      "complete",
      json({
        chunkId: id,
        source,
        specRevision: revision,
      }),
    );
    this.record("chunk.generated", { id, specRevision: revision });
    return this.readChunk(x, z)!;
  }
  getGenerationJob(x: number, z: number): GenerationJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM generation_jobs WHERE id=?")
      .get(chunkId(x, z)) as
      | {
          id: string;
          x: number;
          z: number;
          status: GenerationJob["status"];
          attempt: number;
          spec_revision: number;
          error: string | null;
          updated_at: number;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          x: row.x,
          z: row.z,
          status: row.status,
          attempt: row.attempt,
          specRevision: row.spec_revision,
          error: row.error ?? undefined,
          updatedAt: row.updated_at,
        }
      : undefined;
  }
  listGenerationJobs(): GenerationJob[] {
    return (
      this.db
        .prepare("SELECT x,z FROM generation_jobs ORDER BY updated_at,id")
        .all() as { x: number; z: number }[]
    ).map((row) => this.getGenerationJob(row.x, row.z)!);
  }
  queueGeneration(
    x: number,
    z: number,
    retry = false,
  ): GenerationJob | undefined {
    return this.transaction(() => {
      if (this.readChunk(x, z)) return undefined;
      const existing = this.getGenerationJob(x, z);
      if (existing && !(retry && existing.status === "failed")) return existing;
      this.db
        .prepare(
          `INSERT INTO generation_jobs(id,x,z,status,attempt,spec_revision,error,updated_at) VALUES (?,?,?,'pending',0,?,NULL,?)
        ON CONFLICT(id) DO UPDATE SET status='pending',spec_revision=excluded.spec_revision,error=NULL,updated_at=excluded.updated_at`,
        )
        .run(
          chunkId(x, z),
          x,
          z,
          this.getMeta<number>("specRevision"),
          Date.now(),
        );
      return this.getGenerationJob(x, z);
    });
  }
  claimGeneration(x: number, z: number): GenerationJob | undefined {
    return this.transaction(() => {
      if (this.readChunk(x, z)) {
        this.db
          .prepare(
            "UPDATE generation_jobs SET status='ready',error=NULL,updated_at=? WHERE id=?",
          )
          .run(Date.now(), chunkId(x, z));
        return undefined;
      }
      const result = this.db
        .prepare(
          "UPDATE generation_jobs SET status='running',attempt=attempt+1,spec_revision=?,error=NULL,updated_at=? WHERE id=? AND status='pending'",
        )
        .run(this.getMeta<number>("specRevision"), Date.now(), chunkId(x, z));
      return result.changes ? this.getGenerationJob(x, z) : undefined;
    });
  }
  recoverGenerationJobs(): void {
    this.db
      .prepare(
        "UPDATE generation_jobs SET status='pending',error=NULL,updated_at=? WHERE status='running'",
      )
      .run(Date.now());
  }
  failGeneration(x: number, z: number, error: string, attempt?: number): void {
    const condition =
      attempt === undefined
        ? "status IN ('pending','running')"
        : "status='running' AND attempt=?";
    this.db
      .prepare(
        `UPDATE generation_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND ${condition}`,
      )
      .run(
        error.slice(0, 1000),
        Date.now(),
        chunkId(x, z),
        ...(attempt === undefined ? [] : [attempt]),
      );
  }
  publishGeneration(job: GenerationJob, plan: unknown): Chunk | undefined {
    return this.transaction(() => {
      const current = this.getGenerationJob(job.x, job.z);
      if (
        !current ||
        current.status !== "running" ||
        current.attempt !== job.attempt
      )
        return undefined;
      const existing = this.readChunk(job.x, job.z);
      if (
        !existing &&
        this.getMeta<number>("specRevision") !== job.specRevision
      )
        throw new Error(
          "World design changed during generation. Retry this region using the latest design.",
        );
      const chunk = existing ?? this.publishChunk(job.x, job.z, plan, "ai");
      this.db
        .prepare(
          "UPDATE generation_jobs SET status='ready',error=NULL,updated_at=? WHERE id=? AND attempt=?",
        )
        .run(Date.now(), job.id, job.attempt);
      return chunk;
    });
  }
  private checkBounds(e: Entity, x: number, z: number) {
    if (
      chunkCoord(e.position[0]) !== x ||
      chunkCoord(e.position[2]) !== z ||
      Math.abs(e.position[1]) > 100
    )
      throw new Error("Entity lies outside its chunk or vertical limit");
  }
  addEntity(input: unknown): Entity {
    const e = entitySchema.parse(input);
    const x = chunkCoord(e.position[0]),
      z = chunkCoord(e.position[2]);
    this.checkBounds(e, x, z);
    this.checkAsset(e.asset);
    this.generateChunk(x, z, { entities: [] });
    return this.transaction(() => {
      if (this.entitiesFor(chunkId(x, z)).length >= 256)
        throw new Error("Chunk entity budget reached");
      this.db
        .prepare("INSERT INTO entities(id,chunk_id,data) VALUES (?,?,?)")
        .run(e.id, chunkId(x, z), json(e));
      this.record("entity.added", { entity: e });
      return e;
    });
  }
  updateEntity(id: string, patch: unknown): Entity {
    const parsed = entitySchema.omit({ id: true }).partial().parse(patch);
    const update = Object.fromEntries(
      Object.keys(patch as object).map((key) => [
        key,
        parsed[key as keyof typeof parsed],
      ]),
    ) as Partial<Omit<Entity, "id">>;
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT data,chunk_id FROM entities WHERE id=?")
        .get(id) as { data: string; chunk_id: string } | undefined;
      if (!row) throw new Error("Unknown entity");
      const previous = entitySchema.parse(JSON.parse(row.data));
      const e = entitySchema.parse({
        ...previous,
        ...update,
        state: { ...previous.state, ...update.state },
        id,
      });
      const [x, z] = row.chunk_id.split(",").map(Number);
      this.checkBounds(e, x!, z!);
      this.checkAsset(e.asset);
      this.db.prepare("UPDATE entities SET data=? WHERE id=?").run(json(e), id);
      this.record("entity.updated", { id, patch: update });
      return e;
    });
  }
  getSnapshot(x?: number, z?: number): Snapshot {
    const player = this.getMeta<Snapshot["player"]>("player");
    const cx = chunkCoord(x ?? player.position[0]),
      cz = chunkCoord(z ?? player.position[2]);
    coord(cx);
    coord(cz);
    const chunks: Chunk[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(cx + dx) <= 1024 && Math.abs(cz + dz) <= 1024) {
          const chunk = this.readChunk(cx + dx, cz + dz);
          if (chunk) chunks.push(chunk);
        }
      }
    return {
      world: {
        ...this.getSpec(),
        id: this.getMeta<string>("worldId"),
        revision: this.getMeta<number>("specRevision"),
      },
      player,
      chunks,
      revision: this.getMeta<number>("revision"),
    };
  }
  applyCommand(input: unknown): {
    ok: true;
    revision: number;
    message: string;
  } {
    const command = commandSchema.parse(input);
    return this.transaction(() => {
      const prior = this.db
        .prepare("SELECT payload,result FROM events WHERE command_id=?")
        .get(command.id) as { payload: string; result: string } | undefined;
      if (prior) {
        if (prior.payload !== json(command))
          throw new Error("Command ID already used with different contents");
        return JSON.parse(prior.result);
      }
      let message = "位置已保存";
      if (command.type === "move") {
        if (!command.position) throw new Error("move requires position");
        const x = chunkCoord(command.position[0]),
          z = chunkCoord(command.position[2]);
        coord(x);
        coord(z);
        if (!this.readChunk(x, z))
          throw new Error("Cannot move into an unloaded chunk");
        if (command.position[1] < -10 || command.position[1] > 100)
          throw new Error("Invalid player height");
        this.setMeta("player", { position: command.position });
      } else {
        if (!command.entityId) throw new Error("interact requires entityId");
        const row = this.db
          .prepare("SELECT data FROM entities WHERE id=?")
          .get(command.entityId) as { data: string } | undefined;
        if (!row) throw new Error("Unknown entity");
        const e = entitySchema.parse(JSON.parse(row.data));
        const p = this.getMeta<Snapshot["player"]>("player").position;
        if (Math.hypot(e.position[0] - p[0], e.position[2] - p[2]) > 5.5)
          throw new Error("Move closer to interact");
        if (e.state.removed)
          throw new Error("This object has already been collected or removed");
        if (e.kind === "tree" || e.kind === "crystal") {
          e.state.removed = true;
          message =
            e.kind === "tree"
              ? "树已砍倒，世界会记住这次变化。"
              : "晶石已收集。";
        } else if (e.kind === "house") {
          e.state.open = !e.state.open;
          message = e.state.open ? "门已打开。" : "门已关闭。";
        } else if (e.kind === "npc")
          message = e.state.dialogue ?? "你好，旅行者。";
        else message = e.name;
        this.db
          .prepare("UPDATE entities SET data=? WHERE id=?")
          .run(json(e), e.id);
      }
      const result = { ok: true as const, revision: this.bump(), message };
      this.db
        .prepare(
          "INSERT INTO events(command_id,type,payload,result,created_at) VALUES (?,?,?,?,?)",
        )
        .run(
          command.id,
          command.type,
          json(command),
          json(result),
          new Date().toISOString(),
        );
      return result;
    });
  }
  exportWorld(): PortableWorld {
    return this.transaction(() => {
      let releaseId = this.getMeta<string | null>("releaseId");
      if (!releaseId) {
        releaseId = randomUUID();
        this.setMeta("releaseId", releaseId);
      }
      return {
        formatVersion: 1,
        worldId: this.getMeta<string>("worldId"),
        releaseId,
        spec: this.getSpec(),
        specRevision: this.getMeta<number>("specRevision"),
        chunks: (
          this.db.prepare("SELECT x,z FROM chunks ORDER BY x,z").all() as {
            x: number;
            z: number;
          }[]
        ).map((c) => this.readChunk(c.x, c.z)!),
        player: this.getMeta<Snapshot["player"]>("player"),
        revision: this.getMeta<number>("revision"),
      };
    });
  }
  static importWorld(dir: string, input: unknown): WorldStore {
    const chunkSchema = z
      .object({
        id: z.string(),
        x: z.number().int().min(-1024).max(1024),
        z: z.number().int().min(-1024).max(1024),
        size: z.literal(32),
        entities: z.array(entitySchema).max(256),
        specRevision: z.number().int().positive(),
      })
      .strict();
    const portable = z
      .object({
        formatVersion: z.literal(1),
        worldId: z.string().uuid(),
        releaseId: z.string().uuid(),
        spec: worldSpecSchema,
        specRevision: z.number().int().positive(),
        chunks: z.array(chunkSchema).max(MAX_CHUNKS),
        player: z
          .object({
            position: z.tuple([
              z.number().finite(),
              z.number().finite(),
              z.number().finite(),
            ]),
          })
          .strict(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(input);
    coord(chunkCoord(portable.player.position[0]));
    coord(chunkCoord(portable.player.position[2]));
    if (portable.player.position[1] < -10 || portable.player.position[1] > 100)
      throw new Error("Invalid player height");
    const store = WorldStore.create(dir, portable.spec);
    try {
      store.transaction(() => {
        store.setMeta("worldId", portable.worldId);
        store.setMeta("releaseId", portable.releaseId);
        store.setMeta("specRevision", portable.specRevision);
        store.setMeta("revision", portable.revision);
        store.setMeta("player", portable.player);
        for (const chunk of portable.chunks) {
          if (
            chunk.id !== chunkId(chunk.x, chunk.z) ||
            chunk.specRevision > portable.specRevision
          )
            throw new Error("Invalid chunk identity or revision");
          store.db
            .prepare(
              "INSERT INTO chunks(id,x,z,spec_revision) VALUES (?,?,?,?)",
            )
            .run(chunk.id, chunk.x, chunk.z, chunk.specRevision);
          for (const e of chunk.entities) {
            store.checkBounds(e, chunk.x, chunk.z);
            store.db
              .prepare("INSERT INTO entities(id,chunk_id,data) VALUES (?,?,?)")
              .run(e.id, chunk.id, json(e));
          }
        }
      });
      store.writeBible();
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }
}

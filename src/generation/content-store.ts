import { continuityExcerpt } from "./continuity.js";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  CONTENT_LIMITS,
  ContentError,
  boundedJson,
  canonicalJson,
  namespaceSchema,
  parseContentRequest,
  validateContentResult,
  type ContentJob,
  type ContentRequest,
  type GameState,
  type RuntimeData,
} from "./content-types.js";

const fingerprint = (input: ContentRequest) =>
  createHash("sha256")
    .update(
      canonicalJson(input as unknown as import("./content-types.js").Json),
    )
    .digest("hex");
interface JobRow {
  id: string;
  namespace: string;
  key: string;
  status: ContentJob["status"];
  attempt: number;
  created_at: number;
  updated_at: number;
  request: string;
  fingerprint: string;
  result: string | null;
  error: string | null;
}
export class ContentStore {
  private readonly db: DatabaseSync;
  constructor(readonly worldDir: string) {
    const dir = join(resolve(worldDir), ".openfun");
    mkdirSync(dir, { recursive: true });
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
      throw new ContentError("Runtime data directory must not be a symlink");
    const file = join(dir, "runtime.sqlite");
    if (
      existsSync(file) &&
      (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
    )
      throw new ContentError("Runtime data must be a regular file");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS content_jobs (
        id TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL,
        status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        request TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT, error TEXT,
        UNIQUE(namespace,key));
      CREATE TABLE IF NOT EXISTS game_states (
        namespace TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL,
        updated_at INTEGER NOT NULL);`);
  }
  close(): void {
    this.db.close();
  }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private toJob(row: JobRow): ContentJob {
    return {
      id: row.id,
      namespace: row.namespace,
      key: row.key,
      status: row.status,
      attempt: row.attempt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.result !== null ? { result: JSON.parse(row.result) } : {}),
      ...(row.error !== null ? { error: row.error } : {}),
    };
  }
  getJob(id: string): ContentJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM content_jobs WHERE id=?")
      .get(id) as JobRow | undefined;
    return row ? this.toJob(row) : undefined;
  }
  findJob(namespace: string, key: string): ContentJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM content_jobs WHERE namespace=? AND key=?")
      .get(namespace, key) as JobRow | undefined;
    return row ? this.toJob(row) : undefined;
  }
  requestFor(id: string): ContentRequest {
    const row = this.db
      .prepare("SELECT request FROM content_jobs WHERE id=?")
      .get(id) as { request: string } | undefined;
    if (!row) throw new ContentError("Unknown content job", 404);
    return parseContentRequest(JSON.parse(row.request));
  }
  matchingJob(request: ContentRequest): ContentJob | undefined {
    const row = this.db
      .prepare("SELECT * FROM content_jobs WHERE namespace=? AND key=?")
      .get(request.namespace, request.key) as JobRow | undefined;
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint(request))
      throw new ContentError(
        "Content key already exists with a different request. Use a new versioned key.",
        409,
      );
    return this.toJob(row);
  }
  listJobs(namespace?: string): ContentJob[] {
    const rows = namespace
      ? this.db
          .prepare(
            "SELECT * FROM content_jobs WHERE namespace=? ORDER BY created_at DESC, id DESC LIMIT 100",
          )
          .all(namespace)
      : this.db
          .prepare(
            "SELECT * FROM content_jobs ORDER BY created_at DESC, id DESC LIMIT 100",
          )
          .all();
    return (rows as unknown as JobRow[]).map((row) => this.toJob(row));
  }
  continuityFor(namespace: string, excludeId: string) {
    const rows = this.db
      .prepare(
        "SELECT id,key,result FROM content_jobs WHERE namespace=? AND status='ready' AND id<>? ORDER BY updated_at DESC,rowid DESC LIMIT 8",
      )
      .all(namespace, excludeId) as {
      id: string;
      key: string;
      result: string;
    }[];
    const state = this.getState(namespace);
    return {
      namespace,
      // Published content may be prefetched, rejected by the game or not yet played.
      recentPublished: rows.map((row) => ({
        id: row.id,
        key: row.key,
        ...continuityExcerpt(JSON.parse(row.result)),
      })),
      savedState: {
        revision: state.revision,
        ...continuityExcerpt(state.state, 16384),
      },
    };
  }
  pendingJobs(): ContentJob[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM content_jobs WHERE status='pending' ORDER BY created_at,id",
        )
        .all() as unknown as JobRow[]
    ).map((row) => this.toJob(row));
  }
  insert(request: ContentRequest): ContentJob {
    return this.transaction(() => {
      const existing = this.matchingJob(request);
      if (existing) return existing;
      const count = this.db
        .prepare("SELECT count(*) AS n FROM content_jobs")
        .get() as { n: number };
      if (count.n >= CONTENT_LIMITS.jobs)
        throw new ContentError("World content job storage limit reached", 429);
      const id = randomUUID(),
        now = Date.now();
      this.db
        .prepare(
          "INSERT INTO content_jobs(id,namespace,key,status,attempt,created_at,updated_at,request,fingerprint) VALUES (?,?,?,'pending',0,?,?,?,?)",
        )
        .run(
          id,
          request.namespace,
          request.key,
          now,
          now,
          JSON.stringify(request),
          fingerprint(request),
        );
      return this.getJob(id)!;
    });
  }
  claim(id: string): ContentJob | undefined {
    const result = this.db
      .prepare(
        "UPDATE content_jobs SET status='running',attempt=attempt+1,error=NULL,updated_at=? WHERE id=? AND status='pending'",
      )
      .run(Date.now(), id);
    return result.changes ? this.getJob(id) : undefined;
  }
  recover(): void {
    this.db
      .prepare(
        "UPDATE content_jobs SET status='pending',error=NULL,updated_at=? WHERE status='running'",
      )
      .run(Date.now());
  }
  retry(id: string): ContentJob {
    const job = this.getJob(id);
    if (!job) throw new ContentError("Unknown content job", 404);
    if (job.status === "ready") return job;
    if (job.status !== "failed")
      throw new ContentError("Only failed content jobs can be retried", 409);
    this.db
      .prepare(
        "UPDATE content_jobs SET status='pending',error=NULL,updated_at=? WHERE id=? AND status='failed'",
      )
      .run(Date.now(), id);
    return this.getJob(id)!;
  }
  fail(id: string, error: string, attempt?: number): void {
    if (attempt === undefined)
      this.db
        .prepare(
          "UPDATE content_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status IN ('pending','running')",
        )
        .run(error.slice(0, 1000), Date.now(), id);
    else
      this.db
        .prepare(
          "UPDATE content_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND status='running' AND attempt=?",
        )
        .run(error.slice(0, 1000), Date.now(), id, attempt);
  }
  publish(job: ContentJob, result: unknown): boolean {
    const validated = validateContentResult(
      this.requestFor(job.id).schema,
      result,
    );
    const changed = this.db
      .prepare(
        "UPDATE content_jobs SET status='ready',result=?,error=NULL,updated_at=? WHERE id=? AND status='running' AND attempt=?",
      )
      .run(JSON.stringify(validated), Date.now(), job.id, job.attempt);
    return Boolean(changed.changes);
  }
  getState(namespace: string): GameState {
    namespaceSchema.parse(namespace);
    const row = this.db
      .prepare("SELECT * FROM game_states WHERE namespace=?")
      .get(namespace) as
      | { revision: number; state: string; updated_at: number }
      | undefined;
    return row
      ? {
          namespace,
          revision: row.revision,
          state: JSON.parse(row.state),
          updatedAt: row.updated_at,
        }
      : { namespace, revision: 0, state: null, updatedAt: null };
  }
  saveState(input: unknown): GameState {
    const value = z
      .object({
        namespace: namespaceSchema,
        expectedRevision: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER - 1),
        state: z.unknown(),
      })
      .strict()
      .parse(input);
    if (!Object.hasOwn(input as object, "state"))
      throw new ContentError("State is required");
    const state = boundedJson(
      value.state,
      CONTENT_LIMITS.stateBytes,
      "Game state",
    );
    return this.transaction(() => {
      const current = this.getState(value.namespace);
      if (current.revision !== value.expectedRevision)
        throw new ContentError(
          "Game state changed. Reload before saving.",
          409,
          "revision_conflict",
          current,
        );
      const count = this.db
        .prepare("SELECT count(*) AS n FROM game_states")
        .get() as { n: number };
      if (!current.revision && count.n >= CONTENT_LIMITS.namespaces)
        throw new ContentError("Game state namespace limit reached", 429);
      this.db
        .prepare(
          "INSERT INTO game_states(namespace,revision,state,updated_at) VALUES (?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET revision=excluded.revision,state=excluded.state,updated_at=excluded.updated_at",
        )
        .run(
          value.namespace,
          current.revision + 1,
          JSON.stringify(state),
          Date.now(),
        );
      return this.getState(value.namespace);
    });
  }
  exportData(): RuntimeData {
    return this.transaction(() => ({
      version: 1,
      states: (
        this.db
          .prepare("SELECT namespace FROM game_states ORDER BY namespace")
          .all() as { namespace: string }[]
      ).map((row) => this.getState(row.namespace)),
      jobs: (
        this.db
          .prepare(
            "SELECT * FROM content_jobs WHERE status='ready' ORDER BY namespace,key",
          )
          .all() as unknown as JobRow[]
      ).map((row) => ({
        job: this.toJob(row) as RuntimeData["jobs"][number]["job"],
        request: parseContentRequest(JSON.parse(row.request)),
      })),
    }));
  }
  importData(input: unknown): void {
    const data = z
      .object({
        version: z.literal(1),
        states: z.array(z.unknown()).max(CONTENT_LIMITS.namespaces),
        jobs: z.array(z.unknown()).max(CONTENT_LIMITS.jobs),
      })
      .strict()
      .parse(input);
    this.transaction(() => {
      const count = this.db
        .prepare(
          "SELECT (SELECT count(*) FROM game_states)+(SELECT count(*) FROM content_jobs) AS n",
        )
        .get() as { n: number };
      if (count.n)
        throw new ContentError("Runtime destination already has data", 409);
      for (const item of data.states) {
        const value = z
          .object({
            namespace: namespaceSchema,
            revision: z
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER - 1),
            state: z.unknown(),
            updatedAt: z.number().int().nonnegative(),
          })
          .strict()
          .parse(item);
        const state = boundedJson(
          value.state,
          CONTENT_LIMITS.stateBytes,
          "Game state",
        );
        this.db
          .prepare(
            "INSERT INTO game_states(namespace,revision,state,updated_at) VALUES (?,?,?,?)",
          )
          .run(
            value.namespace,
            value.revision,
            JSON.stringify(state),
            value.updatedAt,
          );
      }
      for (const item of data.jobs) {
        const value = z
          .object({
            request: z.unknown(),
            job: z
              .object({
                id: z.string().uuid(),
                namespace: namespaceSchema,
                key: z.string().min(1).max(160),
                status: z.literal("ready"),
                attempt: z.number().int().positive().max(100000),
                createdAt: z.number().int().nonnegative(),
                updatedAt: z.number().int().nonnegative(),
                result: z.unknown(),
              })
              .strict(),
          })
          .strict()
          .parse(item);
        const request = parseContentRequest(value.request);
        if (
          request.namespace !== value.job.namespace ||
          request.key !== value.job.key
        )
          throw new ContentError("Runtime job identity mismatch");
        const result = validateContentResult(request.schema, value.job.result);
        this.db
          .prepare(
            "INSERT INTO content_jobs(id,namespace,key,status,attempt,created_at,updated_at,request,fingerprint,result) VALUES (?,?,?,'ready',?,?,?,?,?,?)",
          )
          .run(
            value.job.id,
            request.namespace,
            request.key,
            value.job.attempt,
            value.job.createdAt,
            value.job.updatedAt,
            JSON.stringify(request),
            fingerprint(request),
            JSON.stringify(result),
          );
      }
    });
  }
}
export function exportRuntimeData(worldDir: string): RuntimeData {
  if (!existsSync(join(worldDir, ".openfun", "runtime.sqlite")))
    return { version: 1, states: [], jobs: [] };
  const store = new ContentStore(worldDir);
  try {
    return store.exportData();
  } finally {
    store.close();
  }
}
export function importRuntimeData(worldDir: string, input: unknown): void {
  const store = new ContentStore(worldDir);
  try {
    store.importData(input);
  } finally {
    store.close();
  }
}

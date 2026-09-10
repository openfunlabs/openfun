import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  lstatSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkCoord, WorldStore } from "./world/world.js";
import { assetNameSchema } from "./world/schema.js";
import { z } from "zod";
import { ContentStore } from "./generation/content-store.js";
import { ContentGenerationQueue } from "./generation/content.js";
import {
  CONTENT_LIMITS,
  ContentError,
  jobIdSchema,
  namespaceSchema,
  type ContentGenerator,
  type ContentGenerationOptions,
} from "./generation/content-types.js";
import {
  GenerationQueue,
  type ChunkGenerator,
  type GenerationOptions,
  type HostSnapshot,
} from "./generation/chunks.js";

export interface HostOptions {
  port?: number;
  generationMode?: "ai" | "demo";
  generator?: ChunkGenerator;
  generation?: GenerationOptions;
  contentGenerator?: ContentGenerator;
  content?: ContentGenerationOptions;
  projectDir?: string;
}
const regionSchema = z
  .object({
    x: z.number().int().min(-1024).max(1024),
    z: z.number().int().min(-1024).max(1024),
  })
  .strict();

async function readBody(
  request: IncomingMessage,
  maximumBytes = 64 * 1024,
): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new Error("Expected application/json");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("Request too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function acquireHostLock(worldDir: string): () => void {
  const dir = join(worldDir, ".openfun");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "host.lock");
  try {
    const fd = openSync(file, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(readFileSync(file, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error(
        "Invalid world host lock. Inspect .openfun/host.lock before removing it.",
      );
    try {
      process.kill(pid, 0);
    } catch (check) {
      if ((check as NodeJS.ErrnoException).code === "ESRCH") {
        unlinkSync(file);
        return acquireHostLock(worldDir);
      }
    }
    throw new Error(
      "This world already has a running host. Close its game window first.",
    );
  }
  return () => {
    try {
      unlinkSync(file);
    } catch {
      /* already closed */
    }
  };
}
export async function startHost(worldDir: string, options: HostOptions = {}) {
  const store = new WorldStore(worldDir);
  let release: () => void;
  try {
    release = acquireHostLock(worldDir);
  } catch (error) {
    store.close();
    throw error;
  }
  const mode = options.generationMode ?? "ai";
  let generation: GenerationQueue | undefined;
  let contentStore: ContentStore | undefined;
  let contentGeneration: ContentGenerationQueue | undefined;
  const totalAttemptLimit =
    options.generation?.maxNewChunks ?? options.content?.maxAttempts ?? 12;
  let totalAttempts = 0;
  const sharedBudget = {
    remaining: () => Math.max(0, totalAttemptLimit - totalAttempts),
    take: () => {
      if (totalAttempts >= totalAttemptLimit) return false;
      totalAttempts++;
      return true;
    },
  };
  const chunkGenerator: ChunkGenerator = async (input, signal) => {
    if (!sharedBudget.take())
      throw new ContentError(
        "AI generation budget reached. Restart play with a higher --generation-budget.",
        429,
      );
    if (options.generator) return options.generator(input, signal);
    const { createPiChunkGenerator } = await import(
      "./generation/chunks-pi.js"
    );
    return createPiChunkGenerator(worldDir)(input, signal);
  };
  const getContentStore = () => (contentStore ??= new ContentStore(worldDir));
  const getContentGeneration = () =>
    (contentGeneration ??= new ContentGenerationQueue(
      getContentStore(),
      options.contentGenerator,
      {
        maxAttempts: options.generation?.maxNewChunks,
        ...options.content,
        enabled: mode !== "demo" && (options.content?.enabled ?? true),
      },
      options.projectDir,
      sharedBudget,
    ));
  try {
    if (mode !== "ai" && mode !== "demo")
      throw new Error("Invalid generation mode");
    if (
      !Number.isInteger(totalAttemptLimit) ||
      totalAttemptLimit < 0 ||
      totalAttemptLimit > 100
    )
      throw new Error("Generation budget must be an integer from 0 to 100");
  } catch (error) {
    store.close();
    release();
    throw error;
  }
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        response.end(
          JSON.stringify({ ok: true, protocol: 1, generationMode: mode }),
        );
        return;
      }
      if (url.pathname === "/game/state") {
        if (request.method === "GET") {
          const namespace = namespaceSchema.parse(
            url.searchParams.get("namespace"),
          );
          response.end(JSON.stringify(getContentStore().getState(namespace)));
          return;
        }
        if (request.method === "POST") {
          response.end(
            JSON.stringify(
              getContentStore().saveState(
                await readBody(request, CONTENT_LIMITS.stateBytes + 2048),
              ),
            ),
          );
          return;
        }
      }
      if (url.pathname === "/content/jobs") {
        if (request.method === "POST") {
          const submitted = getContentGeneration().submit(
            await readBody(request, CONTENT_LIMITS.requestBytes),
          );
          response.writeHead(submitted.created ? 202 : 200);
          response.end(
            JSON.stringify({
              job: submitted.job,
              generation: getContentGeneration().view(),
            }),
          );
          return;
        }
        if (request.method === "GET") {
          const queue = getContentGeneration();
          const id = url.searchParams.get("id");
          const namespace = url.searchParams.has("namespace")
            ? namespaceSchema.parse(url.searchParams.get("namespace"))
            : undefined;
          const key = url.searchParams.get("key");
          if (id || key !== null) {
            if (!id && !namespace)
              throw new ContentError("Job key lookup requires namespace");
            const job = id
              ? getContentStore().getJob(jobIdSchema.parse(id))
              : getContentStore().findJob(
                  namespace!,
                  z.string().min(1).max(160).parse(key),
                );
            if (!job) throw new ContentError("Unknown content job", 404);
            response.end(JSON.stringify({ job, generation: queue.view() }));
          } else
            response.end(
              JSON.stringify({
                jobs: getContentStore().listJobs(namespace),
                generation: queue.view(),
              }),
            );
          return;
        }
      }
      const contentAction = url.pathname.match(
        /^\/content\/jobs\/([^/]+)\/(retry|cancel)$/,
      );
      if (contentAction && request.method === "POST") {
        z.object({})
          .strict()
          .parse(await readBody(request));
        const id = jobIdSchema.parse(contentAction[1]);
        const queue = getContentGeneration();
        const job =
          contentAction[2] === "retry" ? queue.retry(id) : queue.cancel(id);
        response.end(JSON.stringify({ job, generation: queue.view() }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/snapshot") {
        const number = (key: string) => {
          const raw = url.searchParams.get(key);
          if (raw === null) return undefined;
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new Error("Invalid position");
          return value;
        };
        const position = store.inspect().player.position;
        const x = number("x") ?? position[0],
          z = number("z") ?? position[2];
        const cx = chunkCoord(x),
          cz = chunkCoord(z);
        if (
          Math.max(
            Math.abs(cx - chunkCoord(position[0])),
            Math.abs(cz - chunkCoord(position[2])),
          ) > 1
        )
          throw new Error(
            "Snapshot interest must be near the authoritative player position",
          );
        if (mode === "ai")
          generation ??= new GenerationQueue(store, chunkGenerator, {
            ...options.generation,
            maxNewChunks: totalAttemptLimit,
          });
        if (generation)
          generation.request(x, z, number("headingX"), number("headingZ"));
        else {
          for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
              if (Math.abs(cx + dx) <= 1024 && Math.abs(cz + dz) <= 1024)
                store.generateDemoChunk(cx + dx, cz + dz);
        }
        const snapshot = store.getSnapshot(x, z);
        const result: HostSnapshot = {
          ...snapshot,
          generation: generation?.view(cx, cz) ?? {
            mode: "demo",
            regions: snapshot.chunks.map((chunk) => ({
              id: chunk.id,
              x: chunk.x,
              z: chunk.z,
              status: "ready" as const,
            })),
            active: 0,
            queued: 0,
            budgetRemaining: 0,
          },
        };
        if (generation) {
          result.generation.budgetRemaining = sharedBudget.remaining();
          if (!sharedBudget.remaining() && !result.generation.blockedReason)
            result.generation.blockedReason =
              "AI generation budget reached. Saved content remains playable. Restart play with a higher --generation-budget.";
        }
        response.end(JSON.stringify(result));
        return;
      }
      if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
        const name = assetNameSchema.parse(
          url.pathname.slice("/assets/".length),
        );
        const file = join(worldDir, "assets", name);
        const stat = lstatSync(file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > 32 * 1024 * 1024
        )
          throw new Error("Invalid asset file");
        response.setHeader("Content-Type", "model/gltf-binary");
        response.setHeader(
          "Cache-Control",
          "private, max-age=31536000, immutable",
        );
        response.end(await readFile(file));
        return;
      }
      if (request.method === "POST" && url.pathname === "/command") {
        response.end(
          JSON.stringify(store.applyCommand(await readBody(request))),
        );
        return;
      }
      if (
        request.method === "POST" &&
        (url.pathname === "/generation/retry" ||
          url.pathname === "/generation/cancel")
      ) {
        if (!generation)
          throw new Error("AI generation is disabled in demo mode");
        const region = regionSchema.parse(await readBody(request));
        if (url.pathname === "/generation/retry" && !sharedBudget.remaining())
          throw new Error(
            "AI generation budget reached. Restart play with a higher --generation-budget.",
          );
        if (url.pathname === "/generation/retry")
          generation.retry(region.x, region.z);
        else generation.cancel(region.x, region.z);
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      response.writeHead(error instanceof ContentError ? error.status : 400);
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Invalid request",
          ...(error instanceof ContentError && error.code
            ? { code: error.code }
            : {}),
          ...(error instanceof ContentError && error.current
            ? { current: error.current }
            : {}),
        }),
      );
    }
  });
  server.requestTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await generation?.close();
    await contentGeneration?.close();
    contentStore?.close();
    store.close();
    release();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Host did not open a TCP port");
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    token,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await generation?.close();
      await contentGeneration?.close();
      contentStore?.close();
      store.close();
      release();
    },
  };
}

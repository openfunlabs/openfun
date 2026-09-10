import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  link,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { PACKAGE_LIMITS, validateGlb } from "../sharing/package.js";
import { pngDimensions } from "./images.js";

import {
  keySchema,
  taskIdSchema,
  jobSchema,
  modelParamsSchema,
  modelStatusSchema,
  processModelSchema,
  animationLibrarySchema,
  endpoints,
  type Job,
  type Operation,
  type Output,
} from "./meshy-schema.js";
export {
  modelParamsSchema,
  modelStatusSchema,
  processModelSchema,
  animationLibrarySchema,
} from "./meshy-schema.js";
type Context = Pick<ExtensionContext, "cwd" | "modelRegistry">;
const endpoint = "https://api.meshy.ai";
const digest = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function inside(root: string, target: string) {
  const path = relative(root, target);
  if (
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(path)
  )
    throw new Error("Meshy files must stay inside the current project.");
  return target;
}
async function directory(cwd: string, parts: string[]) {
  const root = await realpath(cwd);
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    await mkdir(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    path = inside(root, await realpath(path));
  }
  return path;
}
async function boundedFile(path: string, limit: number) {
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error(
        "Meshy input file exceeds its size limit or is not a regular file.",
      );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) throw new Error("Meshy input changed while reading.");
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await file.close();
  }
}
async function boundedResponse(response: Response, limit: number) {
  if (!response.body) throw new Error("Meshy returned an empty response.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit)
        throw new Error("Meshy response exceeds OpenFun's file size limit.");
      parts.push(value);
    }
    return Buffer.concat(parts);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function api(
  ctx: Context,
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchApi: typeof fetch,
) {
  const key = await ctx.modelRegistry.getApiKeyForProvider("meshy");
  if (!key)
    throw new Error(
      "Meshy is not configured. Use /login meshy or set MESHY_API_KEY, then retry.",
    );
  const response = await fetchApi(endpoint + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(60000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const hint =
      response.status === 401
        ? "Check /login meshy."
        : response.status === 402
          ? "Check your Meshy API credits."
          : response.status === 429
            ? "Rate limited; wait before checking again."
            : "Check the Meshy dashboard.";
    // Do not echo an upstream response body, which can contain inputs or credentials.
    throw new Error(`Meshy HTTP ${response.status}. ${hint}`);
  }
  return JSON.parse(
    (await boundedResponse(response, 1024 * 1024)).toString("utf8"),
  ) as unknown;
}
async function saveJob(path: string, job: Job) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(job, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
async function readJob(path: string): Promise<Job | undefined> {
  try {
    return jobSchema.parse(
      JSON.parse((await boundedFile(path, 16384)).toString("utf8")),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
function summary(job: Job, output: Output = "model") {
  const asset =
    job.outputs?.[output] ?? (output === "model" ? job.asset : undefined);
  return {
    ...job,
    requestHash: undefined,
    asset,
    output,
    ...(asset
      ? {
          path: `game/assets/generated/${asset}`,
          resource: `res://assets/generated/${asset}`,
        }
      : {}),
    next: asset
      ? job.operation === "text-preview"
        ? "Untextured preview only. Inspect geometry, then submit a separate world_process_model refine task for PBR textures."
        : job.operation === "rig" || job.operation === "animate"
          ? "Inspect this actual clip in Godot with world_design_guide animation. Trace sourceKey to the textured pre-rig model and compare PBR maps: rig/animation output can replace source materials. Restore only verified matching UVs with the bundled mesh material helper and render before/after. Inspect root displacement and connect it to collision-aware movement, then verify transitions, weapon contact, hit/death timing and cleanup. A successful GLB download is not animation acceptance."
          : "Integrate the GLB in Godot and inspect its actual materials, scale and gameplay use."
      : ["FAILED", "CANCELED"].includes(job.status)
        ? "Task did not complete. Inspect the service error; do not automatically create a new paid revision."
        : job.taskId
          ? "Check world_model_status with this key; work on other things while it runs."
          : "Submission is unresolved. Recover the existing task ID from the Meshy API task list and use world_model_status(key, taskId). Do not submit again automatically.",
  };
}
async function jobPath(cwd: string, key: string) {
  keySchema.parse(key);
  return join(await directory(cwd, [".openfun", "meshy"]), `${key}.json`);
}
async function imageInput(cwd: string, reference: string) {
  const root = await realpath(cwd);
  const source = inside(root, await realpath(resolve(root, reference)));
  const bytes = await boundedFile(source, 20 * 1024 * 1024);
  let mime: string;
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    pngDimensions(bytes);
    mime = "image/png";
  } else if (
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    mime = "image/jpeg";
  else throw new Error("Meshy references must be complete PNG or JPEG images.");
  return {
    reference: relative(root, source),
    hash: digest(bytes),
    data: `data:${mime};base64,${bytes.toString("base64")}`,
  };
}
function document(bytes: Buffer) {
  validateGlb(bytes);
  return JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)).trim(),
  );
}
async function modelInput(cwd: string, model: string, rig: boolean) {
  const root = await realpath(cwd);
  const source = inside(root, await realpath(resolve(root, model)));
  const bytes = await boundedFile(source, PACKAGE_LIMITS.entryBytes);
  const gltf = document(bytes);
  if (
    rig &&
    (!gltf.images?.length ||
      !gltf.materials?.some(
        (m: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) =>
          m.pbrMetallicRoughness?.baseColorTexture,
      ))
  )
    throw new Error(
      "Meshy rigging requires a textured humanoid. Texture this GLB before rigging; use Blender for non-humanoid rigs.",
    );
  return {
    reference: relative(root, source),
    hash: digest(bytes),
    data: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
  };
}

/** One POST per stable local revision, for every operation. Never retry an uncertain paid request. */
async function submit(
  ctx: Context,
  key: string,
  operation: Operation,
  requestHash: string,
  body: Record<string, unknown>,
  metadata: Pick<Job, "reference" | "sourceKey">,
  signal: AbortSignal | undefined,
  fetchApi: typeof fetch,
) {
  signal?.throwIfAborted();
  const path = await jobPath(ctx.cwd, key);
  const existing = await readJob(path);
  if (existing) {
    if (
      existing.requestHash !== requestHash ||
      existing.operation !== operation
    )
      throw new Error(
        "This asset key already identifies a different request. Use a new revision key only for intentional paid regeneration.",
      );
    return summary(existing);
  }
  if (!(await ctx.modelRegistry.getApiKeyForProvider("meshy")))
    throw new Error(
      "Meshy is not configured. Use /login meshy or set MESHY_API_KEY.",
    );
  const job: Job = {
    version: 1,
    key,
    operation,
    requestHash,
    ...metadata,
    status: "SUBMITTING",
  };
  await writeFile(path, JSON.stringify(job), { flag: "wx", mode: 0o600 });
  try {
    const response = z
      .object({ result: taskIdSchema })
      .parse(
        await api(
          ctx,
          endpoints[operation],
          { method: "POST", body: JSON.stringify(body) },
          signal,
          fetchApi,
        ),
      );
    job.taskId = response.result;
    job.status = "SUBMITTED";
    await saveJob(path, job);
    return summary(job);
  } catch (error) {
    job.status = "UNKNOWN";
    await saveJob(path, job);
    const message =
      error instanceof Error && /^Meshy HTTP \d{3}\./.test(error.message)
        ? error.message
        : "Meshy submission was interrupted or returned an invalid response.";
    throw new Error(
      `${message} No automatic retry. Asset key: ${key}.${job.taskId ? ` Task ID: ${job.taskId}.` : " Check the Meshy API task list before submitting again."}`,
    );
  }
}

export async function generateModel(
  ctx: Context,
  input: unknown,
  signal?: AbortSignal,
  fetchApi: typeof fetch = fetch,
) {
  const params = modelParamsSchema.parse(input);
  signal?.throwIfAborted();
  const geometry = {
    ai_model: "meshy-7",
    should_remesh: true,
    topology: "triangle",
    target_polycount: params.targetPolycount,
    target_formats: ["glb"],
    ...(params.pose ? { pose_mode: params.pose } : {}),
  };
  if (params.reference) {
    const image = await imageInput(ctx.cwd, params.reference);
    // Preserve alpha.19 request identity, including already billed image jobs.
    const hash = digest(
      JSON.stringify({
        ...params,
        reference: image.reference,
        imageHash: image.hash,
      }),
    );
    return submit(
      ctx,
      params.key,
      "image",
      hash,
      {
        ...geometry,
        image_url: image.data,
        model_type: "standard",
        should_texture: true,
        enable_pbr: true,
        texture_resolution: "2k",
        ...(params.texturePrompt
          ? { texture_prompt: params.texturePrompt }
          : {}),
      },
      { reference: image.reference },
      signal,
      fetchApi,
    );
  }
  return submit(
    ctx,
    params.key,
    "text-preview",
    digest(JSON.stringify(params)),
    { ...geometry, mode: "preview", prompt: params.prompt },
    {},
    signal,
    fetchApi,
  );
}

async function completedSource(
  ctx: Context,
  key: string,
  allowed: Operation[],
) {
  const job = await readJob(await jobPath(ctx.cwd, key));
  if (!job?.taskId || job.status !== "SUCCEEDED")
    throw new Error(
      "Source task must have succeeded. Check it with world_model_status first.",
    );
  if (!allowed.includes(job.operation))
    throw new Error(
      `Unsupported source operation ${job.operation}; expected ${allowed.join(", ")}.`,
    );
  return job;
}

export async function animationLibrary(
  ctx: Context,
  input: unknown,
  signal?: AbortSignal,
  fetchApi: typeof fetch = fetch,
) {
  const params = animationLibrarySchema.parse(input);
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.category) query.set("category", params.category);
  if (params.actionIds) query.set("action_ids", params.actionIds.join(","));
  const raw = await api(
    ctx,
    `/openapi/v1/animations/library?${query}`,
    { method: "GET" },
    signal,
    fetchApi,
  );
  const actions = z
    .array(
      z.object({
        action_id: z.number().int().nonnegative(),
        name: z.string().max(200),
        key: z.string().max(200),
        category: z.string().max(100),
        sub_category: z.string().max(100),
      }),
    )
    .max(10000)
    .parse(raw);
  return {
    actions: actions.slice(0, params.limit),
    totalMatches: actions.length,
    returned: Math.min(actions.length, params.limit),
    note: "Live Meshy action catalog. No generation credits used. Choose an ID, then apply it to a completed rig.",
  };
}

export async function processModel(
  ctx: Context,
  input: unknown,
  signal?: AbortSignal,
  fetchApi: typeof fetch = fetch,
) {
  const params = processModelSchema.parse(input);
  signal?.throwIfAborted();
  if (params.sourceKey === params.key)
    throw new Error("Use a new output key; keep the source task unchanged.");
  // Existing work skips remote catalog lookup; local sources still verify request identity.
  const existing = await readJob(await jobPath(ctx.cwd, params.key));
  let body: Record<string, unknown>;
  const metadata: Pick<Job, "reference" | "sourceKey"> = {
    sourceKey: params.sourceKey,
  };
  const identity: Record<string, unknown> = { ...params };
  const pbr = {
    ai_model: "meshy-7",
    enable_pbr: true,
    texture_resolution: "2k",
    target_formats: ["glb"],
  };
  if (params.operation === "animate") {
    const parent = await completedSource(ctx, params.sourceKey, ["rig"]);
    identity.sourceTaskId = parent.taskId;
    body = { rig_task_id: parent.taskId, action_id: params.actionId };
    if (!existing) {
      const catalog = await animationLibrary(
        ctx,
        { actionIds: [params.actionId] },
        signal,
        fetchApi,
      );
      if (!catalog.actions.some((a) => a.action_id === params.actionId))
        throw new Error(
          "Animation ID is not available. Choose an ID returned by world_animation_library.",
        );
    }
  } else if (params.operation === "refine") {
    const parent = await completedSource(ctx, params.sourceKey, [
      "text-preview",
    ]);
    identity.sourceTaskId = parent.taskId;
    body = { ...pbr, mode: "refine", preview_task_id: parent.taskId };
    if (params.texturePrompt) body.texture_prompt = params.texturePrompt;
    if (params.reference) {
      const image = await imageInput(ctx.cwd, params.reference);
      identity.imageHash = image.hash;
      metadata.reference = image.reference;
      body.texture_image_url = image.data;
    }
  } else {
    let sourceBody: Record<string, unknown>;
    if (params.sourceKey) {
      const parent = await completedSource(
        ctx,
        params.sourceKey,
        params.operation === "rig"
          ? ["image", "refine", "retexture"]
          : ["image", "text-preview", "refine"],
      );
      identity.sourceTaskId = parent.taskId;
      sourceBody = { input_task_id: parent.taskId };
    } else {
      const model = await modelInput(
        ctx.cwd,
        params.model!,
        params.operation === "rig",
      );
      identity.modelHash = model.hash;
      metadata.reference = model.reference;
      sourceBody = { model_url: model.data };
    }
    if (params.operation === "rig")
      body = { ...sourceBody, height_meters: params.heightMeters };
    else {
      body = {
        ...pbr,
        ...sourceBody,
        enable_original_uv: params.preserveUV ?? !!params.sourceKey,
      };
      if (params.texturePrompt) body.text_style_prompt = params.texturePrompt;
      if (params.reference) {
        const image = await imageInput(ctx.cwd, params.reference);
        identity.imageHash = image.hash;
        body.image_style_url = image.data;
      }
    }
  }
  return submit(
    ctx,
    params.key,
    params.operation,
    digest(JSON.stringify(identity)),
    body,
    metadata,
    signal,
    fetchApi,
  );
}

async function validateSaved(outputDir: string, asset: string) {
  const bytes = await boundedFile(
    join(outputDir, asset),
    PACKAGE_LIMITS.entryBytes,
  );
  validateGlb(bytes);
  if (`${digest(bytes)}.glb` !== asset)
    throw new Error("The saved Meshy asset has changed.");
}
const taskSchema = z.object({
  id: taskIdSchema,
  progress: z.number().min(0).max(100),
  status: z.enum(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"]),
  consumed_credits: z.number().nonnegative().optional(),
  model_urls: z.object({ glb: z.string().optional() }).nullish(),
  result: z
    .object({
      rigged_character_glb_url: z.string().optional(),
      animation_glb_url: z.string().optional(),
      basic_animations: z
        .object({
          walking_glb_url: z.string().optional(),
          running_glb_url: z.string().optional(),
        })
        .nullish(),
    })
    .nullish(),
});

/** Poll once and download only the requested artifact. Each follow-up is a distinct saved paid task. */
export async function modelStatus(
  ctx: Context,
  input: unknown,
  signal?: AbortSignal,
  fetchApi: typeof fetch = fetch,
) {
  const params = modelStatusSchema.parse(input);
  signal?.throwIfAborted();
  const path = await jobPath(ctx.cwd, params.key);
  const job = await readJob(path);
  if (!job)
    throw new Error(
      "No Meshy task exists for this asset key in the current project.",
    );
  if (params.taskId && job.taskId && params.taskId !== job.taskId)
    throw new Error("This key already belongs to another Meshy task.");
  if (params.output !== "model" && job.operation !== "rig")
    throw new Error("Walking/running outputs are only available on rig tasks.");
  const outputDir = await directory(ctx.cwd, ["game", "assets", "generated"]);
  const saved =
    job.outputs?.[params.output] ??
    (params.output === "model" ? job.asset : undefined);
  if (saved) {
    await validateSaved(outputDir, saved);
    return summary(job, params.output);
  }
  const taskId = job.taskId ?? params.taskId;
  if (!taskId) return summary(job, params.output);
  let data: unknown;
  try {
    data = await api(
      ctx,
      `${endpoints[job.operation]}/${taskId}`,
      { method: "GET" },
      signal,
      fetchApi,
    );
  } catch (error) {
    if (error instanceof Error && /^Meshy HTTP \d{3}\./.test(error.message))
      throw error;
    throw new Error(
      `Meshy status request was interrupted. Retry world_model_status with key ${params.key}; no new generation is needed.`,
    );
  }
  const task = taskSchema.parse(data);
  if (task.id !== taskId)
    throw new Error("Meshy returned a different task ID.");
  job.taskId = taskId;
  job.status = task.status;
  job.progress = task.progress;
  if (task.consumed_credits !== undefined)
    job.consumedCredits = task.consumed_credits;
  const urls: Partial<Record<Output, string>> =
    job.operation === "rig"
      ? {
          model: task.result?.rigged_character_glb_url,
          walking: task.result?.basic_animations?.walking_glb_url,
          running: task.result?.basic_animations?.running_glb_url,
        }
      : {
          model:
            job.operation === "animate"
              ? task.result?.animation_glb_url
              : task.model_urls?.glb,
        };
  if (task.status === "SUCCEEDED")
    job.availableOutputs = (Object.keys(urls) as Output[]).filter(
      (k) => !!urls[k],
    );
  await saveJob(path, job);
  if (task.status !== "SUCCEEDED") return summary(job, params.output);
  const address = urls[params.output];
  if (!address)
    throw new Error(
      `Meshy completed without the requested ${params.output} GLB output. No placeholder was created.`,
    );
  const url = new URL(address);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "assets.meshy.ai" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error(
      "Meshy returned an unsupported asset URL. Expected https://assets.meshy.ai/. No download was attempted.",
    );
  let bytes: Buffer;
  try {
    const response = await fetchApi(url, {
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(180000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Download failed");
    }
    bytes = await boundedResponse(response, PACKAGE_LIMITS.entryBytes);
  } catch {
    throw new Error(
      "Meshy GLB download failed or exceeded 32 MiB. Retry world_model_status; it will not regenerate the model.",
    );
  }
  const gltf = document(bytes);
  if (
    (job.operation === "rig" || job.operation === "animate") &&
    !gltf.skins?.length
  )
    throw new Error(
      "Meshy output has no skin/skeleton. It cannot be reported as a rigged character.",
    );
  if (
    (job.operation === "animate" || params.output !== "model") &&
    !gltf.animations?.some((a: { channels?: unknown[] }) => a.channels?.length)
  )
    throw new Error(
      "Meshy output has no animation channels. It cannot be reported as an animated character.",
    );
  const asset = `${digest(bytes)}.glb`;
  const target = join(outputDir, asset),
    temporary = join(outputDir, `.meshy-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await boundedFile(target, PACKAGE_LIMITS.entryBytes)).equals(bytes))
        throw new Error("Existing Meshy asset is damaged.");
    }
  } finally {
    await rm(temporary, { force: true });
  }
  job.outputs = { ...job.outputs, [params.output]: asset };
  if (params.output === "model") job.asset = asset;
  await saveJob(join(outputDir, `meshy-${params.key}.json`), job);
  await saveJob(path, job);
  return summary(job, params.output);
}

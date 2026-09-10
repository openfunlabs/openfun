import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { z } from "zod";

export const imageParamsSchema = z.object({
  imageModel: z
    .enum(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"])
    .default("gpt-image-2.5-sunburst"),
  purpose: z.enum(["art", "ui"]).default("art"),
  prompt: z.string().trim().min(1).max(12000),
  references: z.array(z.string().min(1).max(4096)).max(5).optional(),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024"),
});
type ImageContext = Pick<ExtensionContext, "cwd" | "model" | "modelRegistry">;
const MAX_IMAGE = 24 * 1024 * 1024;
const MAX_RESPONSE = 96 * 1024 * 1024;

/** Only expose bounded structured service diagnostics, never headers or raw bodies. */
function serviceDiagnostic(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;
  const fields = ["code", "param", "message"].flatMap((key) => {
    const raw = error[key];
    if (typeof raw !== "string") return [];
    const clean = raw
      .replace(
        /Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi,
        "[redacted]",
      )
      .replace(/https?:\/\/\S+|data:[^\s]+/gi, "[redacted URL/data]")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 400);
    return `${key}: ${clean}`;
  });
  return fields.length ? ` Service diagnostic: ${fields.join("; ")}.` : "";
}

async function responseDiagnostic(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) return "";
      chunks.push(value);
    }
    return serviceDiagnostic(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    return "";
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
  )
    throw new Error("Image service did not return a complete PNG.");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192)
    throw new Error("Image dimensions are invalid.");
  return { width, height };
}

async function projectPath(cwd: string, path: string) {
  const root = await realpath(cwd),
    target = await realpath(resolve(root, path));
  const rel = relative(root, target);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new Error(
      "Image references and output directories must be inside the current project. Copy reference images into the project first.",
    );
  return target;
}

export async function readImageStream(response: Response): Promise<Buffer> {
  if (!response.body)
    throw new Error("Image service returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    total = 0;
  let completed: Record<string, unknown> | undefined;
  const finishedItems = new Map<string, Record<string, unknown>>();
  const accept = (block: string) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (
      ["error", "response.failed", "response.incomplete"].includes(event.type)
    )
      throw new Error(
        `Image generation failed or was incomplete.${serviceDiagnostic(event.response ?? event)} No image was published; the request was not retried.`,
      );
    // Partial image events are previews, never the final asset.
    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "image_generation_call"
    ) {
      finishedItems.set(event.item.id, event.item);
    }
    if (event.type === "response.completed") completed = event.response;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE)
        throw new Error("Image response exceeded the size limit.");
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        accept(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) accept(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (
    !completed ||
    completed.status !== "completed" ||
    (completed.output !== undefined && !Array.isArray(completed.output))
  )
    throw new Error(
      "Image stream ended without a completed response. No image was published; the request was not retried.",
    );
  // Codex can omit output items from response.completed; retain output_item.done.
  for (const item of (completed.output ?? []) as Record<string, unknown>[]) {
    if (item?.type === "image_generation_call") {
      const key = item.id as string;
      const previous = finishedItems.get(key);
      // Terminal summaries may omit the image bytes already delivered in item.done.
      finishedItems.set(key, {
        ...previous,
        ...item,
        result: item.result ?? previous?.result,
      });
    }
  }
  const images = [...finishedItems.values()].filter(
    (item) =>
      item?.type === "image_generation_call" && item.status === "completed",
  );
  const image = images[0];
  if (images.length !== 1 || !image || typeof image.result !== "string")
    throw new Error("Image service completed without exactly one final image.");
  const encoded = image.result;
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length > (MAX_IMAGE * 4) / 3 + 4
  )
    throw new Error("Image data is invalid or too large.");
  const bytes = Buffer.from(encoded, "base64");
  pngDimensions(bytes);
  return bytes;
}

export async function generateImage(
  ctx: ImageContext,
  input: unknown,
  signal?: AbortSignal,
  fetchImage: typeof fetch = fetch,
) {
  const params = imageParamsSchema.parse(input);
  const model = ctx.model;
  if (!model || model.api !== "openai-codex-responses")
    throw new Error(
      "Select an OpenAI Codex subscription model with /model to generate images. This tool does not switch your model or fall back to a paid API.",
    );
  signal?.throwIfAborted();
  const content: Record<string, unknown>[] = [
    { type: "input_text", text: params.prompt },
  ];
  let referenceBytes = 0;
  for (const path of params.references ?? []) {
    const file = await projectPath(ctx.cwd, path);
    const info = await stat(file);
    referenceBytes += info.size;
    if (!info.isFile() || referenceBytes > MAX_IMAGE)
      throw new Error("Reference images exceed the 24 MiB limit.");
    const bytes = await readFile(file);
    let mime: string;
    if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
      pngDimensions(bytes);
      mime = "image/png";
    } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      mime = "image/jpeg";
    else if (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    )
      mime = "image/webp";
    else throw new Error("Reference images must be PNG, JPEG, or WebP.");
    content.push({
      type: "input_image",
      image_url: `data:${mime};base64,${bytes.toString("base64")}`,
      detail: "high",
    });
  }
  // Validate each existing parent before creating children; do not follow an asset-directory symlink outside the world.
  let output = await realpath(ctx.cwd);
  for (const part of ["game", "assets", "generated"]) {
    const next = join(output, part);
    await mkdir(next, { recursive: true });
    output = await projectPath(ctx.cwd, next);
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok)
    throw new Error(
      "Codex authentication is unavailable. Use /login in OpenFun and retry.",
    );
  const headers = new Headers();
  for (const [key, value] of Object.entries(auth.headers ?? {}))
    if (typeof value === "string") headers.set(key, value);
  if (!headers.has("authorization") && auth.apiKey)
    headers.set("authorization", `Bearer ${auth.apiKey}`);
  if (!headers.has("authorization"))
    throw new Error("Use /login in OpenFun to sign in to OpenAI Codex first.");
  if (!headers.has("chatgpt-account-id") && auth.apiKey) {
    try {
      const claims = JSON.parse(
        Buffer.from(auth.apiKey.split(".")[1]!, "base64url").toString(),
      );
      const account = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
      if (typeof account === "string")
        headers.set("chatgpt-account-id", account);
    } catch {
      /* pi may already supply headers for a non-JWT credential. */
    }
  }
  headers.set("content-type", "application/json");
  headers.set("accept", "text/event-stream");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", "pi");
  const base = (auth.baseUrl ?? model.baseUrl).replace(/\/+$/, "");
  const url = base.endsWith("/codex/responses")
    ? base
    : base.endsWith("/codex")
      ? `${base}/responses`
      : `${base}/codex/responses`;
  const timeout = AbortSignal.timeout(5 * 60 * 1000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImage(url, {
    method: "POST",
    headers,
    signal: combined,
    redirect: "error",
    body: JSON.stringify({
      model: model.id,
      store: false,
      stream: true,
      instructions:
        "Generate exactly one image using the image_generation tool. Follow the user's art direction and reference images.",
      input: [{ role: "user", content }],
      tools: [
        {
          type: "image_generation",
          model: params.imageModel,
          size: params.size,
          output_format: "png",
        },
      ],
      tool_choice: { type: "image_generation" },
      parallel_tool_calls: false,
    }),
  });
  if (!response.ok) {
    const diagnostic = await responseDiagnostic(response);
    const action = [401, 403].includes(response.status)
      ? " Use /login to check your Codex session and access."
      : response.status === 429
        ? " Check your subscription quota."
        : " The subscription endpoint rejected the request.";
    throw new Error(
      `Image generation HTTP ${response.status}.${action}${diagnostic} No automatic retry or API fallback.`,
    );
  }
  const bytes = await readImageStream(response);
  combined.throwIfAborted();
  const path = join(output, `${randomUUID()}.png`);
  await writeFile(path, bytes, { flag: "wx" });
  const receipt = {
    version: 1,
    tool: "world_generate_image",
    purpose: params.purpose,
    imageModel: params.imageModel,
    createdAt: new Date().toISOString(),
    file: path.split(/[\\/]/).at(-1),
  };
  await writeFile(`${path}.source.json`, JSON.stringify(receipt, null, 2), {
    flag: "wx",
  });
  return {
    path,
    purpose: params.purpose,
    sourceReceipt: `${path}.source.json`,
    ...pngDimensions(bytes),
    bytes: bytes.length,
    model: model.id,
    imageModel: params.imageModel,
    references: params.references?.length ?? 0,
  };
}

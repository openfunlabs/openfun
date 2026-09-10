import { z } from "zod";
import { Type } from "typebox";
import { Check } from "typebox/value";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export const CONTENT_LIMITS = Object.freeze({
  requestBytes: 128 * 1024,
  schemaBytes: 32 * 1024,
  contextBytes: 64 * 1024,
  resultBytes: 128 * 1024,
  stateBytes: 256 * 1024,
  documentBytes: 128 * 1024,
  jobs: 2048,
  namespaces: 64,
});
export class ContentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
    readonly current?: GameState,
  ) {
    super(message);
  }
}
export const namespaceSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const jobIdSchema = z.string().uuid();

/** JSON-only validation before serialization or schema interpretation. */
export function boundedJson(
  input: unknown,
  maxBytes: number,
  name = "JSON",
): Json {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 50000 || depth > 32)
      throw new ContentError(`${name} exceeds depth or node limit`);
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null)
      throw new ContentError(`${name} must contain only finite JSON values`);
    if (ancestors.has(value))
      throw new ContentError(`${name} cannot contain cycles`);
    if (
      !Array.isArray(value) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw new ContentError(`${name} must contain only plain JSON objects`);
    ancestors.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value))
      visit(child, depth + 1);
    ancestors.delete(value);
  };
  visit(input, 0);
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text) > maxBytes)
    throw new ContentError(`${name} exceeds byte limit`);
  return JSON.parse(text) as Json;
}
export function canonicalJson(input: Json): string {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(",")}]`;
  if (input !== null && typeof input === "object")
    return `{${Object.keys(input)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key]!)}`)
      .join(",")}}`;
  return JSON.stringify(input);
}

const keywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "description",
  "title",
  "default",
]);
export function validateContentSchema(input: unknown): JsonObject {
  const schema = boundedJson(input, CONTENT_LIMITS.schemaBytes, "Schema");
  let nodes = 0;
  const visit = (value: Json, depth: number): void => {
    if (++nodes > 512 || depth > 16)
      throw new ContentError("Schema exceeds complexity limit");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ContentError("Expected an object schema");
    for (const [key, item] of Object.entries(value)) {
      if (!keywords.has(key))
        throw new ContentError(`Unsupported schema keyword: ${key}`);
      if (
        key === "type" &&
        ![
          "object",
          "array",
          "string",
          "number",
          "integer",
          "boolean",
          "null",
        ].includes(item as string)
      )
        throw new ContentError("Invalid schema type");
      if (["description", "title"].includes(key) && typeof item !== "string")
        throw new ContentError(`Invalid schema ${key}`);
      if (
        [
          "minimum",
          "maximum",
          "minItems",
          "maxItems",
          "minLength",
          "maxLength",
        ].includes(key)
      ) {
        if (typeof item !== "number" || !Number.isFinite(item))
          throw new ContentError(`Invalid schema ${key}`);
        if (
          !["minimum", "maximum"].includes(key) &&
          (!Number.isInteger(item) || item < 0 || item > 100000)
        )
          throw new ContentError(`Invalid schema ${key}`);
      }
      if (key === "properties") {
        if (!item || typeof item !== "object" || Array.isArray(item))
          throw new ContentError("Schema properties must be an object");
        for (const child of Object.values(item)) visit(child, depth + 1);
      }
      if (
        key === "required" &&
        (!Array.isArray(item) ||
          item.some((name) => typeof name !== "string") ||
          new Set(item).size !== item.length)
      )
        throw new ContentError(
          "Schema required must list unique property names",
        );
      if (key === "additionalProperties" && typeof item !== "boolean")
        visit(item, depth + 1);
      if (key === "items") visit(item, depth + 1);
      if (["anyOf", "oneOf", "allOf"].includes(key)) {
        if (!Array.isArray(item) || item.length < 1 || item.length > 8)
          throw new ContentError(
            "Schema alternatives must contain 1–8 schemas",
          );
        for (const child of item) visit(child, depth + 1);
      }
      if (
        key === "enum" &&
        (!Array.isArray(item) || item.length < 1 || item.length > 128)
      )
        throw new ContentError("Schema enum must contain 1–128 values");
    }
  };
  visit(schema, 0);
  if ((schema as JsonObject).type !== "object")
    throw new ContentError("Top-level content schema must have type object");
  return schema as JsonObject;
}
export interface ContentRequest {
  namespace: string;
  key: string;
  prompt: string;
  schema: JsonObject;
  context?: Json;
}
export function parseContentRequest(input: unknown): ContentRequest {
  const value = z
    .object({
      namespace: namespaceSchema,
      key: z
        .string()
        .min(1)
        .max(160)
        .regex(/^[^\x00-\x1f\x7f]+$/),
      prompt: z.string().min(1).max(12000),
      schema: z.unknown(),
      context: z.unknown().optional(),
    })
    .strict()
    .parse(input);
  const result = {
    namespace: value.namespace,
    key: value.key,
    prompt: value.prompt,
    schema: validateContentSchema(value.schema),
    ...(value.context !== undefined
      ? {
          context: boundedJson(
            value.context,
            CONTENT_LIMITS.contextBytes,
            "Context",
          ),
        }
      : {}),
  };
  boundedJson(result, CONTENT_LIMITS.requestBytes, "Content request");
  return result;
}
export function validateContentResult(
  schema: JsonObject,
  input: unknown,
): JsonObject {
  const value = boundedJson(
    input,
    CONTENT_LIMITS.resultBytes,
    "Content result",
  );
  // Interpret the already bounded schema; do not compile or execute supplied code.
  if (!Check(Type.Unsafe<JsonObject>(schema), value))
    throw new ContentError(
      "Generated content does not match the project's JSON schema",
    );
  return value as JsonObject;
}
export interface ContentJob {
  id: string;
  namespace: string;
  key: string;
  status: "pending" | "running" | "ready" | "failed";
  attempt: number;
  createdAt: number;
  updatedAt: number;
  result?: JsonObject;
  error?: string;
}
export interface GameState {
  namespace: string;
  revision: number;
  state: Json;
  updatedAt: number | null;
}
export interface ContentGenerationRequest {
  request: ContentRequest;
  documents: { path: string; text: string }[];
  documentWarnings: string[];
  continuity?: {
    namespace: string;
    recentPublished: {
      id: string;
      key: string;
      value: Json;
      truncated: boolean;
    }[];
    savedState: { revision: number; value: Json; truncated: boolean };
  };
}
export type ContentGenerator = (
  request: ContentGenerationRequest,
  signal: AbortSignal,
) => Promise<unknown>;
export interface ContentGenerationOptions {
  maxAttempts?: number;
  concurrency?: number;
  maxQueued?: number;
  timeoutMs?: number;
  enabled?: boolean;
}
export interface ContentGenerationView {
  active: number;
  queued: number;
  budgetRemaining: number;
  blockedReason?: string;
}
export interface RuntimeData {
  version: 1;
  states: GameState[];
  jobs: {
    job: ContentJob & { status: "ready"; result: JsonObject };
    request: ContentRequest;
  }[];
}

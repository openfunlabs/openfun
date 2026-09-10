import type { Json } from "./content-types.js";

/** A bounded, structured excerpt, never an invented narrative summary. */
export function continuityExcerpt(value: Json, maxBytes = 6144) {
  if (Buffer.byteLength(JSON.stringify(value)) <= maxBytes)
    return { value, truncated: false };
  let remaining = maxBytes - 256;
  const visit = (item: Json, depth: number): Json => {
    if (remaining < 32 || depth > 8) return null;
    if (typeof item === "string") {
      const text = Array.from(item)
        .slice(0, Math.min(300, Math.floor(remaining / 8)))
        .join("");
      remaining -= Buffer.byteLength(JSON.stringify(text));
      return text;
    }
    if (item === null || typeof item !== "object") {
      remaining -= 24;
      return item;
    }
    if (Array.isArray(item)) {
      const result: Json[] = [];
      for (const child of item.slice(0, 16)) {
        if (remaining < 64) break;
        remaining -= 2;
        result.push(visit(child, depth + 1));
      }
      return result;
    }
    const result: Record<string, Json> = Object.create(null);
    for (const [key, child] of Object.entries(item)) {
      const cost = Buffer.byteLength(JSON.stringify(key)) + 3;
      if (remaining < cost + 64) continue;
      remaining -= cost;
      result[key] = visit(child, depth + 1);
    }
    return result;
  };
  return { value: visit(value, 0), truncated: true };
}

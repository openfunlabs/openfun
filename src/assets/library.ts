import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  relative,
  isAbsolute,
  basename,
  posix,
} from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import { parseKenneySearch, parseKenneyPage } from "./kenney.js";
import { parseMusicSearch, parseMusicPage } from "./opengameart.js";
import { validateGlb } from "../sharing/package.js";

const providerSchema = z.enum([
  "polyhaven",
  "ambientcg",
  "kenney",
  "opengameart",
]);
const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/);
export const searchAssetsSchema = z
  .object({
    source: z
      .enum(["local", "polyhaven", "ambientcg", "kenney", "opengameart"])
      .default("local"),
    query: z.string().max(160).default(""),
    kind: z
      .enum([
        "all",
        "models",
        "textures",
        "hdris",
        "sprites",
        "ui",
        "audio",
        "music",
      ])
      .default("all"),
    limit: z.number().int().min(1).max(20).default(8),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const assetInfoSchema = z
  .object({ provider: providerSchema, id: idSchema })
  .strict();
export const importAssetSchema = assetInfoSchema
  .extend({ variant: z.string().min(1).max(160) })
  .strict();
type Provider = z.infer<typeof providerSchema>;
export type Asset = {
  provider: Provider;
  id: string;
  name: string;
  kind: string;
  tags: string[];
  sourceUrl: string;
  license: "CC0-1.0";
  licenseUrl: string;
  credit: string;
  previewUrl?: string;
};
type File = { path: string; url: string; size: number; md5?: string };
type Variant = { key: string; bytes: number; files: File[]; archive?: boolean };
type Receipt = {
  asset: Asset;
  variant: string;
  importedAt: string;
  skippedFiles?: string[];
  files: { path: string; bytes: number; sha256: string }[];
};
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const fileLimit = 32 * 1024 * 1024;
const totalLimit = 64 * 1024 * 1024;
const hosts = new Set([
  "api.polyhaven.com",
  "kenney.nl",
  "opengameart.org",
  "dl.polyhaven.org",
  "cdn.polyhaven.com",
  "ambientcg.com",
  "acg-download.struffelproductions.com",
  "acg-media.struffelproductions.com",
]);
const cache = new Map<string, { time: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
function object(v: unknown): Record<string, any> {
  // API metadata is narrowed at the provider boundary below.
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Unexpected asset API response.");
  return v as Record<string, any>;
}
const resourcePattern =
  /\.(?:glb|gltf|bin|png|jpg|jpeg|hdr|exr|txt|ogg|wav|mp3)$/i;
function safePath(path: string, requireResource = true) {
  if (
    path.length > 240 ||
    !/^[a-zA-Z0-9_().\/ -]+$/.test(path) ||
    path.split("/").some((p) => !p || p.startsWith(".")) ||
    (requireResource && !resourcePattern.test(path))
  )
    throw new Error("Unsafe or unsupported asset file path.");
  return path;
}
function safeUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.has(url.hostname)
  )
    throw new Error("Asset URL is outside supported official hosts.");
  return url.toString();
}
async function bytes(
  url: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const bounded = AbortSignal.any([
    AbortSignal.timeout(60000),
    ...(signal ? [signal] : []),
  ]);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(safeUrl(url), {
      headers: { "User-Agent": "OpenFun/asset-library", Accept: "*/*" },
      redirect: "manual",
      signal: bounded,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Asset redirect has no destination.");
      url = safeUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Asset service HTTP ${response.status}.`);
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error(
        "Asset exceeds download size limit; select a smaller variant.",
      );
    }
    if (!response.body) throw new Error("Empty asset response.");
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        length += item.value.length;
        if (length > limit)
          throw new Error("Asset exceeds download size limit.");
        parts.push(item.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return Buffer.concat(parts);
  }
  throw new Error("Too many asset redirects.");
}
async function json(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const old = cache.get(url);
  if (old && Date.now() - old.time < 60 * 60 * 1000) return old.value;
  const value: unknown = JSON.parse(
    (await bytes(url, 12 * 1024 * 1024, signal)).toString("utf8"),
  );
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(url, { time: Date.now(), value });
  return value;
}
async function pageText(url: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const old = cache.get(url);
  if (old && typeof old.value === "string" && Date.now() - old.time < 3600000)
    return old.value;
  const value = (await bytes(url, 2 * 1024 * 1024, signal)).toString();
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(url, { time: Date.now(), value });
  return value;
}
function asset(
  provider: Provider,
  id: string,
  row: Record<string, any>,
): Asset {
  idSchema.parse(id);
  return {
    provider,
    id,
    name: String(row.name ?? row.displayName ?? id).slice(0, 200),
    kind:
      provider === "polyhaven"
        ? (["hdris", "textures", "models"][row.type] ?? "all")
        : ({ Material: "textures", HDRI: "hdris", "3DModel": "models" }[
            row.dataType as string
          ] ?? String(row.dataType ?? "all")),
    tags: Array.isArray(row.tags)
      ? row.tags.filter((t: unknown) => typeof t === "string").slice(0, 40)
      : [],
    sourceUrl:
      provider === "polyhaven"
        ? `https://polyhaven.com/a/${id}`
        : `https://ambientcg.com/a/${id}`,
    license: "CC0-1.0",
    licenseUrl:
      provider === "polyhaven"
        ? "https://polyhaven.com/license"
        : "https://docs.ambientcg.com/license/",
    credit:
      provider === "polyhaven"
        ? "Powered by Poly Haven"
        : "Assets from ambientCG",
    previewUrl:
      typeof row.thumbnail_url === "string"
        ? row.thumbnail_url
        : row.previewImage?.["256-PNG"],
  };
}
async function folder(cwd: string, parts: string[]) {
  const root = await realpath(cwd);
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    await mkdir(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Asset directories must not be symlinks.");
    path = await realpath(path);
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Asset path escapes the project.");
  }
  return path;
}
async function read(path: string, limit: number) {
  const f = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error("Invalid cached asset file.");
    return await f.readFile();
  } finally {
    await f.close();
  }
}
export async function searchAssets(
  cwd: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const p = searchAssetsSchema.parse(input);
  if (p.source === "local") {
    const rows: { asset: Asset; variant: string; directory: string }[] = [];
    const base = join(cwd, "game/assets/library");
    // Only inspect our receipts; arbitrary user asset folders remain accessible via pi read/bash.
    for (const provider of [
      "polyhaven",
      "ambientcg",
      "kenney",
      "opengameart",
    ]) {
      const dir = join(base, provider);
      const info = await lstat(dir).catch(() => undefined);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      for (const entry of (await readdir(dir, { withFileTypes: true })).slice(
        0,
        1000,
      )) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        try {
          const r = JSON.parse(
            (
              await read(join(dir, entry.name, "asset-source.json"), 256 * 1024)
            ).toString(),
          ) as Receipt;
          rows.push({
            asset: r.asset,
            variant: r.variant,
            directory: `res://assets/library/${provider}/${entry.name}`,
          });
        } catch {
          /* Incomplete/foreign receipts are not indexed. */
        }
      }
    }
    const filtered = rows.filter(
      (r) =>
        (p.kind === "all" ||
          r.asset.kind === p.kind ||
          (p.kind === "audio" && r.asset.kind === "music")) &&
        matches(r.asset, p.query),
    );
    return {
      source: "local",
      total: filtered.length,
      results: filtered.slice(p.offset, p.offset + p.limit),
      note: "Imported library receipts only; also inspect existing game/assets before creating assets.",
    };
  }
  if (p.source === "opengameart") {
    if (!["all", "music", "audio"].includes(p.kind))
      return {
        source: p.source,
        results: [],
        note: "OpenGameArt adapter supports music; use other providers for visual assets.",
      };
    const page = Math.floor(p.offset / 24),
      start = p.offset % 24;
    const query = new URLSearchParams({
      keys: p.query,
      "field_art_type_tid[]": "12",
      "field_art_licenses_tid[]": "4",
      page: String(page),
    });
    const parsed = parseMusicSearch(
      await pageText(
        `https://opengameart.org/art-search-advanced?${query}`,
        signal,
      ),
    );
    const results = parsed.results.slice(start, start + p.limit);
    return {
      source: p.source,
      results,
      nextOffset:
        start + results.length < parsed.results.length || parsed.hasNext
          ? p.offset + results.length
          : null,
      note: "Live CC0-filtered public-page music search, not an official API. Inspect individual file variants; audition before choosing, loop points/duration are not inferred from tags.",
    };
  }
  if (p.source === "kenney") {
    if (p.kind === "hdris")
      return {
        source: p.source,
        results: [],
        note: "Kenney has no dedicated HDRI category; use Poly Haven or ambientCG.",
      };
    const category = {
      models: "category:3D",
      sprites: "category:2D",
      audio: "category:Audio",
      music: "category:Audio",
      textures: "category:Textures",
      ui: "tag:interface",
      all: "",
    }[p.kind];
    const page = Math.floor(p.offset / 16) + 1,
      start = p.offset % 16;
    const url = `https://kenney.nl/assets${category ? `/${category}` : ""}/page:${page}?search=${encodeURIComponent(p.query)}`;
    const rows = parseKenneySearch(await pageText(url, signal));
    const results = rows.slice(start, start + p.limit);
    return {
      source: p.source,
      results,
      nextOffset:
        rows.length === 16 || start + results.length < rows.length
          ? p.offset + results.length
          : null,
      note: "Live public website adapter, not an official API; pages contain up to 16 packs. CC0 is rechecked on each download page. Inspect pack formats and animation coverage.",
    };
  }
  if (["sprites", "ui", "audio", "music"].includes(p.kind))
    return {
      source: p.source,
      results: [],
      note: "This provider does not expose this category; search Kenney.",
    };
  if (p.source === "polyhaven") {
    const data = object(
      await json(
        `https://api.polyhaven.com/assets${p.kind === "all" ? "" : `?t=${p.kind}`}`,
        signal,
      ),
    );
    const filtered = Object.entries(data)
      .map(([id, v]) => asset("polyhaven", id, object(v)))
      .filter((a) => matches(a, p.query));
    return {
      source: p.source,
      credit: "Powered by Poly Haven",
      total: filtered.length,
      results: filtered.slice(p.offset, p.offset + p.limit),
    };
  }
  const params = new URLSearchParams({
    q: p.query,
    limit: String(p.limit),
    offset: String(p.offset),
    include: "previewData",
  });
  if (p.kind !== "all")
    params.set(
      "type",
      { models: "3DModel", textures: "Material", hdris: "HDRI" }[
        p.kind as "models" | "textures" | "hdris"
      ],
    );
  const data = object(
    await json(`https://ambientcg.com/api/v2/full_json?${params}`, signal),
  );
  if (!Array.isArray(data.foundAssets))
    throw new Error("Missing ambientCG asset results.");
  return {
    source: p.source,
    total: data.numberOfResults,
    results: data.foundAssets.map((r: Record<string, any>) =>
      asset("ambientcg", r.assetId, r),
    ),
  };
}
function matches(a: Asset, query: string) {
  const text = `${a.id} ${a.name} ${a.tags.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((t) => text.includes(t));
}
function file(path: string, row: unknown): File {
  const r = object(row);
  if (typeof r.url !== "string" || !Number.isSafeInteger(r.size) || r.size <= 0)
    throw new Error("Invalid asset file metadata.");
  return {
    path: safePath(path),
    url: safeUrl(r.url),
    size: r.size,
    ...(typeof r.md5 === "string" ? { md5: r.md5 } : {}),
  };
}
async function detail(
  input: unknown,
  signal?: AbortSignal,
): Promise<{ asset: Asset; variants: Variant[] }> {
  const p = assetInfoSchema.parse(input),
    variants: Variant[] = [];
  let info: Asset;
  if (p.provider === "opengameart") {
    const page = parseMusicPage(
      p.id,
      await pageText(`https://opengameart.org/content/${p.id}`, signal),
    );
    return {
      asset: page.asset,
      variants: page.files.map((f) => ({
        key: f.key,
        bytes: f.size,
        files: [{ path: f.path, url: safeUrl(f.url), size: f.size }],
      })),
    };
  }
  if (p.provider === "kenney") {
    const page = parseKenneyPage(
      p.id,
      await pageText(`https://kenney.nl/assets/${p.id}`, signal),
    );
    return {
      asset: page.asset,
      variants: [
        {
          key: "pack",
          bytes: 0,
          archive: true,
          files: [{ path: "download.zip", url: safeUrl(page.url), size: 0 }],
        },
      ],
    };
  }
  if (p.provider === "polyhaven") {
    const catalog = object(
      await json("https://api.polyhaven.com/assets", signal),
    );
    if (!catalog[p.id]) throw new Error("Poly Haven asset not found.");
    info = asset(p.provider, p.id, object(catalog[p.id]));
    const tree = object(
      await json(`https://api.polyhaven.com/files/${p.id}`, signal),
    );
    for (const [map, resolutions] of Object.entries(tree)) {
      if (["blend", "fbx", "usd"].includes(map)) continue;
      for (const [resolution, formats] of Object.entries(object(resolutions))) {
        for (const [format, v] of Object.entries(object(formats))) {
          if (!["gltf", "jpg", "png", "hdr", "exr"].includes(format)) continue;
          const r = object(v),
            first = file(basename(new URL(r.url).pathname), r);
          const files = [
            first,
            ...Object.entries(r.include ?? {}).map(([name, r]) =>
              file(name, r),
            ),
          ];
          const total = files.reduce((n, f) => n + f.size, 0);
          if (
            files.length <= 64 &&
            files.every((f) => f.size <= fileLimit) &&
            total <= totalLimit
          )
            variants.push({
              key: `${map}/${resolution}/${format}`,
              bytes: total,
              files,
            });
        }
      }
    }
  } else {
    const data = object(
      await json(
        `https://ambientcg.com/api/v2/full_json?id=${p.id}&include=downloadData`,
        signal,
      ),
    );
    const r = data.foundAssets?.find(
      (a: Record<string, unknown>) => a.assetId === p.id,
    );
    if (!r) throw new Error("ambientCG asset not found.");
    info = asset(p.provider, p.id, r);
    for (const [name, folder] of Object.entries(r.downloadFolders ?? {})) {
      for (const [format, category] of Object.entries(
        object(folder).downloadFiletypeCategories ?? {},
      )) {
        if (!["zip", "hdr", "exr"].includes(format)) continue;
        for (const d of object(category).downloads ?? []) {
          if (
            !Number.isSafeInteger(d.size) ||
            d.size <= 0 ||
            d.size > fileLimit
          )
            continue;
          const path = format === "zip" ? "download.zip" : safePath(d.fileName);
          variants.push({
            key: `${name}/${d.attribute ?? d.fileName}`,
            bytes: d.size,
            files: [{ path, url: safeUrl(d.downloadLink), size: d.size }],
            ...(format === "zip" ? { archive: true } : {}),
          });
        }
      }
    }
  }
  return { asset: info, variants };
}
export async function assetInfo(input: unknown, signal?: AbortSignal) {
  const d = await detail(input, signal);
  return {
    asset: d.asset,
    variants: d.variants.map((v) => ({
      key: v.key,
      bytes: v.bytes || null,
      files: v.files.map((f) => f.path),
      archive: !!v.archive,
    })),
    note: "Choose a returned variant key. OpenGameArt offers individual CC0 music files; audition, verify loop seams and preserve source credits. Kenney uses pack (size unknown until download), with PNG/audio/GLB resources; unsupported source files are skipped. Start with 1k; model variants start with gltf/. Other Poly Haven variants are individual texture maps or HDRIs. Inspect the actual asset in Godot.",
  };
}
export async function importAsset(
  cwd: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const p = importAssetSchema.parse(input),
    lock = `${await realpath(cwd)}:${p.provider}:${p.id}:${p.variant}`;
  const running = inFlight.get(lock);
  if (running) return running;
  const task = importOne(cwd, p, signal);
  inFlight.set(lock, task);
  try {
    return await task;
  } finally {
    inFlight.delete(lock);
  }
}
async function importOne(
  cwd: string,
  p: z.infer<typeof importAssetSchema>,
  signal?: AbortSignal,
) {
  const parent = await folder(cwd, ["game", "assets", "library", p.provider]);
  const leaf = `${p.id}-${hash(p.variant).slice(0, 12)}`,
    dest = join(parent, leaf),
    resource = `res://assets/library/${p.provider}/${leaf}`;
  const existing = await lstat(dest).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
    return undefined;
  });
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new Error("Invalid existing asset directory.");
    const r = JSON.parse(
      (await read(join(dest, "asset-source.json"), 256 * 1024)).toString(),
    ) as Receipt;
    if (
      r.asset.provider !== p.provider ||
      r.asset.id !== p.id ||
      r.variant !== p.variant ||
      !Array.isArray(r.files) ||
      !r.files.length ||
      r.files.length > 512
    )
      throw new Error("Invalid asset receipt.");
    for (const f of r.files) {
      const path = join(dest, safePath(f.path));
      if (
        (await realpath(path)) !== path ||
        hash(await read(path, fileLimit)) !== f.sha256
      )
        throw new Error(
          "Imported asset was edited or damaged; preserve edits and use a separate variant/directory for replacement.",
        );
    }
    return {
      asset: r.asset,
      cached: true,
      skippedFiles: r.skippedFiles ?? [],
      directory: resource,
      files: r.files.map((f) => `${resource}/${f.path}`),
    };
  }
  const d = await detail({ provider: p.provider, id: p.id }, signal),
    variant = d.variants.find((v) => v.key === p.variant);
  if (!variant)
    throw new Error(
      "Unknown or oversized variant; inspect world_asset_info for supported choices.",
    );
  const stage = await mkdtemp(join(parent, ".import-"));
  try {
    const materialized = new Map<string, Uint8Array>();
    const skippedFiles: string[] = [];
    for (const f of variant.files) {
      const data = await bytes(f.url, fileLimit, signal);
      if (
        (f.size > 0 && data.length !== f.size) ||
        (f.md5 && createHash("md5").update(data).digest("hex") !== f.md5)
      )
        throw new Error("Asset size/checksum mismatch.");
      if (variant.archive) {
        let count = 0,
          total = 0;
        const unpacked = unzipSync(data, {
          filter(entry) {
            if (entry.name.endsWith("/")) return false;
            safePath(entry.name, false);
            count++;
            total += entry.originalSize;
            if (
              count > 4096 ||
              entry.originalSize > fileLimit ||
              total > totalLimit
            )
              throw new Error("Asset archive exceeds extraction limits.");
            if (!resourcePattern.test(entry.name)) {
              skippedFiles.push(entry.name);
              return false;
            }
            return true;
          },
        });
        for (const [name, b] of Object.entries(unpacked))
          materialized.set(name, b);
      } else materialized.set(f.path, data);
    }
    if (materialized.size > 512)
      throw new Error(
        "Asset pack contains too many resources; choose a smaller pack or manually select a subset.",
      );
    if (!materialized.size)
      throw new Error("Asset contains no supported files.");
    for (const [name, data] of materialized) {
      const hasDependency = (uri: string) => {
        // Resolve relative to each model, not the pack root; never invoke remote/data URI handlers.
        if (uri.startsWith("/") || /[:%?#\\]/.test(uri)) return false;
        return materialized.has(
          safePath(posix.normalize(posix.join(posix.dirname(name), uri))),
        );
      };
      if (name.toLowerCase().endsWith(".glb")) validateGlb(data, hasDependency);
      if (name.endsWith(".gltf")) {
        const doc = object(JSON.parse(Buffer.from(data).toString()));
        for (const ref of [...(doc.buffers ?? []), ...(doc.images ?? [])]) {
          if (ref.uri && !hasDependency(ref.uri))
            throw new Error("glTF has missing or external dependencies.");
        }
      }
      const target = join(stage, safePath(name));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data, { flag: "wx" });
    }
    const receipt: Receipt = {
      asset: d.asset,
      variant: p.variant,
      importedAt: new Date().toISOString(),
      skippedFiles,
      files: [...materialized].map(([path, b]) => ({
        path,
        bytes: b.length,
        sha256: hash(b),
      })),
    };
    await writeFile(
      join(stage, "asset-source.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx" },
    );
    await writeFile(
      join(stage, "ASSET-LICENSE.md"),
      `# ${d.asset.name}\n\n${d.asset.credit}\n\nSource: ${d.asset.sourceUrl}\n\nLicense: ${d.asset.license}\n${d.asset.licenseUrl}\n\nImported by OpenFun; not generated by AI.\n`,
    );
    signal?.throwIfAborted();
    await rename(stage, dest);
    return {
      asset: d.asset,
      cached: false,
      skippedFiles,
      directory: resource,
      files: receipt.files.map((f) => `${resource}/${f.path}`),
      next:
        d.asset.kind === "music"
          ? "Audition this music, verify loop seams, transitions, Music/SFX buses and mute in Godot. Record source and in-game use in design/audio.md; reuse across suitable later content. Download success does not establish musical suitability."
          : "Inspect these actual resources and integrate materials, scale and collision in Godot. Record their use in design/art.md; reuse them for later levels. A downloaded resource is not a finished scene.",
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

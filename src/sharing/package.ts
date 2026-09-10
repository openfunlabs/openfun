import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import { z } from "zod";
import type { PortableWorld } from "../world/schema.js";
import { WorldStore } from "../world/world.js";
import {
  exportRuntimeData,
  importRuntimeData,
} from "../generation/content-store.js";
import { projectRuntimeFromFiles } from "../godot/project-types.js";
import {
  collectProjectFiles,
  projectPackagePath,
  restoreProjectFiles,
} from "./project-files.js";

export const PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  snapshotBytes: 16 * 1024 * 1024,
  manifestBytes: 2 * 1024 * 1024,
  entries: 4096,
});
export const PACKAGE_RUNTIME_VERSION = "0.1" as const;
const capabilities = ["world.snapshot.v1", "assets.glb.v2"] as const;
const digestPattern = /^[a-f0-9]{64}$/;
const assetPattern = /^[a-f0-9]{64}\.glb$/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const manifestSchema = z
  .object({
    formatVersion: z.literal(1),
    worldId: z.string().min(1).max(160),
    releaseId: z.string().min(1).max(160),
    runtimeVersion: z.literal(PACKAGE_RUNTIME_VERSION),
    capabilities: z
      .array(
        z.enum([
          "world.snapshot.v1",
          "assets.glb.v2",
          "game.godot.v1",
          "game.state.v1",
        ]),
      )
      .min(2)
      .max(4)
      .refine(
        (values) =>
          values[0] === capabilities[0] &&
          values[1] === capabilities[1] &&
          new Set(values).size === values.length,
      ),
    license: z.string().min(1).max(200),
    files: z.record(
      z.string(),
      z
        .object({
          sha256: z.string().regex(digestPattern),
          bytes: z.number().int().min(0).max(PACKAGE_LIMITS.entryBytes),
        })
        .strict(),
    ),
  })
  .strict();
export type PackageManifest = z.infer<typeof manifestSchema>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(decoder.decode(bytes)) as unknown;
}

function allowedPath(path: string): boolean {
  return (
    path === "manifest.json" ||
    path === "snapshot.json" ||
    path === "runtime.json" ||
    projectPackagePath(path) ||
    /^assets\/[a-f0-9]{64}\.glb$/.test(path)
  );
}

function byteLimit(path: string): number {
  return path === "manifest.json"
    ? PACKAGE_LIMITS.manifestBytes
    : path === "snapshot.json"
      ? PACKAGE_LIMITS.snapshotBytes
      : PACKAGE_LIMITS.entryBytes;
}

function assetNames(world: PortableWorld): string[] {
  const names = new Set<string>(Object.values(world.spec.assets));
  for (const chunk of world.chunks)
    for (const entity of chunk.entities) {
      if (entity.asset) names.add(entity.asset);
    }
  for (const name of names)
    if (!assetPattern.test(name)) throw new Error("Invalid asset reference");
  return [...names].sort();
}

async function readRegularFile(path: string, limit: number): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit)
      throw new Error(
        `File is not regular or exceeds byte limit: ${basename(path)}`,
      );
    // An explicit bounded read also avoids allocating unbounded memory if the file grows.
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!read.bytesRead) throw new Error("File changed while being read");
      offset += read.bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Standalone runtime assets reject URIs. A library importer may resolve references
 * only against the files already materialized inside the same asset pack. */
export function validateGlb(
  bytes: Uint8Array,
  resolveUri?: (uri: string) => boolean,
): void {
  if (bytes.byteLength < 20) throw new Error("Invalid GLB header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error("Invalid GLB header");
  let offset = 12;
  let chunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error("Invalid GLB chunk");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength)
      throw new Error("Invalid GLB chunk length");
    if (chunks === 0) {
      if (type !== 0x4e4f534a) throw new Error("GLB must start with JSON");
      const json = parseJson(bytes.subarray(offset + 8, offset + 8 + length));
      const document = z
        .object({ asset: z.object({ version: z.literal("2.0") }) })
        .passthrough()
        .parse(json);
      // Runtime receives data only. This v1 subset uses the binary chunk for buffers/images,
      // rejecting both remote references and data URIs rather than invoking URI handlers.
      const pending: unknown[] = [document];
      while (pending.length) {
        const item = pending.pop();
        if (!item || typeof item !== "object") continue;
        for (const [key, value] of Object.entries(item)) {
          if (
            key === "uri" &&
            !(typeof value === "string" && resolveUri?.(value))
          )
            throw new Error(
              "GLB must be self-contained: URI references are forbidden",
            );
          if (value && typeof value === "object") pending.push(value);
        }
      }
    } else if (chunks !== 1 || type !== 0x004e4942) {
      throw new Error("Unsupported GLB chunk");
    }
    chunks++;
    offset += 8 + length;
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++)
    n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Parse the directory before inflating. Do not trust ZIP size hints as allocation limits. */
function readZip(archive: Buffer): Map<string, Uint8Array> {
  if (archive.length < 22 || archive.length > PACKAGE_LIMITS.archiveBytes)
    throw new Error("Invalid archive byte size");
  const end = archive.length - 22;
  if (
    archive.readUInt32LE(end) !== 0x06054b50 ||
    archive.readUInt16LE(end + 20) !== 0 ||
    archive.readUInt16LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 6) !== 0
  ) {
    throw new Error("Unsupported ZIP footer, comment, or multiple disks");
  }
  const count = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryOffset = archive.readUInt32LE(end + 16);
  if (
    count < 2 ||
    count > PACKAGE_LIMITS.entries ||
    archive.readUInt16LE(end + 8) !== count ||
    directoryOffset + directorySize !== end
  )
    throw new Error("Invalid ZIP directory or entry limit");
  const entries: {
    path: string;
    method: number;
    crc: number;
    size: number;
    start: number;
    finish: number;
    local: number;
  }[] = [];
  const names = new Set<string>();
  let position = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || archive.readUInt32LE(position) !== 0x02014b50)
      throw new Error("Invalid ZIP directory entry");
    const flags = archive.readUInt16LE(position + 8);
    const method = archive.readUInt16LE(position + 10);
    const crc = archive.readUInt32LE(position + 16);
    const compressed = archive.readUInt32LE(position + 20);
    const size = archive.readUInt32LE(position + 24);
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const attributes = archive.readUInt32LE(position + 38);
    const local = archive.readUInt32LE(position + 42);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error("Truncated ZIP directory");
    const path = decoder.decode(
      archive.subarray(position + 46, position + 46 + nameLength),
    );
    const unixType = (attributes >>> 16) & 0xf000;
    if (
      !allowedPath(path) ||
      names.has(path) ||
      (unixType !== 0 && unixType !== 0x8000) ||
      attributes & 0x10
    )
      throw new Error("Unsafe ZIP path, duplicate, or symbolic link");
    if (
      (flags & ~0x800) !== 0 ||
      (method !== 0 && method !== 8) ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      archive.readUInt16LE(position + 34) !== 0
    )
      throw new Error("Unsupported ZIP features");
    if (
      size > byteLimit(path) ||
      compressed > PACKAGE_LIMITS.archiveBytes ||
      (method === 0 && size !== compressed)
    ) {
      throw new Error("ZIP entry exceeds byte limit or has invalid size");
    }
    total += size;
    if (total > PACKAGE_LIMITS.totalBytes)
      throw new Error("ZIP exceeds total decompressed byte limit");
    if (
      local + 30 > directoryOffset ||
      archive.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error("Invalid ZIP local header");
    const localNameLength = archive.readUInt16LE(local + 26);
    const localExtraLength = archive.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    const finish = start + compressed;
    if (
      finish > directoryOffset ||
      localExtraLength !== 0 ||
      localNameLength !== nameLength ||
      decoder.decode(archive.subarray(local + 30, start)) !== path ||
      archive.readUInt16LE(local + 6) !== flags ||
      archive.readUInt16LE(local + 8) !== method ||
      archive.readUInt32LE(local + 14) !== crc ||
      archive.readUInt32LE(local + 18) !== compressed ||
      archive.readUInt32LE(local + 22) !== size
    )
      throw new Error("ZIP headers disagree");
    entries.push({ path, method, crc, size, start, finish, local });
    names.add(path);
    position = next;
  }
  if (position !== end) throw new Error("Invalid ZIP directory length");
  let localEnd = 0;
  for (const entry of [...entries].sort((a, b) => a.local - b.local)) {
    if (entry.local !== localEnd)
      throw new Error("Overlapping or non-contiguous ZIP entries");
    localEnd = entry.finish;
  }
  if (localEnd !== directoryOffset) throw new Error("Unexpected ZIP payload");
  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const compressed = archive.subarray(entry.start, entry.finish);
    const bytes =
      entry.method === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: Math.max(1, entry.size),
          });
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc)
      throw new Error("ZIP size or checksum mismatch");
    files.set(entry.path, bytes);
  }
  return files;
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Destination already exists: ${path}`);
}

/** Export only the validated portable snapshot and its referenced content-addressed assets. */
export async function packWorld(
  worldDir: string,
  output: string,
): Promise<PackageManifest> {
  const destination = resolve(output);
  await ensureAbsent(destination);
  const store = new WorldStore(worldDir);
  let world: PortableWorld;
  try {
    world = store.exportWorld();
  } finally {
    store.close();
  }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  files["snapshot.json"] = Buffer.from(JSON.stringify(world));
  if (files["snapshot.json"].length > PACKAGE_LIMITS.snapshotBytes)
    throw new Error("Snapshot exceeds byte limit");
  const names = assetNames(world);
  if (names.length + 2 > PACKAGE_LIMITS.entries)
    throw new Error("World exceeds package entry limit");
  if (names.length && !(await lstat(join(worldDir, "assets"))).isDirectory())
    throw new Error("Assets must be a regular directory");
  let total = files["snapshot.json"].length;
  for (const name of names) {
    const bytes = await readRegularFile(
      join(worldDir, "assets", name),
      PACKAGE_LIMITS.entryBytes,
    );
    if (`${sha256(bytes)}.glb` !== name)
      throw new Error("Asset content hash mismatch");
    validateGlb(bytes);
    total += bytes.length;
    if (total > PACKAGE_LIMITS.totalBytes)
      throw new Error("World exceeds decompressed byte limit");
    files[`assets/${name}`] = bytes;
  }
  const projectFiles = await collectProjectFiles(worldDir);
  const runtime = exportRuntimeData(worldDir);
  if (runtime.jobs.length || runtime.states.length) {
    const bytes = Buffer.from(JSON.stringify(runtime));
    if (bytes.length > PACKAGE_LIMITS.entryBytes)
      throw new Error("Game runtime data exceeds package entry limit");
    projectFiles["runtime.json"] = bytes;
  }
  for (const [path, bytes] of Object.entries(projectFiles)) {
    total += bytes.length;
    files[path] = bytes;
  }
  if (
    Object.keys(files).length + 1 > PACKAGE_LIMITS.entries ||
    total > PACKAGE_LIMITS.totalBytes
  )
    throw new Error("World project exceeds package limits");
  if (Object.keys(projectFiles).length) {
    // A source change must produce a new immutable release even when the legacy
    // world's SQLite revision is unchanged. UUIDv8 holds a content-derived ID.
    const bytes = Buffer.from(
      sha256(
        Buffer.from(
          JSON.stringify({
            ...world,
            releaseId: undefined,
            projectFiles: Object.entries(projectFiles).map(([path, data]) => [
              path,
              sha256(data),
            ]),
          }),
        ),
      ),
      "hex",
    ).subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x80;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    world.releaseId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    files["snapshot.json"] = Buffer.from(JSON.stringify(world));
  }
  const manifest: PackageManifest = {
    formatVersion: 1,
    worldId: world.worldId,
    releaseId: world.releaseId,
    runtimeVersion: PACKAGE_RUNTIME_VERSION,
    capabilities: [
      ...capabilities,
      ...(projectRuntimeFromFiles(new Map(Object.entries(files)))?.engine ===
      "godot"
        ? ["game.godot.v1" as const]
        : []),
      ...(files["runtime.json"] ? ["game.state.v1" as const] : []),
    ],
    license: "UNLICENSED",
    files: Object.fromEntries(
      Object.entries(files).map(([path, bytes]) => [
        path,
        { sha256: sha256(bytes), bytes: bytes.length },
      ]),
    ),
  };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  if (
    files["manifest.json"].length > PACKAGE_LIMITS.manifestBytes ||
    total + files["manifest.json"].length > PACKAGE_LIMITS.totalBytes
  )
    throw new Error("Manifest exceeds package byte limit");
  const archive = zipSync(files, { level: 6 });
  if (archive.length > PACKAGE_LIMITS.archiveBytes)
    throw new Error("Package exceeds compressed byte limit");
  const staging = await mkdtemp(join(dirname(destination), ".openfun-pack-"));
  const temporaryFile = join(staging, "world.openfun");
  try {
    const handle = await open(temporaryFile, "wx", 0o600);
    try {
      await handle.writeFile(archive);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A same-filesystem hard link publishes atomically and never replaces an existing file.
    await link(temporaryFile, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return manifest;
}

/** Import data to a new world directory; nothing from the archive is extracted by path. */
export async function importWorld(
  packageFile: string,
  targetDir: string,
): Promise<PackageManifest> {
  const destination = resolve(targetDir);
  await ensureAbsent(destination);
  const files = readZip(
    await readRegularFile(packageFile, PACKAGE_LIMITS.archiveBytes),
  );
  const manifestBytes = files.get("manifest.json");
  const snapshotBytes = files.get("snapshot.json");
  if (!manifestBytes || !snapshotBytes)
    throw new Error("Package is missing manifest or snapshot");
  const parsed = manifestSchema.safeParse(parseJson(manifestBytes));
  if (!parsed.success)
    throw new Error("Invalid or incompatible package manifest", {
      cause: parsed.error,
    });
  const manifest = parsed.data;
  const projectEntries = [...files.keys()].filter(projectPackagePath);
  const projectRuntime = projectRuntimeFromFiles(files);
  if (
    manifest.capabilities.includes("game.godot.v1") !==
      (projectRuntime?.engine === "godot") ||
    manifest.capabilities.includes("game.state.v1") !==
      files.has("runtime.json")
  )
    throw new Error("Package project capabilities do not match its contents");
  if (Object.keys(manifest.files).length !== files.size - 1)
    throw new Error("Manifest file list mismatch");
  for (const [path, expected] of Object.entries(manifest.files)) {
    const bytes = files.get(path);
    if (
      path === "manifest.json" ||
      !allowedPath(path) ||
      !bytes ||
      bytes.length !== expected.bytes ||
      sha256(bytes) !== expected.sha256
    )
      throw new Error("Package file hash or size mismatch");
    if (path.startsWith("assets/")) {
      if (path !== `assets/${expected.sha256}.glb`)
        throw new Error("Asset filename hash mismatch");
      validateGlb(bytes);
    }
  }
  const portable: unknown = parseJson(snapshotBytes);
  const staging = await mkdtemp(join(dirname(destination), ".openfun-import-"));
  let reservation = false;
  try {
    const store = WorldStore.importWorld(staging, portable);
    store.close();
    // importWorld has validated the portable schema and world invariants. Exporting
    // again would create a new release identity rather than inspect this release.
    const verified = portable as PortableWorld;
    if (
      verified.worldId !== manifest.worldId ||
      verified.releaseId !== manifest.releaseId
    )
      throw new Error("Manifest world identity mismatch");
    const names = assetNames(verified);
    if (
      names.length +
        2 +
        projectEntries.length +
        (files.has("runtime.json") ? 1 : 0) !==
      files.size
    )
      throw new Error("Package contains unreferenced assets");
    await mkdir(join(staging, "assets"), { recursive: true });
    for (const name of names) {
      const bytes = files.get(`assets/${name}`);
      if (!bytes) throw new Error("Package is missing a referenced asset");
      const handle = await open(join(staging, "assets", name), "wx", 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
    }
    await restoreProjectFiles(staging, files);
    const runtimeBytes = files.get("runtime.json");
    if (runtimeBytes) importRuntimeData(staging, parseJson(runtimeBytes));
    // Exclusive reservation closes the destination check/rename race. Only our empty
    // reservation is replaced; an existing user directory is never overwritten.
    await mkdir(destination);
    reservation = true;
    await rename(staging, destination);
    reservation = false;
  } catch (error) {
    if (reservation) await rmdir(destination).catch(() => undefined);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return manifest;
}

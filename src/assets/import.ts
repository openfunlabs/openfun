import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { validateGlb, PACKAGE_LIMITS } from "../sharing/package.js";
import { WorldStore } from "../world/world.js";

async function boundedFile(path: string): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > PACKAGE_LIMITS.entryBytes)
      throw new Error("Asset must be a regular GLB file no larger than 32 MiB");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!read.bytesRead) throw new Error("Asset changed while reading");
      offset += read.bytesRead;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Import data-only assets from an independently installed 3D model backend. */
export async function importAsset(worldDir: string, source: string) {
  const dir = resolve(worldDir);
  // Import never creates a world implicitly or changes its published entities.
  const store = new WorldStore(dir);
  store.close();
  const content = await boundedFile(resolve(source));
  validateGlb(content);
  const asset = `${createHash("sha256").update(content).digest("hex")}.glb`;
  const assetsDir = join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const stat = await lstat(assetsDir);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Assets directory must be a regular directory");
  const temporary = join(assetsDir, `.import-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    try {
      await link(temporary, join(assetsDir, asset));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!(await boundedFile(join(assetsDir, asset))).equals(content))
        throw new Error("Existing content-addressed asset is damaged");
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return { asset, bytes: content.length, name: basename(source, ".glb") };
}

import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { projectRuntimeFromFiles } from "../godot/project-types.js";

const resourceExtension =
  /\.(?:godot|gd|tscn|tres|gdshader|gdshaderinc|uid|import|png|jpe?g|webp|svg|ogg|wav|mp3|ttf|otf|woff2?|glb|gltf|bin|hdr|exr|json|md|txt)$/i;

export function projectPackagePath(path: string): boolean {
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part.startsWith("."))) return false;
  if (
    parts.some(
      (part) =>
        part === "node_modules" ||
        /(?:^|[._-])(?:auth|credentials?|secrets?|tokens?|api[_-]?keys?|service[_-]?account)(?:[._-]|$)/i.test(
          part,
        ),
    )
  )
    return false;
  return (
    (parts[0] === "game" && resourceExtension.test(path)) ||
    (parts[0] === "design" && path.endsWith(".md"))
  );
}

/** Include only project resources and public design notes, never author configuration. */
export async function collectProjectFiles(
  worldDir: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  async function visit(relative: string) {
    const path = join(worldDir, relative);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink())
      throw new Error(`Cannot package symbolic link: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        await visit(`${relative}/${entry}`);
      }
    } else if (info.isFile()) {
      if (!projectPackagePath(relative))
        throw new Error(
          `Unsupported game resource in share package: ${relative}`,
        );
      if (info.size > 32 * 1024 * 1024)
        throw new Error(`Game resource exceeds package limit: ${relative}`);
      total += info.size;
      if (total > 96 * 1024 * 1024)
        throw new Error(
          `Game project exceeds the 96 MiB resource budget at ${relative} (${total} bytes). Keep needed game assets and source/license records; move unused originals outside game/ before previewing or sharing.`,
        );
      // Library packs plus Godot .import settings routinely exceed 480 files.
      // Keep bounded counts and the existing byte limits; preserve import settings.
      if (Object.keys(files).length >= 4000)
        throw new Error(
          `Game project exceeds the 4000 resource-file limit at ${relative}. Select a coherent subset of library assets and retain its source/license records.`,
        );
      const handle = await open(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.size !== info.size)
          throw new Error(
            `Game resource changed during packaging: ${relative}`,
          );
        const bytes = Buffer.alloc(current.size);
        let offset = 0;
        while (offset < bytes.length) {
          const read = await handle.read(
            bytes,
            offset,
            bytes.length - offset,
            offset,
          );
          if (!read.bytesRead)
            throw new Error("Game resource changed during packaging");
          offset += read.bytesRead;
        }
        files[relative] = bytes;
      } finally {
        await handle.close();
      }
    } else throw new Error(`Unsupported game resource: ${relative}`);
  }
  await visit("game");
  await visit("design");
  projectRuntimeFromFiles(new Map(Object.entries(files)));
  return files;
}

export async function restoreProjectFiles(
  worldDir: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for (const [path, bytes] of files) {
    if (!projectPackagePath(path)) continue;
    const destination = join(worldDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
  if (projectRuntimeFromFiles(files)) {
    await mkdir(join(worldDir, ".openfun"), { recursive: true });
    await writeFile(
      join(worldDir, ".openfun", "imported-project.json"),
      JSON.stringify({ executableProject: true }),
      { flag: "wx", mode: 0o600 },
    );
  }
}

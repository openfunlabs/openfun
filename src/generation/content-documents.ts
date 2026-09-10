import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  CONTENT_LIMITS,
  ContentError,
  type ContentGenerationRequest,
} from "./content-types.js";

/** Explicit creative documents only; never scan agent sessions, credentials or arbitrary project files. */
export function readContentDocuments(
  worldDir: string,
  projectDir = join(worldDir, "game"),
): Pick<ContentGenerationRequest, "documents" | "documentWarnings"> {
  const documents: ContentGenerationRequest["documents"] = [];
  const documentWarnings: string[] = [];
  const root = resolve(worldDir);
  let total = 0;
  let entries = 0;
  function add(path: string, label: string): void {
    if (!existsSync(path)) {
      documentWarnings.push(`Optional design document is absent: ${label}`);
      return;
    }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new ContentError(
        `Design document must be a regular non-symlink file: ${label}`,
      );
    if (documents.length >= 32)
      throw new ContentError("Too many world design documents (maximum 32)");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!fstatSync(fd).isFile())
        throw new ContentError(`Invalid design document: ${label}`);
      const max = Math.min(64 * 1024, CONTENT_LIMITS.documentBytes - total);
      const bytes = Buffer.alloc(max + 1);
      let count = 0;
      while (count < bytes.length) {
        const n = readSync(fd, bytes, count, bytes.length - count, null);
        if (!n) break;
        count += n;
      }
      if (count > max)
        throw new ContentError(
          "World design documents exceed the per-file or total byte limit",
        );
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, count),
      );
      documents.push({ path: label, text });
      total += count;
    } finally {
      closeSync(fd);
    }
  }
  function walk(dir: string, depth: number): void {
    if (depth > 4)
      throw new ContentError("World design directory nesting exceeds 4 levels");
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ContentError("World design directory must not be a symlink");
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (++entries > 128)
        throw new ContentError(
          "World design directory contains too many entries",
        );
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new ContentError(
          "World design documents may not contain symbolic links",
        );
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.name.toLowerCase().endsWith(".md"))
        add(path, relative(root, path).replaceAll("\\", "/"));
    }
  }
  add(join(root, "WORLD.md"), "WORLD.md");
  const design = join(root, "design");
  if (existsSync(design)) walk(design, 0);
  else documentWarnings.push("Optional design directory is absent: design/");
  const project = resolve(projectDir);
  if (
    existsSync(project) &&
    (!lstatSync(project).isDirectory() || lstatSync(project).isSymbolicLink())
  )
    throw new ContentError("Game project directory must not be a symlink");
  add(join(project, "DESIGN.md"), "game/DESIGN.md");
  return { documents, documentWarnings };
}

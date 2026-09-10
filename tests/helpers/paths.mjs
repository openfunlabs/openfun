import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const version = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
export const output = (...parts) => resolve(root, ".output", ...parts);

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { WorldStore } from "./world.js";

export function openfunHome(): string {
  return resolve(process.env.OPENFUN_HOME ?? join(homedir(), ".openfun"));
}

export function rememberWorld(worldDir: string): void {
  const home = openfunHome();
  mkdirSync(home, { recursive: true });
  const temporary = join(home, `recent.${randomUUID()}.tmp`);
  writeFileSync(
    temporary,
    JSON.stringify({ directory: resolve(worldDir) }) + "\n",
    { mode: 0o600 },
  );
  renameSync(temporary, join(home, "recent.json"));
}

export function createLocalWorld(name = "New World"): string {
  const directory = join(openfunHome(), "worlds", randomUUID());
  const store = WorldStore.create(directory, {
    name: name.trim() || "New World",
    seed: randomUUID(),
  });
  store.close();
  rememberWorld(directory);
  return directory;
}

/** Open exactly this directory; neither recent worlds nor parent worlds are selected. */
export function openOrCreateWorld(directory: string): string {
  directory = resolve(directory);
  if (existsSync(join(directory, "world.sqlite"))) {
    const store = new WorldStore(directory);
    try {
      store.getSpec();
    } finally {
      store.close();
    }
  } else {
    if (existsSync(join(directory, "WORLD.md"))) {
      throw new Error(
        `Cannot create a world in ${directory}: WORLD.md already exists without world.sqlite. Restore the world database or choose another directory.`,
      );
    }
    WorldStore.create(directory, {
      name: basename(directory) || "New World",
      seed: randomUUID(),
    }).close();
  }
  return directory;
}

export function listLocalWorlds(): { directory: string; name: string }[] {
  const worlds = join(openfunHome(), "worlds");
  if (!existsSync(worlds)) return [];
  return readdirSync(worlds, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .flatMap((item) => {
      const directory = join(worlds, item.name);
      try {
        const store = new WorldStore(directory);
        try {
          return [{ directory, name: store.getSpec().name }];
        } finally {
          store.close();
        }
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

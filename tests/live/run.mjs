import { runScript } from "../helpers/process.mjs";
const [name, ...args] = process.argv.slice(2).filter((arg) => arg !== "--");
if (
  ![
    "creation",
    "chunks",
    "levels",
    "images",
    "meshy",
    "animation",
    "library",
    "resources",
  ].includes(name)
)
  throw new Error(
    "Choose an explicit live test: creation, chunks, levels, or images <codex-model-id> [reference]. Or library [project] or resources [project]. Or meshy <project> <reference> <revision-key>. Or animation <project> <model-key> <prefix> <attack-id> <hit-id> <death-id>. These tests use model quota or separate Meshy API credits.",
  );
await runScript(`tests/live/${name}.mjs`, args, 25 * 60 * 1000);

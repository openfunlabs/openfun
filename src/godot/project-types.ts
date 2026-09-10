export interface GameProject {
  engine: "godot";
  project: string;
  entry: "project.godot";
}

/** Archives and local projects use the same Godot entry point. */
export function projectRuntimeFromFiles(files: Map<string, Uint8Array>) {
  if (files.has("game/openfun.runtime.json"))
    throw new Error(
      "Runtime descriptors are unsupported; use a Godot project.",
    );
  if (files.has("game/project.godot"))
    return { engine: "godot" as const, entry: "project.godot" as const };
  if ([...files.keys()].some((file) => file.startsWith("game/")))
    throw new Error("Game source is missing project.godot");
  return undefined;
}

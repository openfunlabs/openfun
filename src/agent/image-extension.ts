import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { z } from "zod";
import { generateImage, imageParamsSchema } from "../assets/images.js";

/** Native pi tool: authentication and model selection stay in pi. */
export default function imageExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "world_generate_image",
    label: "Generate game art",
    description:
      "Generate concept art, textures, sprites or text-free UI skins/icons, or edit using local reference images. For new-game UI, set purpose=ui and generate reusable non-text elements with clear text-safe areas; Godot supplies labels, numbers, layout and interaction. Inspect actual alpha and dimensions; transparency and exact atlas geometry are not guaranteed. Uses the current Codex subscription model and hosted GPT Image 2.5 Sunburst by default; imageModel can select Flare or explicitly select legacy GPT Image 2. No silent downgrade if subscription access rejects a model. Saves a new PNG under game/assets/generated/ in the current project. Consumes subscription quota. References must be inside the project. Returns the generated image for immediate visual inspection. Required by default for new-game art: generate and inspect a gameplay visual target before final modeling or scene dressing, then create suitable in-game raster assets or isolated modeling references. Integrate the results and compare real gameplay renders; a concept image alone is not finished game art or a 3D model.",
    parameters: Type.Unsafe<z.input<typeof imageParamsSchema>>(
      z.toJSONSchema(imageParamsSchema, { io: "input" }),
    ),
    async execute(_id, params, signal, _update, ctx) {
      const result = await generateImage(ctx, params, signal);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result) },
          {
            type: "image" as const,
            data: (await readFile(result.path)).toString("base64"),
            mimeType: "image/png",
          },
        ],
        details: result,
      };
    },
  });
}

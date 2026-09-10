import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type Provider = NonNullable<
  ReturnType<ExtensionContext["modelRegistry"]["getProvider"]>
>;

/** Auth-only services use pi's native secret prompt and OpenFun-owned credential store. */
export function assetProvider(id: "meshy" | "tripo"): Provider {
  const name = id === "meshy" ? "Meshy" : "Tripo";
  const env = `${id.toUpperCase()}_API_KEY`;
  const unsupported = () => {
    throw new Error(`${name} is an asset service, not a conversation model.`);
  };
  return {
    id,
    name:
      id === "meshy"
        ? "Meshy (3D assets)"
        : "Tripo (credentials only; generation not yet integrated)",
    auth: {
      apiKey: {
        name: `${name} API key`,
        async login(interaction) {
          interaction.notify({
            type: "info",
            message:
              id === "meshy"
                ? "Meshy uses separate API credits. Your key is stored in OpenFun's private profile, outside shared games. Saving a key does not validate it or create a model."
                : "Tripo key storage is available; Tripo generation is not yet integrated. Your key is stored in OpenFun's private profile.",
          });
          const key = (
            await interaction.prompt({
              type: "secret",
              message: `${name} API key`,
            })
          ).trim();
          interaction.signal.throwIfAborted();
          if (!key || key.length > 4096 || /\s|[\u0000-\u001f\u007f]/.test(key))
            throw new Error("Enter a non-empty API key without whitespace.");
          return { type: "api_key", key };
        },
        async resolve({ ctx, credential, signal }) {
          signal.throwIfAborted();
          const key = credential?.key ?? (await ctx.env(env));
          return key
            ? {
                auth: { apiKey: key },
                source: credential?.key ? "stored credential" : env,
              }
            : undefined;
        },
      },
    },
    getModels: () => [],
    stream: unsupported,
    streamSimple: unsupported,
  };
}

# Configuration

This page describes the current CLI. Independent text/image provider configuration and local multimodal inference are [roadmap](roadmap.md) goals; the existing image tool still depends on a Codex conversation model.

## Installation and bundled tools

OpenFun requires Node.js 22.19+ and Godot 4. Blender is needed for Blender-based asset work. Engine binaries and large models are not bundled. Run `openfun setup` or configure tool paths as described below.

pi, the MCP adapter, Context Mode and the official questionnaire extension are package dependencies; no global pi installation or `pi install` is required. See [package.json](../package.json) for pinned versions.

| Component                                             | Entry point                                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| pi conversations, login, models and development tools | `openfun`, `/login`, `/model`                                                             |
| MCP adapter                                           | `/mcp`, `/mcp setup`                                                                      |
| Context Mode                                          | `/ctx-stats`, `/ctx-doctor`; agent tools such as `ctx_execute`, `ctx_index`, `ctx_search` |
| Questionnaire                                         | Native questions when the creator needs input; cancelable                                 |
| Image extension                                       | `world_generate_image`, using OpenFun's Codex login                                       |
| Asset extension                                       | Reusable libraries and experimental Meshy tools                                           |

No Plan extension is loaded by default. You can discuss a plan in normal conversation; no mandatory questionnaire or planning mode is imposed. User-configured extensions are not uninstalled.

Install the locally built archive with scripts disabled:

```sh
npm install --global --ignore-scripts ./openfun-<version>.tgz
```

Replace `<version>` with the package version. This prevents Context Mode's dependency install hooks from modifying other clients. The package manager creates `openfun` directly; no alias or installation script is needed. Source pnpm configuration also disables those hooks. Context Mode requires SQLite/FTS5; Node 22.22.3's built-in implementation was previously tested, while other Node builds may differ. Build/package instructions are in the [README](../README.md).

## Login, models and private settings

OpenFun owns `<OPENFUN_HOME>/agent/`, defaulting to `~/.openfun/agent/`, for authentication, model preferences and plugins. It does not inherit or migrate `~/.pi/agent/`, accept legacy `PI_CODING_AGENT_DIR`/`OPENFUN_AGENT_DIR` overrides, or load a world's `.pi/` configuration. After installing or upgrading from those older setups, sign in with `/login` inside OpenFun and choose a model with `/model`.

World-local extensions, skills, settings and prompts use `.openfun/`. Inherited `PI_*` variables are cleared before launching bundled pi. `OPENFUN_HOME` changes the complete global data/cache root; it does not change the current world directory. Creator and background generation currently share OpenFun authentication and the world's saved model preference.

The bundled pi branding interface uses a small manifest and links under `<OPENFUN_HOME>/runtime/` without modifying global pi. The MCP adapter uses a private cached dependency copy with an OpenFun-specific keychain service name; upstream source and licenses remain intact.

`openfun doctor` reports actual paths and default plugin status. To change bundled extensions, edit `<OPENFUN_HOME>/plugins.json` and restart:

```json
{
  "mcp": true,
  "context": true,
  "questions": true,
  "images": true,
  "assets3d": true
}
```

Missing fields default to `true`; the obsolete boolean `plan` field is ignored. Disabling a default does not uninstall user-configured plugins. Despite its name, **`assets3d` currently controls both Meshy and the reusable asset-library tools**, including Kenney and music search. Keep it enabled when using those tools for 2D. Separating these integrations is future work.

Explicitly configured MCP, Context Mode and supported questionnaire extensions are reused to avoid duplicate loading. Custom replacements can be loaded after disabling the corresponding default; their versions remain user-managed. The MCP adapter does not include each external service's executable or account.

### Context Mode

Context Mode supplies local execution, output filtering, indexing and retrieval. Savings depend on the task; no fixed reduction is promised. Its local MCP process starts on demand before the first agent run and is cleaned up with the session. Help-only commands do not start it, and gameplay generation workers do not load it.

Data stays in `<OPENFUN_HOME>/cache/context-mode/`, separate from local pi caches and world sharing. Context Mode is **Elastic-2.0**, not MIT; OpenFun's license does not relicense it. Future hosted use requires a separate dependency/license review. See [third-party notices](../THIRD_PARTY_NOTICES.md) and its [license](https://github.com/mksglu/context-mode/blob/main/LICENSE).

## Asset-service credentials

The current image tool uses OpenFun's Codex login and requires a Codex model selected with `/model`; it does not switch models or fall back to a separately billed API. Other image plugins can be configured, but arbitrary providers are not yet interchangeable through `world_generate_image`. See [assets](assets.md#image-generation) for parameters and existing model choices.

Use `/login meshy` or `/login tripo`, or choose the service under **Sign in with an API key**. Keys are stored in `<OPENFUN_HOME>/agent/auth.json`, outside shared worlds and tool arguments. `MESHY_API_KEY` and `TRIPO_API_KEY` are also supported; saved keys take precedence. `/logout` removes stored keys, not environment variables.

Meshy generation/processing is retained as experimental 3D functionality while the next milestone focuses on 2D. Tripo supports key storage only; its generation API is not integrated. These asset services do not appear in the chat-model list or replace the selected model. Saving a key does not validate it or submit a job. A first API call reports authentication/quota problems. When no chat model is configured, login may also report that the asset service has no default model; choose a separate chat provider/model.

## Engine paths and world directories

Configure Godot/Blender with `openfun setup`, `OPENFUN_GODOT`/`OPENFUN_BLENDER`, or `<OPENFUN_HOME>/tools.json`. Discovery checks explicit command parameters where supported, environment variables, saved tool configuration, common application locations and PATH. Use stable locations outside the npm installation, such as `~/.openfun/tools/`.

No-argument `openfun` opens only the current working directory and initializes it when needed. `/new` creates a conversation in that world; `/world` shows its information. To change projects, exit, change directory and run `openfun` again. Local sessions, model preferences and logs under the world's `.openfun/` are excluded from sharing.

`/play --generation-budget 24` sets the Host's AI request budget for that play session. The default is 12, with an allowed range of 0–100; failures and retries count. Zero budget allows reuse of completed content without new requests. `--demo` disables AI and uses project-provided test data, without creating a sample game. MCP settings and model credentials never enter world archives.

## Terminal interface and diagnostics

Startup shows the OpenFun version, current world and authoring/play entry points. `/about` exposes the bundled pi version and plugin configuration. `/model`, `/login` and session features remain native pi functionality.

Startup hides the lengthy resource list while preserving load errors. Disable Quiet startup in `/settings`, or use `openfun -- --verbose`, for details; explicit saved preferences are retained. CLI notices use English, while conversations, world names and game text retain the user's language. Some third-party interfaces retain upstream names.

Only Node's known SQLite experimental-status warning is suppressed. Set `OPENFUN_SHOW_RUNTIME_WARNINGS=1` to include it during diagnosis; other warnings/errors remain visible. For command examples, preview limits and polish operations, see [current implementation](implementation.md).

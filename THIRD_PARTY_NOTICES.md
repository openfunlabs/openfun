# Third-party components

Openfun's TypeScript core and Godot project code are MIT licensed. Third-party software retains its own license; the license of Openfun does not license user-created worlds or imported assets.

- **pi** (`@earendil-works/pi-coding-agent`): MIT. <https://github.com/earendil-works/pi>
- **Official pi questionnaire extension**: loaded directly from the pinned pi package's `examples/extensions/`; retains pi's MIT license.
- **pi-mcp-adapter** (`pi-mcp-adapter@2.32.1`): MIT. Installed as an OpenFun dependency, with its license and dependency notices retained in the package. <https://github.com/nicobailon/pi-mcp-adapter>
- **Godot Engine**: MIT with third-party notices. Keep the engine's copyright/license and third-party acknowledgements with a distributed player: <https://godotengine.org/license/>. Local downloaded engines and exported players are development artifacts and are excluded from the source package.
- **Blender**: distributed binaries use GPL-3.0-or-later. Blender is an independent optional asset-production process. Its executable is not included in the npm package. If redistributing it, include the applicable license, notices, and corresponding source as required: <https://www.blender.org/about/license/>.
- **Blender worker**: `workers/blender/build.py` is separately marked GPL-3.0-or-later because it uses Blender's Python API. See `workers/blender/LICENSE`.
- Other npm dependencies retain their licenses in their respective packages and the lockfile records the resolved dependency tree.

World packages currently carry `UNLICENSED` as content-license metadata. Share only content for which you have redistribution rights; the package format does not confer rights to third-party models. A configurable content-license/release flow is future work.

- **Context Mode** (`context-mode@1.0.169`): Elastic License 2.0, not MIT. Its original license is retained in the dependency package. This dependency has its own terms, including restrictions on hosted/managed services; OpenFun's MIT license does not relicense it. <https://github.com/mksglu/context-mode/blob/main/LICENSE>

## Game-design reference material

`docs/game-design/` contains original OpenFun implementation and review guidance with links to GDQuest, GDC talks, Godot documentation, Game Programming Patterns, Jesse Schell's book information, and Impeccable. No book chapters, talk transcripts, third-party demo code, Impeccable skill files, or external art are bundled by these guides. Referenced projects retain their own licenses; consult the relevant notices before importing code or assets into a generated game.

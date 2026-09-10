# Frame pacing and streaming performance

Use for new playable games, stutters, growing worlds and content activation. Choose a target device, resolution and frame budget (for example 16.7 ms at 60 FPS). Report those conditions with results; avoid declaring “optimized” from an average FPS or a source scan.

## Measure the actual problem

Distinguish sustained slow frames, intermittent stalls and loading time. Reproduce idle, movement, the busiest encounter, a new content activation and a revisit. Measure startup separately from steady gameplay; collect frame-interval p50/p95/p99, worst frame and hitch count as well as CPU/physics, memory and rendering counters. Godot recommends profiling, locating the bottleneck, changing it and measuring again. GPU bottlenecks can remain invisible in CPU-only profiles. [Godot optimization guidance](https://docs.godotengine.org/en/stable/tutorials/performance/general_optimization.html).

world_preview_game reports observed frame intervals after a one-second warmup. Use inputs to exercise the scene. By default these are headless simulation observations, with no rendered FPS or GPU evidence. Select mode=windowed as needed without additional confirmation; these observations are affected by VSync, OS scheduling and screenshots; they are NOT a release-build benchmark or a GPU profiler. Use captureTimes=[] to disable screenshots entirely; intervals immediately following captures are excluded and counted, but adjacent GPU/OS effects may remain. Set warmupSeconds explicitly. Run a capture-free pass when investigating pacing. Use Godot's profiler and representative exported builds for causal diagnosis. No samples means insufficient measurement, not zero latency.

## Common hypotheses to test

- Spikes at first appearance: inspect texture/mesh upload, shader preparation, synchronous loads and mass instantiation. Request resources ahead of time and check completion before retrieving them. `load_threaded_get` can still block if called too soon. [Godot background loading](https://docs.godotengine.org/en/stable/tutorials/io/background_loading.html).
- Spikes when AI jobs finish: parsing/validation and scene construction may still happen together on the main thread. Bound result sizes, cache validated results, and spread node activation across a small per-frame budget. Scene-tree changes must obey Godot's threading rules. Keep live generation, Blender work and network waits outside the render loop.
- Cost grows with enemies: inspect all-pairs scans and every-frame pathfinding. Bound active agents, use spatial queries and stagger expensive decisions. Preserve physics correctness and frame-rate-independent movement.
- Repeated allocation: reuse expensive frequently recreated objects only where measurements justify it. Pool reset must clear timers, signals, hits and ownership. Pooling also consumes memory; it is not a universal optimization. [Game Programming Patterns: Object Pool](https://gameprogrammingpatterns.com/object-pool.html).
- GPU overload: test shadows, transparent overdraw, particles, texture sizes and excessive distinct materials. Reduce the measured cost while preserving readable art. Don't strip all animation to mask a loading bug.
- Long sessions: bound active chunks, particles, content caches and queued requests; unload distant visuals while preserving persistent world data. Debounce saves and avoid whole-world serialization every frame.

## Completion

Keep a reproducible route, hardware/resolution, measurements before and after, and remaining uncertainty. Test that optimization preserves hits, animation timing, progression and saves. Monitor counters may update slowly or depend on build configuration; do not sum CPU and GPU times into invented total frame time. [Godot Performance monitors](https://docs.godotengine.org/en/stable/classes/class_performance.html).

## Required delivery evidence

For a new game, keep `design/performance.md` with hardware, renderer, resolution, target FPS,
exact route/inputs, duration, warmup and before/after results. Default to a stated 60 FPS desktop
assumption if the user has not specified a target. Do not silently lower the target to make a result pass.

Use `world_preview_game` with `mode=windowed`, `seconds=60`, `warmupSeconds=5`, `captureTimes=[]`,
and `targetFps=60`, plus actual gameplay inputs. Up to 120 seconds are supported per observation.
Exercise movement, a representative busy encounter and a transition; an idle menu cannot pass.
Inspect frameBudget overrun counts along with p95/p99 and events. Strict budget crossings include
normal scheduling jitter; do not treat a single overrun as failure. Repeated visible hitches or sustained
misses require investigation, a fix and a rerun of the same route. Engine counters are sampled clues,
not independent CPU/GPU timings and must not be added together.

Preview has zero generation budget: test real content activation with a creator-closed Host separately,
including pending generation, scene construction, save and revisit. Keep heavy asset creation and imports
away from the game's GPU/CPU when possible. Comparing authoring-time contention with a standalone
play session helps distinguish machine contention from a game bottleneck.

Generated art must be prepared for runtime: retain source masters, size textures for their on-screen use,
use appropriate import compression/mipmaps, optimize mesh detail/LODs and collision, reuse materials,
and measure shadowed lights, transparent layers and particles. Do not load unused source variants into
the playable scene. Keep original quality available; optimize the bottleneck instead of deleting art.

Separate cold-start loading/shader preparation from warm steady play. A cold hitch still affects players:
use a loading/preparation phase and verify the next encounter does not repeat it. A 60-second result does
not establish long-session memory stability or exported-build GPU performance. Unmeasured paths remain
explicitly unverified; screenshots and file inventories are not performance acceptance evidence.

## Resource readiness before scene activation

Do not put a loop of first-use `load()` calls for character frames or meshes inside a room transition
or enemy setup. A resource cache lookup is fast only when the needed resources are already resident;
keep strong references to assets for the current and imminent content instead of assuming a prior
load makes every later activation free. Prepare a finite initial asset set during a visible loading phase.
For continuing worlds, request the next area's resources asynchronously during current play, check
`THREAD_LOAD_LOADED` before retrieving them, retain them through activation, and evict distant assets
within a measured memory budget. Do not preload an unbounded world.

Measure the scene-building function separately from full frame pacing before and after this change.
Reduced activation time does not prove all stalls are fixed: shader/upload work, font preparation,
scheduling and other systems may still hitch. Keep cold-start preparation cost visible in the report.

# Runtime protocol (v1)

Each world contains a Godot project at `game/project.godot`. The entry must be a regular local file without symlinks.
The Godot project receives `--host=<loopback URL> --token=<capability token>` after Godot's
`--` separator. Every request requires `Authorization: Bearer <token>`; POSTs
also require `Content-Type: application/json`. Project code owns gameplay,
rendering, simulation, content validation and interpretation. These APIs do not
prescribe a genre, coordinate system, entity vocabulary or combat system.

The original `/snapshot`, `/command`, `/assets` APIs remain compatible. The
fixed 3D chunk queue is initialized only when `/snapshot` is requested; using
the APIs below does not start that queue. `GET /health` is side-effect free.

## Generate structured content

`POST /content/jobs` submits this JSON object:

```json
{
  "namespace": "roguelite2d",
  "key": "level:1",
  "prompt": "Design the first playable arena following the world documents.",
  "schema": {
    "type": "object",
    "properties": { "name": { "type": "string", "minLength": 1 } },
    "required": ["name"],
    "additionalProperties": false
  },
  "context": { "level": 1 }
}
```

Namespace matches `[a-z][a-z0-9_-]{0,63}`; key is a nonempty string up to 160
characters. `prompt` is at most 12,000 characters. `context` is optional JSON.
The full request is limited to 128 KiB, schema to 32 KiB, context to 64 KiB.
Supported schema keywords: `type` (object/array/string/number/integer/boolean/null),
`properties`, `required`, `additionalProperties` (boolean or schema), `items`,
`minItems`, `maxItems`, `minLength`, `maxLength`, `minimum`, `maximum`, `enum`,
`const`, `anyOf`, `oneOf`, `allOf`, `description`, `title`, and `default`.
References, remote schemas, patterns and executable values are not accepted.
The top-level schema must describe an object. Schema depth is limited to 16.
The Host checks this structural schema; the game must separately check spatial
connectivity, difficulty, objectives and other gameplay invariants.

For each fresh generation attempt, the Host supplements the request with same-namespace
`continuity`: up to eight recent ready results (each a structured excerpt up to 6 KiB)
and the latest saved state (up to 16 KiB), with `truncated` flags. This is model input,
not a new required request field. Other namespaces, pending/failed jobs and credentials
are excluded. Ready content may be prefetched or rejected; only explicit game state
establishes what the player experienced. Keep long-term consequences and progression
in compact request context/save fields; history excerpts are incomplete and cannot
replace a game-specific progression contract. Existing identical keys still replay
without generation; failed-job retries use current continuity. The game must validate
semantic novelty and supported state transitions before activation. No generic
similarity filter or extra model call is added by the Host.

Submission returns HTTP 202 (or 200 for an existing identical request):

```json
{
  "job": {
    "id": "uuid",
    "namespace": "roguelite2d",
    "key": "level:1",
    "status": "pending",
    "attempt": 0,
    "createdAt": 1788768000000,
    "updatedAt": 1788768000000
  },
  "generation": { "active": 0, "queued": 1, "budgetRemaining": 12 }
}
```

Poll `GET /content/jobs?id=<uuid>` or
`GET /content/jobs?namespace=roguelite2d&key=level%3A1` for the same envelope.
`GET /content/jobs?namespace=roguelite2d` lists at most the 100 most recent jobs
as `{jobs: [...], generation: ...}`; omit namespace to list all recent jobs.
Job status is `pending | running | ready | failed`. A ready job adds `result`
(the generated JSON object); a failed job adds `error` (displayable text).
Generation may include `blockedReason` explaining authentication, disabled AI,
or exhausted budget. Do not interpret a missing result as generated content.

The same namespace/key and identical request return the same job, without a
second model call. Reusing a key with changed prompt/schema/context returns 409.
Use a new key for a new content version. Published results never regenerate.
`POST /content/jobs/<uuid>/retry` with `{}` retries a failed job, retaining its
identity and increasing its attempt; `POST /content/jobs/<uuid>/cancel` cancels
pending/running work. Failed jobs are never retried silently. Project-side
validation failure should be shown and submitted under a new versioned key
with corrective context; it must not be replaced by random content.

Jobs persist across Host restarts. Interrupted running jobs become pending.
Default limits per Host run: 12 model attempts shared with the original 3D
generator (including failed attempts),
one concurrent call, three pending requests and 120 seconds per attempt.
An explicit retry consumes an attempt. Existing results remain usable with
zero budget or no login. In explicit demo mode AI is disabled; the project may
use clearly labeled, authored demo fixtures. The Host never invents a fallback.

The worker uses the world's saved pi provider/model/thinking preferences and
OpenFun's isolated authentication. It does not load author sessions, skills,
extensions, arbitrary context files, or execute project-provided tools. Context
includes bounded `WORLD.md`, Markdown documents below `design/`, and
`game/DESIGN.md` (or DESIGN.md at the configured project directory), plus the
request prompt/context. Document text is creative data, not tool instructions.
The original 3D region generator also reads these bounded world/design documents, alongside its fixed world spec and neighboring regions.
Missing optional documents are reported in the request metadata. Read files
must be regular non-symlink files; total document text is limited to 128 KiB.

## Save arbitrary gameplay state

`GET /game/state?namespace=roguelite2d` returns:

```json
{ "namespace": "roguelite2d", "revision": 0, "state": null, "updatedAt": null }
```

`POST /game/state`:

```json
{
  "namespace": "roguelite2d",
  "expectedRevision": 0,
  "state": {
    "level": 1,
    "contentJobId": "uuid",
    "player": { "hp": 100, "position": [120, 320] },
    "enemies": [],
    "selectedSkills": []
  }
}
```

Returns the saved envelope with revision incremented by one. `state` may be any
JSON value up to 256 KiB (depth at most 32, finite numbers). Namespace is
required; no game-specific state shape is assumed. A stale expectedRevision
returns HTTP 409 with `{error, code: "revision_conflict", current: <envelope>}`.
The project must serialize saves and resolve conflicts before retrying. It
must save its own HP, enemies, chosen skills, progression and content references.
Restarts and skill selection are ordinary project-defined state transitions.
The Host provides atomic persistence and optimistic locking, not multiplayer
authority or validation of simulated combat.

## Errors and sharing

Errors are `{error: "displayable text"}`; malformed input is 400, unknown job
404, conflicting keys/state 409, and exhausted admission budget or queue 429.
Never put provider credentials in content requests, game state or project files.
Ready generated content and generic saves are exportable as data; job execution
and API credentials are not granted by a shared package. Project source
is executable code and must follow the application's trusted-project policy.

## Authoring and acceptance

After the first playable slice, persist game-specific fixed rules, allowed variation, schemas, pacing, continuity, asset vocabulary and activation/save behavior in design/runtime.md. Read the bundled runtime design guide before implementing the loop. The game must actually call and interpret the APIs above; documentation alone does not enable continuation.

Proactively run and inspect each meaningful implemented effect. Visual previews do not create content jobs; separately test bounded prefetch, next-content activation, failures and zero-budget save/revisit with a live Host. Distinguish injected fixtures from real provider generation in reports.

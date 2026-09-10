/** No model calls. Tests the real Godot client against a deterministic HTTP fixture.
 * node tests/e2e/streaming.mjs [--player /path/to/player] [--visual]
 * The fixture starts at a saved position far from the origin and exposes an
 * explicitly pending region before publishing it. It never impersonates AI output.
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { resolveTool } from "../../src/paths.ts";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { root } from "../helpers/paths.mjs";
const executable = resolveTool("godot");
assert.ok(executable, "Godot required");
const project = await mkdtemp(
  path.join(tmpdir(), "openfun-streaming-fixture-"),
);
await cp(path.join(root, "tests/fixtures/games/exploration-3d"), project, {
  recursive: true,
  filter: (p) => !p.split(path.sep).includes(".godot"),
});
const visual = process.argv.includes("--visual");
const token = randomBytes(24).toString("hex");
let requests = 0,
  retried = false,
  commands = 0,
  removed = false,
  position = [128, 1.7, -96];
// A tiny COLOR_0-only pyramid is a regression fixture for runtime glTF material
// handling. Normals are present; no explicit material is needed by the glTF spec.
function vertexColorGlb() {
  const points = [
    [-0.7, 0, -0.7],
    [0.7, 0, -0.7],
    [0, 1.7, 0],
    [0, 0, 0.7],
  ];
  const faces = [
    [0, 2, 1],
    [1, 2, 3],
    [3, 2, 0],
    [0, 1, 3],
  ];
  const positions = [],
    normals = [],
    colors = [];
  for (const face of faces) {
    const [a, b, c] = face.map((i) => points[i]);
    const u = b.map((v, i) => v - a[i]),
      v = c.map((q, i) => q - a[i]);
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...n);
    for (const index of face) {
      positions.push(...points[index]);
      normals.push(...n.map((x) => x / length));
      colors.push(0.75, 0.18, 0.055, 1);
    }
  }
  const buffers = [positions, normals, colors].map((values) =>
    Buffer.from(new Float32Array(values).buffer),
  );
  const binary = Buffer.concat(buffers);
  let offset = 0;
  const views = buffers.map((buffer) => {
    const result = { buffer: 0, byteOffset: offset, byteLength: buffer.length };
    offset += buffer.length;
    return result;
  });
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 } }],
        },
      ],
      buffers: [{ byteLength: binary.length }],
      bufferViews: views,
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 12,
          type: "VEC3",
          min: [-0.7, 0, -0.7],
          max: [0.7, 1.7, 0.7],
        },
        { bufferView: 1, componentType: 5126, count: 12, type: "VEC3" },
        { bufferView: 2, componentType: 5126, count: 12, type: "VEC4" },
      ],
    }),
  );
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]);
  const header = Buffer.alloc(12),
    jsonHeader = Buffer.alloc(8),
    binHeader = Buffer.alloc(8);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + binary.length, 8);
  jsonHeader.writeUInt32LE(padded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, padded, binHeader, binary]);
}
const asset = vertexColorGlb();
const assetName = createHash("sha256").update(asset).digest("hex") + ".glb";
const generation = (ready) => ({
  mode: "ai",
  active: ready ? 0 : 1,
  queued: 1,
  budgetRemaining: 3,
  regions: [
    {
      id: "4,-3",
      x: 4,
      z: -3,
      status: ready
        ? "ready"
        : requests >= 2 && !retried
          ? "failed"
          : "running",
      error:
        requests >= 2 && !retried
          ? "Fixture provider failure: press R to retry."
          : undefined,
    },
    { id: "5,-3", x: 5, z: -3, status: "pending" },
  ],
});
const fixture = (ready) => ({
  world: {
    id: "runtime-fixture",
    name: "Runtime streaming fixture",
    description: "Automated test data",
    seed: "fixture",
    revision: 1,
    palette: { ground: "#5d8466", sky: "#92b5ca", accent: "#f2ba68" },
  },
  player: { position },
  revision: commands,
  chunks: ready
    ? [
        {
          id: "4,-3",
          x: 4,
          z: -3,
          size: 32,
          entities: [
            {
              id: "fixture-crystal",
              kind: "crystal",
              name: "Test crystal",
              position: [130, 0, -99],
              rotation: 0,
              scale: [1, 1, 1],
              color: "#eeb76b",
              state: { removed },
            },
            {
              id: "fixture-house",
              kind: "house",
              name: "Test house",
              position: [122, 0, -103],
              rotation: 0,
              scale: [1, 1, 1],
              color: "#cfbf95",
              state: {},
            },
            {
              id: "fixture-tree",
              kind: "tree",
              name: "Test tree",
              position: [134, 0, -105],
              rotation: 0,
              scale: [1, 1, 1],
              color: "#497a61",
              state: {},
            },
            {
              id: "fixture-rock",
              asset: assetName,
              kind: "rock",
              name: "Test rock",
              position: [132, 0, -103],
              rotation: 0,
              scale: [1, 1, 1],
              color: "#81918d",
              state: {},
            },
            {
              id: "fixture-npc",
              kind: "npc",
              name: "Test NPC",
              position: [126, 0, -101],
              rotation: 0,
              scale: [1, 1, 1],
              color: "#a37450",
              state: {},
            },
          ],
        },
      ]
    : [],
  generation: generation(ready),
});
const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401);
    res.end("{}");
    return;
  }
  if (req.url === `/assets/${assetName}`) {
    res.setHeader("content-type", "model/gltf-binary");
    res.end(asset);
    return;
  }
  if (req.url.startsWith("/snapshot")) {
    requests += 1;
    const ready = requests >= 4 && retried;
    res.end(JSON.stringify(fixture(ready)));
    return;
  }
  if (req.method === "POST" && req.url === "/generation/retry") {
    let text = "";
    for await (const data of req) text += data;
    const retry = JSON.parse(text);
    assert.equal(retry.x, 4);
    assert.equal(retry.z, -3);
    retried = true;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/command") {
    let text = "";
    for await (const data of req) text += data;
    const command = JSON.parse(text);
    commands += 1;
    if (command.type === "move") position = command.position;
    else if (command.entityId === "fixture-crystal") removed = true;
    res.end(
      JSON.stringify({
        ok: true,
        revision: commands,
        message: "Fixture state recorded",
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end("{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const args = ["--path", project];
  if (!visual) args.push("--headless");
  args.push(
    "--",
    `--host=http://127.0.0.1:${server.address().port}`,
    `--token=${token}`,
    "--smoke-test",
    "--smoke-retry",
  );
  if (visual) {
    await mkdir(path.join(root, ".output"), { recursive: true });
    args.push(
      `--screenshot=${path.join(root, ".output/runtime-streaming.png")}`,
    );
  }
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "",
    errors = "";
  child.stdout.on("data", (buffer) => {
    output += buffer;
  });
  child.stderr.on("data", (buffer) => {
    errors += buffer;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 35_000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  clearTimeout(timer);
  if (errors) process.stderr.write(errors);
  assert.equal(code, 0, output);
  assert.doesNotMatch(
    errors,
    /SCRIPT ERROR|Parse Error|Shader compilation failed/,
  );
  const line = output
    .split("\n")
    .find((entry) => entry.startsWith("OPENFUN_SMOKE_JSON "));
  assert.ok(line, output);
  const report = JSON.parse(line.slice("OPENFUN_SMOKE_JSON ".length));
  for (const key of [
    "ok",
    "pending_observed",
    "pending_safe",
    "failure_observed",
    "retry_requested",
    "initial_position_restored",
    "frontier_checked",
    "frontier_safe",
    "floor_collision",
    "move",
    "interaction",
    "persisted_state",
  ])
    assert.equal(report[key], true, key);
  assert.equal(report.assets, 1);
  assert.equal(report.vertex_color_repairs, 1);
  assert.equal(removed, true);
  assert.equal(retried, true);
  assert.ok(requests >= 4);
  console.log(
    JSON.stringify({
      ...report,
      snapshot_requests: requests,
      fixture: true,
    }),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

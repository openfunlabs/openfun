import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveTool } from "../../src/paths.ts";
const godot = resolveTool("godot");
assert.ok(godot, "Godot required");
const root = await mkdtemp(join(tmpdir(), "openfun-materials-"));
try {
  await writeFile(
    join(root, "project.godot"),
    'config_version=5\n[application]\nconfig/name="OpenFun material test"\n',
  );
  await writeFile(
    join(root, "test.gd"),
    `extends SceneTree
const HELPER = preload(${JSON.stringify(resolve("tools/godot/mesh_materials.gd"))})
var failures: Array[String] = []
func check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)
func mesh(offset: float, alternate: bool = false) -> MeshInstance3D:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3.ZERO,Vector3.RIGHT,Vector3(1,1,0),Vector3.UP])
	arrays[Mesh.ARRAY_TEX_UV] = PackedVector2Array([Vector2(offset,offset),Vector2(1+offset,offset),Vector2(1+offset,1+offset),Vector2(offset,1+offset)])
	arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0,1,3,1,2,3] if alternate else [0,1,2,0,2,3])
	var resource := ArrayMesh.new()
	resource.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
	var material := StandardMaterial3D.new()
	material.roughness = 0.23
	material.emission_enabled = true
	resource.surface_set_material(0,material)
	var node := MeshInstance3D.new()
	node.mesh = resource
	return node
func _initialize() -> void:
	var source := mesh(0)
	var material: StandardMaterial3D = source.get_active_material(0)
	material.roughness = 0.91
	material.emission_enabled = false
	var normal := ImageTexture.create_from_image(Image.create_empty(4,4,false,Image.FORMAT_RGBA8))
	material.normal_enabled = true
	material.normal_texture = normal
	var target := mesh(0.00001)
	var old: StandardMaterial3D = target.get_active_material(0)
	check(HELPER.restore_matching_materials(target,source).restored == 1,"tolerates measured import precision")
	var restored: StandardMaterial3D = target.get_active_material(0)
	check(restored != material and restored != old,"per-instance duplicate")
	check(is_equal_approx(restored.roughness,0.91) and not restored.emission_enabled,"source PBR values")
	check(restored.normal_enabled and restored.normal_texture == normal,"source texture preserved")
	check(is_equal_approx(old.roughness,0.23) and old.emission_enabled,"imported shared material unchanged")
	var changed := mesh(0.01)
	check(HELPER.restore_matching_materials(changed,source).restored == 0,"reject changed UV chart")
	var triangulated := mesh(0,true)
	check(HELPER.restore_matching_materials(triangulated,source).restored == 0,"reject changed triangle topology")
	var ambiguous := Node.new()
	ambiguous.add_child(mesh(0))
	ambiguous.add_child(mesh(0))
	check(HELPER.restore_matching_materials(target,ambiguous).restored == 0,"reject ambiguous material source")
	for node in [source,target,changed,triangulated,ambiguous]: node.free()
	print("OPENFUN_MATERIAL_TEST " + JSON.stringify({"ok":failures.is_empty(),"failures":failures}))
	quit(0 if failures.is_empty() else 1)
`,
  );
  const child = spawn(godot, [
    "--headless",
    "--path",
    root,
    "--script",
    join(root, "test.gd"),
  ]);
  let log = "";
  child.stdout.on("data", (b) => {
    log += b;
  });
  child.stderr.on("data", (b) => {
    log += b;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(code, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Parse Error|^ERROR:/m);
  assert.match(log, /OPENFUN_MATERIAL_TEST.*"ok":true/);
  console.log(log);
} finally {
  await rm(root, { recursive: true, force: true });
}

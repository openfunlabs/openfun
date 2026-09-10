# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a bounded declarative Openfun recipe; never evaluates generated code.

blender --background --factory-startup --python build.py -- --recipe recipe.json --output output.glb
Recipe coordinates are metres, Y up; exported glTF coordinates stay Y up.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix

MAX_PARTS = 128
MAX_RECIPE_BYTES = 256 * 1024
BASIS = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def vector(value, label, lower, upper):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{label} must have three numbers")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or
           not math.isfinite(v) or not lower <= v <= upper for v in value):
        raise ValueError(f"{label} values must be finite and within {lower}..{upper}")
    return value


def color(value):
    if not isinstance(value, str) or len(value) != 7 or not value.startswith("#"):
        raise ValueError("color must be #RRGGBB")
    # glTF material values are linear; recipes use ordinary sRGB hex colors.
    rgb = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb) + (1,)


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) != 4 or args[0] != "--recipe" or args[2] != "--output":
        raise ValueError("Expected --recipe recipe.json --output output.glb")
    source, output = args[1], args[3]
    if os.path.getsize(source) > MAX_RECIPE_BYTES:
        raise ValueError("Recipe exceeds 256 KiB")
    with open(source, encoding="utf-8") as f:
        recipe = json.load(f)
    parts = recipe.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise ValueError(f"Recipe must contain 1..{MAX_PARTS} parts")
    if not output.endswith(".glb"):
        raise ValueError("Output must use .glb")
    # Validate the entire recipe before producing objects.
    validated = []
    for part in parts:
        if not isinstance(part, dict) or part.get("shape") not in ("box", "sphere", "cylinder", "cone"):
            raise ValueError("Unsupported primitive shape")
        validated.append((part["shape"], vector(part.get("position"), "position", -64, 64),
                          vector(part.get("scale"), "scale", 0.02, 64),
                          vector(part.get("rotation", [0, 0, 0]), "rotation", -math.tau, math.tau),
                          color(part.get("color"))))
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for index, (shape, pos, scale, rotation, rgba) in enumerate(validated):
        if shape == "box":
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif shape == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.5)
        elif shape == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.5, depth=1)
        else:
            bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.5, radius2=0, depth=1)
        obj = bpy.context.object
        obj.name = f"part_{index:03d}_{shape}"
        obj.location = (pos[0], -pos[2], pos[1])
        obj.scale = (scale[0], scale[2], scale[1])
        obj.rotation_euler = (BASIS @ Euler(rotation, "XYZ").to_matrix() @ BASIS.transposed()).to_euler()
        # Spheres are axis-neutral; cylinders/cones must have their native Z axis
        # aligned to recipe Y, which the coordinate basis already expresses.
        if shape in ("cylinder", "cone"):
            obj.scale = (scale[0], scale[2], scale[1])
            obj.rotation_euler = (BASIS @ Euler(rotation, "XYZ").to_matrix() @ BASIS.transposed()).to_euler()
        material = bpy.data.materials.new(f"material_{index:03d}")
        material.diffuse_color = rgba
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.82
        obj.data.materials.append(material)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(output), export_format="GLB", export_yup=True,
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False)
    print(json.dumps({"ok": True, "parts": len(parts), "bytes": os.path.getsize(output),
                      "blender": bpy.app.version_string}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)

extends RefCounted
## glTF COLOR_0 multiplies base color, including surfaces with explicit PBR materials.
## Godot 4.7.2 can create a primitive's material before reading its COLOR_0 attribute.
## Restore that flag per instance while preserving every imported material setting.

static func enable_vertex_colors(root: Node) -> int:
	var repaired := 0
	if root is MeshInstance3D and root.mesh != null:
		for surface in range(root.mesh.get_surface_count()):
			var arrays: Array = root.mesh.surface_get_arrays(surface)
			if arrays.size() <= Mesh.ARRAY_COLOR or arrays[Mesh.ARRAY_COLOR] == null or arrays[Mesh.ARRAY_COLOR].is_empty():
				continue
			var existing: Material = root.get_active_material(surface)
			if existing is BaseMaterial3D and existing.vertex_color_use_as_albedo:
				continue
			if existing != null and not existing is BaseMaterial3D:
				# A custom shader controls its own vertex-color interpretation.
				continue
			var material: BaseMaterial3D = existing.duplicate() if existing != null else StandardMaterial3D.new()
			material.vertex_color_use_as_albedo = true
			root.set_surface_override_material(surface, material)
			repaired += 1
	for child in root.get_children():
		repaired += enable_vertex_colors(child)
	return repaired

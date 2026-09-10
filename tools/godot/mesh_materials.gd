extends RefCounted
## Instance-only restoration from the verified pre-rig source, never an arbitrary asset.
## Godot mesh compression can perturb imported UVs. Match within 0.00005 UV units,
## then require identical triangle multiplicities; ambiguous or changed charts are skipped.
const UV_TOLERANCE := 0.00005

static func topology(mesh: ArrayMesh, surface: int) -> Dictionary:
	if mesh.surface_get_primitive_type(surface) != Mesh.PRIMITIVE_TRIANGLES: return {}
	var arrays := mesh.surface_get_arrays(surface)
	if arrays[Mesh.ARRAY_TEX_UV] == null: return {}
	var uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	if uv.is_empty(): return {}
	var indices := PackedInt32Array()
	if arrays[Mesh.ARRAY_INDEX] != null: indices = arrays[Mesh.ARRAY_INDEX]
	if indices.is_empty():
		for index in uv.size(): indices.append(index)
	if indices.size()%3 != 0: return {}
	for point in uv:
		if not point.is_finite(): return {}
	for index in indices:
		if index < 0 or index >= uv.size(): return {}
	return {"uv":uv,"indices":indices}

static func surfaces(node: Node) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	if node is MeshInstance3D and node.mesh is ArrayMesh:
		for surface in node.mesh.get_surface_count():
			var data := topology(node.mesh,surface)
			if not data.is_empty(): result.append({"node":node,"surface":surface,"data":data})
	for child in node.get_children(): result.append_array(surfaces(child))
	return result

static func triangles(indices: PackedInt32Array, mapped: Array[int]) -> Dictionary:
	var counts := {}
	for index in range(0,indices.size(),3):
		var corners: Array[int] = [mapped[indices[index]],mapped[indices[index+1]],mapped[indices[index+2]]]
		corners.sort()
		var key := "%d,%d,%d" % corners
		counts[key] = counts.get(key,0)+1
	return counts

static func matches(source: Dictionary, target: Dictionary) -> bool:
	if source.indices.size() != target.indices.size(): return false
	var unique := {}
	var points: Array[Vector2] = []
	var grid := {}
	var source_ids: Array[int] = []
	for point: Vector2 in source.uv:
		if not unique.has(point):
			var id := points.size()
			unique[point] = id
			points.append(point)
			var cell := Vector2i(floori(point.x/UV_TOLERANCE),floori(point.y/UV_TOLERANCE))
			if not grid.has(cell): grid[cell] = []
			grid[cell].append(id)
		source_ids.append(unique[point])
	if points.size() < 3: return false
	var target_ids: Array[int] = []
	for point: Vector2 in target.uv:
		var cell := Vector2i(floori(point.x/UV_TOLERANCE),floori(point.y/UV_TOLERANCE))
		var best := -1
		var distance := UV_TOLERANCE*UV_TOLERANCE
		var ambiguous := false
		for x in range(-1,2):
			for y in range(-1,2):
				for id: int in grid.get(cell+Vector2i(x,y),[]):
					var d := point.distance_squared_to(points[id])
					if absf(d-distance) < 1e-16 and best != -1: ambiguous = true
					elif d < distance:
						distance = d
						best = id
						ambiguous = false
		if best == -1 or ambiguous: return false
		target_ids.append(best)
	return triangles(source.indices,source_ids) == triangles(target.indices,target_ids)

static func restore_matching_materials(target: Node, source: Node) -> Dictionary:
	var sources := surfaces(source)
	var restored := 0
	var skipped := 0
	for entry in surfaces(target):
		var candidates := sources.filter(func(s): return matches(s.data,entry.data))
		if candidates.size() != 1:
			skipped += 1
			continue
		var original: Material = candidates[0].node.get_active_material(candidates[0].surface)
		if not original is BaseMaterial3D:
			skipped += 1
			continue
		entry.node.set_surface_override_material(entry.surface,original.duplicate())
		restored += 1
	return {"restored":restored,"skipped":skipped,"note":"Matched UV triangles within import precision. Verify the supplied source, intended emission and rendered material. No source resource was overwritten."}

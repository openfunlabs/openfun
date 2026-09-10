extends SceneTree
## Actual imported-clip inspection; run with --path <game> --script <this> -- <config.json>.
## Config: {clips:[{label,resource}], output:absolute_directory}. Captures real poses.
var failures: Array[String] = []
var stage: Node3D
var camera: Camera3D
var output_dir: String
var reports: Array = []
var title: Label
var material_source: Node
var material_helper: Script

func _initialize() -> void:
	call_deferred("run")

func descendants(node: Node, type_name: String) -> Array[Node]:
	var found: Array[Node] = []
	if node.is_class(type_name): found.append(node)
	for child in node.get_children(): found.append_array(descendants(child,type_name))
	return found

func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("Animation probe requires a JSON config path")
		quit(1)
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	if not parsed is Dictionary or not parsed.get("clips") is Array or not parsed.get("output") is String:
		push_error("Animation probe config requires clips and output")
		quit(1)
		return
	var config: Dictionary = parsed
	output_dir = config.output
	DirAccess.make_dir_recursive_absolute(output_dir)
	root.size = Vector2i(1100,820)
	stage = Node3D.new()
	root.add_child(stage)
	var world := WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color("172128")
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color("dce8ed")
	world.environment.ambient_light_energy = 0.7
	stage.add_child(world)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45,-35,0)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	stage.add_child(sun)
	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(12,12)
	floor_mesh.mesh = plane
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("34464b")
	material.roughness = 0.9
	floor_mesh.material_override = material
	stage.add_child(floor_mesh)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 3.3
	camera.position = Vector3(2.8,1.9,4.0)
	stage.add_child(camera)
	camera.look_at(Vector3(0,0.8,0))
	camera.current = true
	var canvas := CanvasLayer.new()
	root.add_child(canvas)
	title = Label.new()
	title.position = Vector2(28,24)
	title.add_theme_font_size_override("font_size",26)
	canvas.add_child(title)
	if config.has("material_source"):
		var source_scene = load(config.material_source)
		if not source_scene is PackedScene:
			push_error("Cannot load verified material source")
			quit(1)
			return
		material_source = source_scene.instantiate()
		material_helper = load(get_script().resource_path.get_base_dir().path_join("mesh_materials.gd"))
	for clip in config.clips:
		await inspect_clip(clip)
	var report := {"clips":reports,"failures":failures,"structural_pass":failures.is_empty(),"note":"Inspect all rendered poses and normal-speed playback. Structural checks do not certify animation quality."}
	var file := FileAccess.open(output_dir.path_join("report.json"),FileAccess.WRITE)
	file.store_string(JSON.stringify(report,"  "))
	file.close()
	print("OPENFUN_ANIMATION_PROBE " + JSON.stringify(report))
	if material_source != null: material_source.free()
	quit(0 if failures.is_empty() else 1)

func inspect_clip(clip: Dictionary) -> void:
	title.text = "OpenFun / Meshy — " + str(clip.label)
	var packed = load(clip.resource)
	if not packed is PackedScene:
		failures.append("Cannot load " + str(clip.resource))
		return
	var actor: Node = packed.instantiate()
	stage.add_child(actor)
	await process_frame
	var skeletons := descendants(actor,"Skeleton3D")
	var players := descendants(actor,"AnimationPlayer")
	var meshes := descendants(actor,"MeshInstance3D")
	if skeletons.is_empty() or players.is_empty() or meshes.is_empty():
		failures.append(str(clip.label) + " needs meshes, skeleton and AnimationPlayer")
		actor.queue_free()
		await process_frame
		return
	var player: AnimationPlayer = players[0]
	var names := player.get_animation_list()
	var selected := ""
	for name in names:
		if name != "RESET": selected = name; break
	if selected.is_empty():
		failures.append(str(clip.label) + " has no action")
		actor.queue_free()
		await process_frame
		return
	var animation := player.get_animation(selected)
	var skeleton: Skeleton3D = skeletons[0]
	var bones: Array[String] = []
	for index in skeleton.get_bone_count(): bones.append(skeleton.get_bone_name(index))
	var material_report := {}
	if material_source != null:
		material_report = material_helper.restore_matching_materials(actor,material_source)
		if material_report.restored == 0: failures.append(str(clip.label) + " material source topology did not match")
	var data := {"materials":material_report,"label":clip.label,"resource":clip.resource,"action":selected,"duration":animation.length,"tracks":animation.get_track_count(),"imported_loop":animation.loop_mode,"bones":bones,"frames":[],"pose_samples":[]}
	animation.loop_mode = Animation.LOOP_NONE
	player.play(selected)
	for fraction in [0.0,0.2,0.4,0.6,0.8,0.99]:
		player.seek(animation.length*fraction,true)
		player.pause()
		await process_frame
		await RenderingServer.frame_post_draw
		var path := output_dir.path_join(str(clip.label)+"-"+str(int(fraction*100))+".png")
		var error := root.get_texture().get_image().save_png(path)
		if error != OK: failures.append("Capture failed " + path)
		data.frames.append(path)
		var sample := {}
		for index in skeleton.get_bone_count():
			var position := skeleton.global_transform * skeleton.get_bone_global_pose(index).origin
			sample[skeleton.get_bone_name(index)] = [position.x,position.y,position.z]
		data.pose_samples.append(sample)
	if data.pose_samples[0] == data.pose_samples[2]: failures.append(str(clip.label) + " skeleton did not move")
	# Play the real clip at its imported duration after pose sampling.
	title.text = "OpenFun / Meshy — " + str(clip.label) + " / normal playback"
	player.stop()
	player.play(selected)
	await create_timer(animation.length + 0.75).timeout
	reports.append(data)
	actor.queue_free()
	await process_frame

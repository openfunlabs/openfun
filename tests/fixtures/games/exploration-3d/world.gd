extends Node3D
## Data-only client: all durable changes go through the authoritative World Host.

const SPEED := 6.0
const INTERACT_RANGE := 4.5
const CHUNK_SIZE := 32.0
const EDGE_MARGIN := 0.42
const GROUND_SHADER = preload("res://ground.gdshader")
const GLTF_MATERIALS = preload("res://gltf_materials.gd")
var host := ""
var token := ""
var smoke := false
var smoke_retry := false
var failure_observed := false
var smoke_retry_requested := false
var screenshot_path := ""
var snapshot: Dictionary = {}
var world_root: Node3D
var world_environment: WorldEnvironment
var player: CharacterBody3D
var camera: Camera3D
var sky_material: ProceduralSkyMaterial
var title_label: Label
var status_label: Label
var help_label: Label
var target_label: Label
var waiting_panel: ColorRect
var waiting_title: Label
var waiting_detail: Label
var ready_chunks: Dictionary = {}
var initial_player_position := Vector3.ZERO
var pending_observed := false
var boundary_blocked_until := 0.0
var entity_nodes: Dictionary = {}
var model_scenes: Dictionary = {}
var vertex_color_repairs := 0
var asset_pending: Dictionary = {}
var snapshot_busy := false
var command_busy := false
var started := false
var interval := 0.0
var last_saved := Vector3.ZERO
var request_sequence := 0
var client_id := ""
var notification := "正在连接世界主机…"
var notification_until := 0.0

func _ready() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--host="):
			host = argument.substr(7).trim_suffix("/")
		elif argument.begins_with("--token="):
			token = argument.substr(8)
		elif argument == "--smoke-test":
			smoke = true
		elif argument == "--smoke-retry":
			smoke_retry = true
		elif argument.begins_with("--screenshot="):
			screenshot_path = argument.substr(13)
	# A launcher must supply a local host. No world package supplies executable code.
	if not host.begins_with("http://127.0.0.1:") or token.is_empty():
		push_error("Openfun requires --host=http://127.0.0.1:PORT and --token.")
		get_tree().quit(2)
		return
	client_id = Crypto.new().generate_random_bytes(12).hex_encode()
	_setup_world()
	_setup_player()
	_setup_ui()
	await _refresh_snapshot(true)
	if smoke:
		await _smoke_test()
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		if not screenshot_path.is_empty():
			await get_tree().create_timer(2.0).timeout
			await _save_screenshot()

func _setup_world() -> void:
	world_root = Node3D.new()
	add_child(world_root)
	var environment := WorldEnvironment.new()
	world_environment = environment
	var settings := Environment.new()
	settings.background_mode = Environment.BG_SKY
	sky_material = ProceduralSkyMaterial.new()
	sky_material.sky_curve = 0.25
	sky_material.ground_curve = 0.35
	var sky := Sky.new()
	sky.sky_material = sky_material
	settings.sky = sky
	settings.background_color = Color("9cbdc6")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("c4d7df")
	settings.ambient_light_energy = 0.43
	settings.ambient_light_sky_contribution = 0.0
	settings.fog_enabled = true
	settings.fog_mode = Environment.FOG_MODE_DEPTH
	settings.fog_depth_begin = 38.0
	settings.fog_depth_end = 145.0
	settings.fog_depth_curve = 1.5
	settings.fog_sky_affect = 0.15
	settings.fog_sun_scatter = 0.12
	settings.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -32, 0)
	sun.light_color = Color("fff0d3")
	sun.light_energy = 0.75
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 110.0
	add_child(sun)

func _setup_player() -> void:
	player = CharacterBody3D.new()
	player.position = Vector3(0, 1.7, 8)
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.3
	capsule.height = 1.7
	shape.shape = capsule
	shape.position.y = -0.75
	player.add_child(shape)
	camera = Camera3D.new()
	camera.fov = 78
	camera.far = 300
	camera.rotation.x = -0.10
	player.add_child(camera)
	add_child(player)

func _setup_ui() -> void:
	var canvas := CanvasLayer.new()
	add_child(canvas)
	var panel := ColorRect.new()
	panel.color = Color(0.055, 0.09, 0.10, 0.83)
	panel.position = Vector2(20, 20)
	panel.size = Vector2(560, 104)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(panel)
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "sans-serif"])
	title_label = _label(canvas, Vector2(36, 29), 24, font)
	title_label.size = Vector2(528, 34)
	title_label.clip_text = true
	title_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	status_label = _label(canvas, Vector2(36, 65), 14, font)
	help_label = _label(canvas, Vector2(36, 91), 14, font)
	help_label.text = "WASD 移动 · 鼠标观察 · E 互动 · Esc 释放鼠标"
	var crosshair := _label(canvas, Vector2.ZERO, 24, font)
	crosshair.text = "+"
	crosshair.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	crosshair.position -= Vector2(7, 17)
	target_label = _label(canvas, Vector2(32, 0), 18, font)
	target_label.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	target_label.offset_left = 32
	target_label.offset_top = -68
	target_label.offset_right = 1220
	target_label.offset_bottom = -20
	target_label.clip_text = true
	target_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	waiting_panel = ColorRect.new()
	waiting_panel.color = Color(0.035, 0.055, 0.065, 0.90)
	waiting_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	canvas.add_child(waiting_panel)
	waiting_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	waiting_panel.offset_left = -300
	waiting_panel.offset_top = -90
	waiting_panel.offset_right = 300
	waiting_panel.offset_bottom = 90
	waiting_title = _label(waiting_panel, Vector2(28, 22), 24, font)
	waiting_detail = _label(waiting_panel, Vector2(28, 65), 16, font)
	waiting_detail.size = Vector2(544, 95)
	waiting_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	waiting_detail.max_lines_visible = 4
	waiting_detail.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	waiting_title.text = "正在连接你的世界"
	waiting_detail.text = "地图准备好后即可开始探索。"

func _label(parent: Node, at: Vector2, size: int, font: Font) -> Label:
	var result := Label.new()
	result.position = at
	result.add_theme_font_override("font", font)
	result.add_theme_font_size_override("font_size", size)
	result.add_theme_color_override("font_color", Color("f3f3e8"))
	result.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
	result.add_theme_constant_override("shadow_offset_x", 1)
	result.add_theme_constant_override("shadow_offset_y", 1)
	parent.add_child(result)
	return result

func _unhandled_input(event: InputEvent) -> void:
	if smoke:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			_notify("点击画面继续探索；关闭窗口即可退出。进度自动保存。")
		elif event.keycode == KEY_R and not command_busy:
			_retry_region()
		elif event.keycode == KEY_E and not command_busy and _position_ready(player.position):
			var target: Dictionary = _nearest_entity()
			if not target.is_empty():
				_interact(str(target.id))
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		player.rotate_y(-event.relative.x * 0.0025)
		camera.rotation.x = clampf(camera.rotation.x - event.relative.y * 0.0025, -1.4, 1.4)

func _process(delta: float) -> void:
	if host.is_empty() or player == null:
		return
	interval += delta
	if interval > 0.8:
		interval = 0
		_refresh_snapshot(not started)
		if not smoke and started and _position_ready(player.position) and player.position.distance_to(last_saved) > 0.25 and not command_busy:
			_save_position()
	_update_status()

func _physics_process(delta: float) -> void:
	if not started or smoke:
		return
	var input := Vector2.ZERO
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		input = Vector2(float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
			float(Input.is_physical_key_pressed(KEY_S)) - float(Input.is_physical_key_pressed(KEY_W))).normalized()
	_step_player(input, delta)

func _step_player(input: Vector2, delta: float) -> void:
	# Pending chunks have no floor and no simulated placeholder content.
	if not _position_ready(player.position):
		player.velocity = Vector3.ZERO
		return
	var direction := player.transform.basis * Vector3(input.x, 0, input.y)
	var next := player.position + direction * SPEED * delta
	if not _can_stand_at(Vector3(next.x, player.position.y, player.position.z)):
		direction.x = 0
		boundary_blocked_until = Time.get_ticks_msec() / 1000.0 + 1.5
	if not _can_stand_at(Vector3(player.position.x, player.position.y, next.z)):
		direction.z = 0
		boundary_blocked_until = Time.get_ticks_msec() / 1000.0 + 1.5
	player.velocity.x = direction.x * SPEED
	player.velocity.z = direction.z * SPEED
	player.velocity.y -= 20.0 * delta
	player.move_and_slide()
	# Defensive recovery for a stale/missing collider, never a way into unknown land.
	if player.position.y < 0:
		player.position = last_saved if _position_ready(last_saved) else initial_player_position
		player.position.y = 1.7
		player.velocity = Vector3.ZERO

func _chunk_key(x: int, z: int) -> String:
	return "%d,%d" % [x, z]

func _position_key(at: Vector3) -> String:
	return _chunk_key(int(floor((at.x + CHUNK_SIZE / 2.0) / CHUNK_SIZE)), int(floor((at.z + CHUNK_SIZE / 2.0) / CHUNK_SIZE)))

func _position_ready(at: Vector3) -> bool:
	return ready_chunks.has(_position_key(at))

func _can_stand_at(at: Vector3) -> bool:
	for offset in [Vector3(EDGE_MARGIN, 0, EDGE_MARGIN), Vector3(-EDGE_MARGIN, 0, EDGE_MARGIN), Vector3(EDGE_MARGIN, 0, -EDGE_MARGIN), Vector3(-EDGE_MARGIN, 0, -EDGE_MARGIN)]:
		if not _position_ready(at + offset):
			return false
	return true

func _region(key: String) -> Dictionary:
	for region in snapshot.get("generation", {}).get("regions", []):
		if str(region.id) == key:
			return region
	return {}

func _failed_region() -> Dictionary:
	var current := _region(_position_key(player.position))
	if current.get("status") == "failed":
		return current
	var closest: Dictionary = {}
	var distance := INF
	for region in snapshot.get("generation", {}).get("regions", []):
		if region.get("status") == "failed":
			var d := Vector2(player.position.x - float(region.x) * CHUNK_SIZE, player.position.z - float(region.z) * CHUNK_SIZE).length()
			if d < distance:
				closest = region
				distance = d
	return closest

func _update_status() -> void:
	if waiting_panel == null:
		return
	var playable := started and _position_ready(player.position)
	waiting_panel.visible = not playable
	var generation: Dictionary = snapshot.get("generation", {})
	var is_ai: bool = generation.get("mode", "demo") == "ai"
	var failed := _failed_region()
	if not playable:
		pending_observed = pending_observed or is_ai
		if not started:
			waiting_title.text = "正在连接你的世界"
			waiting_detail.text = notification
		elif _region(_position_key(player.position)).get("status") == "failed":
			failure_observed = true
			waiting_title.text = "这片区域尚未创作成功"
			waiting_detail.text = str(_region(_position_key(player.position)).get("error", "生成任务失败。")) + "\n按 R 重试，或回到 CLI 调整世界。"
		elif not str(generation.get("blockedReason", "")).is_empty() and int(generation.get("active", 0)) == 0:
			waiting_title.text = "世界创作已暂停"
			waiting_detail.text = str(generation.blockedReason) + "\n请回到 CLI 处理后继续。"
		elif generation.get("budgetRemaining", 1) == 0 and int(generation.get("active", 0)) == 0 and int(generation.get("queued", 0)) == 0:
			waiting_title.text = "本次世界扩展额度已用完"
			waiting_detail.text = "区域仍未生成。请回到 CLI 调整本次生成额度后重新进入。"
		else:
			waiting_title.text = "正在创作你脚下的世界" if is_ai else "正在载入世界"
			waiting_detail.text = "Agent 正参考世界设定生成这一片区域。完成后即可进入；等待时角色会保持在安全位置。"
	var active := int(generation.get("active", 0))
	var queued := int(generation.get("queued", 0))
	var mode := "AI 世界" if is_ai else "演示世界"
	status_label.text = "%s · 可探索 %d 区域 · 创作中 %d · 等待 %d" % [mode, ready_chunks.size(), active, queued]
	var target: Dictionary = _nearest_entity() if playable else {}
	if Time.get_ticks_msec() / 1000.0 < notification_until:
		target_label.text = notification
	elif not failed.is_empty():
		target_label.text = "附近区域生成失败 · R 重试 · " + str(failed.get("error", "请检查 CLI 中的 provider 与生成预算。"))
	elif not playable:
		target_label.text = "区域完成后即可进入。你可以在此等待，或回到 CLI 继续创作。"
	elif Time.get_ticks_msec() / 1000.0 < boundary_blocked_until:
		target_label.text = "前方区域尚未准备好。创作完成后，边界会自动开放。"
	elif not target.is_empty():
		target_label.text = "E · " + str(target.get("name", "互动"))
	elif not str(generation.get("blockedReason", "")).is_empty():
		target_label.text = str(generation.blockedReason)
	elif int(generation.get("budgetRemaining", 1)) == 0 and active == 0 and queued == 0:
		target_label.text = "本次扩展额度已用完，已完成的区域仍可继续游玩。"
	else:
		target_label.text = "向世界边缘探索，Agent 会提前创作附近区域。" if is_ai else "演示内容 · WASD 探索 · E 互动 · 世界变化自动保存"

func _retry_region() -> void:
	var region := _failed_region()
	if region.is_empty():
		return
	command_busy = true
	var result := await _api("/generation/retry", HTTPClient.METHOD_POST, {"x": region.x, "z": region.z})
	command_busy = false
	_notify(str(result.get("error", "已申请重新创作这片区域。")))
	await _refresh_snapshot()

func _api(path: String, method: HTTPClient.Method = HTTPClient.METHOD_GET, payload: Dictionary = {}) -> Dictionary:
	var request := HTTPRequest.new()
	request.timeout = 30.0
	request.body_size_limit = 32 * 1024 * 1024
	add_child(request)
	var headers := PackedStringArray(["Authorization: Bearer " + token, "Content-Type: application/json"])
	var body := JSON.stringify(payload) if method != HTTPClient.METHOD_GET else ""
	var error := request.request(host + path, headers, method, body)
	if error != OK:
		request.queue_free()
		return {"error": "无法连接世界主机"}
	var result: Array = await request.request_completed
	request.queue_free()
	if result[0] != HTTPRequest.RESULT_SUCCESS or result[1] < 200 or result[1] >= 300:
		var failure: Variant = JSON.parse_string(result[3].get_string_from_utf8())
		return {"error": str(failure.get("error", "世界请求失败")) if failure is Dictionary else "世界请求失败 (%s)" % str(result[1])}
	var data: Variant = JSON.parse_string(result[3].get_string_from_utf8())
	if not data is Dictionary:
		return {"error": "世界主机返回了无效数据"}
	return data

func _refresh_snapshot(initial := false) -> void:
	if snapshot_busy:
		return
	snapshot_busy = true
	var forward := -player.transform.basis.z
	var endpoint := "/snapshot" if initial else "/snapshot?x=%s&z=%s&headingX=%s&headingZ=%s" % [player.position.x, player.position.z, forward.x, forward.z]
	var data: Dictionary = await _api(endpoint)
	snapshot_busy = false
	if data.has("error"):
		_notify(str(data.error))
		return
	if not data.has("world") or not data.has("chunks"):
		_notify("世界主机没有提供地图")
		return
	if initial:
		player.position = _vector(data.get("player", {}).get("position", [0, 1.7, 8]))
		last_saved = player.position
		initial_player_position = player.position
	var old_key := _snapshot_key(snapshot)
	snapshot = data
	ready_chunks.clear()
	for chunk in data.chunks:
		ready_chunks[str(chunk.id)] = true
	title_label.text = str(data.world.get("name", "Openfun"))
	status_label.text = "区域 %d · 坐标 %d, %d · 状态已连接" % [data.chunks.size(), player.position.x, player.position.z]
	if old_key != _snapshot_key(data):
		_rebuild_world()
	started = true
	_update_status()

func _snapshot_key(data: Dictionary) -> String:
	# Player saves also advance the event revision. Only rebuild for visible content.
	return JSON.stringify(data.get("chunks", [])).sha256_text() + JSON.stringify(data.get("world", {}).get("palette", {})) + JSON.stringify(data.get("generation", {}).get("regions", []))

func _rebuild_world() -> void:
	for child in world_root.get_children():
		world_root.remove_child(child)
		child.queue_free()
	entity_nodes.clear()
	var palette: Dictionary = snapshot.world.get("palette", {})
	var sky_color := Color(str(palette.get("sky", "#9cbdc6")))
	world_environment.environment.background_color = sky_color
	world_environment.environment.fog_light_color = sky_color.lightened(0.12)
	sky_material.sky_top_color = sky_color.darkened(0.32)
	sky_material.sky_horizon_color = sky_color.lightened(0.28)
	sky_material.ground_horizon_color = sky_color.lightened(0.22)
	sky_material.ground_bottom_color = Color(str(palette.get("ground", "#6b8e67"))).darkened(0.55)
	for chunk in snapshot.chunks:
		var size := float(chunk.get("size", 32))
		var floor_node := Node3D.new()
		floor_node.position = Vector3(float(chunk.x) * size, -0.35, float(chunk.z) * size)
		world_root.add_child(floor_node)
		var ground_color := Color(str(palette.get("ground", "#6b8e67")))
		_add_box(floor_node, Vector3(size, 0.7, size), Vector3.ZERO, ground_color)
		var surface := ShaderMaterial.new()
		surface.shader = GROUND_SHADER
		surface.set_shader_parameter("ground_color", ground_color)
		floor_node.get_child(0).material_override = surface
		_collider(floor_node, Vector3(size, 0.7, size), Vector3.ZERO)
		for entity in chunk.get("entities", []):
			if entity.get("state", {}).get("removed", false):
				continue
			_build_entity(entity)
	_build_boundaries()

func _build_boundaries() -> void:
	for chunk in snapshot.get("chunks", []):
		for direction in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var neighbor := _chunk_key(int(chunk.x) + direction.x, int(chunk.z) + direction.y)
			if ready_chunks.has(neighbor):
				continue
			var edge := Node3D.new()
			edge.position = Vector3(float(chunk.x) * CHUNK_SIZE + direction.x * CHUNK_SIZE / 2.0, 0, float(chunk.z) * CHUNK_SIZE + direction.y * CHUNK_SIZE / 2.0)
			world_root.add_child(edge)
			var size := Vector3(0.12, 4, CHUNK_SIZE) if direction.x != 0 else Vector3(CHUNK_SIZE, 4, 0.12)
			_collider(edge, size, Vector3(0, 2, 0))
			var tint := Color("ddad72") if _region(neighbor).get("status") == "failed" else Color("b6dfe5")
			_add_box(edge, Vector3(size.x, 0.07, size.z), Vector3(0, 0.05, 0), tint)
			var pane := StandardMaterial3D.new()
			pane.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			pane.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			pane.albedo_color = Color(tint, 0.10)
			_add_box(edge, Vector3(size.x, 2.6, size.z), Vector3(0, 1.3, 0), tint)
			edge.get_child(edge.get_child_count() - 1).material_override = pane

func _build_entity(entity: Dictionary) -> void:
	var root := Node3D.new()
	root.name = str(entity.id).validate_node_name()
	root.position = _vector(entity.position)
	root.rotation.y = float(entity.get("rotation", 0))
	root.scale = _vector(entity.get("scale", [1, 1, 1]))
	world_root.add_child(root)
	entity_nodes[str(entity.id)] = root
	var visual := Node3D.new()
	visual.name = "Visual"
	root.add_child(visual)
	var tint := Color(str(entity.get("color", "#c8ba83")))
	var kind := str(entity.get("kind", "rock"))
	var open_door: bool = entity.get("state", {}).get("open", false)
	match kind:
		"tree":
			_add_cylinder(visual, 0.25, 2.2, Vector3(0, 1.1, 0), Color("765647"))
			_add_cone(visual, 1.65, 2.4, Vector3(0, 2.5, 0), tint.darkened(0.12))
			_add_cone(visual, 1.2, 2.1, Vector3(0, 3.4, 0), tint)
			_add_cone(visual, 0.68, 1.5, Vector3(0, 4.1, 0), tint.lightened(0.08))
			_collider(root, Vector3(0.5, 2.2, 0.5), Vector3(0, 1.1, 0))
		"house":
			# A real door opening: walls and collision leave a passage when opened.
			for wall in [[Vector3(0.2, 3, 3.6), Vector3(-1.8, 1.5, 0)], [Vector3(0.2, 3, 3.6), Vector3(1.8, 1.5, 0)],
				[Vector3(3.8, 3, 0.2), Vector3(0, 1.5, -1.7)], [Vector3(1.35, 3, 0.2), Vector3(-1.125, 1.5, 1.7)],
				[Vector3(1.35, 3, 0.2), Vector3(1.125, 1.5, 1.7)], [Vector3(0.9, 1, 0.2), Vector3(0, 2.5, 1.7)]]:
				_add_box(visual, wall[0], wall[1], tint)
				_collider(root, wall[0], wall[1])
			_add_roof(visual, tint.darkened(0.42))
			for x in [-1.84, 1.84]:
				_add_box(visual, Vector3(0.13, 3.05, 0.16), Vector3(x, 1.5, 1.75), Color("6a5445"))
			_add_box(visual, Vector3(0.06, 0.9, 1.1), Vector3(1.92, 1.75, 0), Color("e9c785"))
			var door := Node3D.new()
			door.position = Vector3(-0.45, 0, 1.7)
			door.rotation.y = -PI / 2 if open_door else 0.0
			visual.add_child(door)
			_add_box(door, Vector3(0.9, 2, 0.12), Vector3(0.45, 1, 0), Color("6a4737"))
			if not open_door:
				_collider(root, Vector3(0.9, 2, 0.15), Vector3(0, 1, 1.7))
		"crystal":
			_add_rock(visual, Vector3(0.8, 0.25, 0.8), Vector3(0, 0.12, 0), tint.darkened(0.42))
			_add_cone(visual, 0.34, 1.35, Vector3(0, 0.85, 0), tint, 6)
			var crystal_material := _material(tint)
			crystal_material.roughness = 0.26
			crystal_material.metallic = 0.16
			crystal_material.emission_enabled = true
			crystal_material.emission = tint.darkened(0.65)
			visual.get_child(visual.get_child_count() - 1).material_override = crystal_material
		"npc":
			for x in [-0.13, 0.13]:
				_add_box(visual, Vector3(0.19, 0.54, 0.25), Vector3(x, 0.29, 0), tint.darkened(0.5))
			_add_cylinder(visual, 0.28, 0.72, Vector3(0, 0.88, 0), tint)
			for x in [-0.36, 0.36]:
				_add_box(visual, Vector3(0.15, 0.57, 0.18), Vector3(x, 0.9, 0), tint.darkened(0.1))
			_add_sphere(visual, Vector3(0.48, 0.49, 0.46), Vector3(0, 1.52, 0), Color("dfbc94"))
			_add_cone(visual, 0.37, 0.28, Vector3(0, 1.8, 0), tint.darkened(0.35), 8)
			_add_box(visual, Vector3(0.5, 0.13, 0.37), Vector3(0, 1.2, 0), tint.lightened(0.3))
			_collider(root, Vector3(0.5, 1.8, 0.5), Vector3(0, 0.9, 0))
		"beacon":
			_add_box(visual, Vector3(1.5, 0.4, 1.5), Vector3(0, 0.2, 0), Color("909e92"))
			_add_cone(visual, 0.65, 2.6, Vector3(0, 1.7, 0), tint, 6)
		_:
			_add_rock(visual, Vector3(1.7, 1.1, 1.4), Vector3(0, 0.45, 0), tint)
			_collider(root, Vector3(1.2, 0.8, 1.1), Vector3(0, 0.4, 0))
	var asset := str(entity.get("asset", ""))
	if not asset.is_empty():
		if model_scenes.has(asset):
			_replace_visual(root, model_scenes[asset])
		elif not asset_pending.has(asset):
			_load_asset(asset)

func _material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.88
	return material

func _mesh(parent: Node3D, resource: Mesh, position_value: Vector3, color: Color) -> void:
	var mesh := MeshInstance3D.new()
	mesh.mesh = resource
	mesh.position = position_value
	mesh.material_override = _material(color)
	parent.add_child(mesh)

func _add_box(parent: Node3D, size: Vector3, at: Vector3, color: Color) -> void:
	var mesh := BoxMesh.new()
	mesh.size = size
	_mesh(parent, mesh, at, color)

func _add_sphere(parent: Node3D, size: Vector3, at: Vector3, color: Color) -> void:
	var mesh := SphereMesh.new()
	mesh.radial_segments = 12
	mesh.rings = 6
	mesh.radius = 0.5
	mesh.height = 1
	_mesh(parent, mesh, at, color)
	parent.get_child(parent.get_child_count() - 1).scale = size

func _add_rock(parent: Node3D, size: Vector3, at: Vector3, tint: Color) -> void:
	# Faceted geometry, no new logical objects or randomly generated world content.
	var t := (1.0 + sqrt(5.0)) / 2.0
	var vertices := [Vector3(-1,t,0),Vector3(1,t,0),Vector3(-1,-t,0),Vector3(1,-t,0),Vector3(0,-1,t),Vector3(0,1,t),Vector3(0,-1,-t),Vector3(0,1,-t),Vector3(t,0,-1),Vector3(t,0,1),Vector3(-t,0,-1),Vector3(-t,0,1)]
	var faces := [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]]
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for face in faces:
		var a: Vector3 = vertices[face[0]].normalized() * size * 0.63
		var b: Vector3 = vertices[face[1]].normalized() * size * 0.63
		var c: Vector3 = vertices[face[2]].normalized() * size * 0.63
		var normal := (b - a).cross(c - a).normalized()
		for vertex in [a, c, b]:
			surface.set_normal(normal)
			surface.add_vertex(vertex)
	_mesh(parent, surface.commit(), at, tint)

func _add_roof(parent: Node3D, tint: Color) -> void:
	var vertices := [Vector3(-2.1,3,-2),Vector3(2.1,3,-2),Vector3(0,4.5,-2),Vector3(-2.1,3,2),Vector3(2.1,3,2),Vector3(0,4.5,2)]
	var faces := [[0,2,1],[3,4,5],[0,3,5],[0,5,2],[1,2,5],[1,5,4],[0,1,4],[0,4,3]]
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for face in faces:
		var a: Vector3 = vertices[face[0]]
		var b: Vector3 = vertices[face[1]]
		var c: Vector3 = vertices[face[2]]
		var normal := (b - a).cross(c - a).normalized()
		for vertex in [a, c, b]:
			surface.set_normal(normal)
			surface.add_vertex(vertex)
	_mesh(parent, surface.commit(), Vector3.ZERO, tint)

func _add_cylinder(parent: Node3D, radius: float, height: float, at: Vector3, color: Color) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 10
	_mesh(parent, mesh, at, color)

func _add_cone(parent: Node3D, radius: float, height: float, at: Vector3, color: Color, sides := 8) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = sides
	_mesh(parent, mesh, at, color)

func _collider(parent: Node3D, size: Vector3, at: Vector3) -> void:
	var body := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	shape.position = at
	body.add_child(shape)
	parent.add_child(body)

func _replace_visual(root: Node3D, packed: PackedScene) -> void:
	var old := root.get_node_or_null("Visual")
	if old:
		root.remove_child(old)
		old.queue_free()
	var model := packed.instantiate()
	model.name = "Visual"
	root.add_child(model)

func _load_asset(filename: String) -> void:
	var pattern := RegEx.new()
	pattern.compile("^[a-f0-9]{64}\\.glb$")
	if pattern.search(filename) == null:
		push_warning("Rejected non-content-addressed asset name")
		return
	asset_pending[filename] = true
	var request := HTTPRequest.new()
	request.timeout = 30
	request.body_size_limit = 32 * 1024 * 1024
	add_child(request)
	var error := request.request(host + "/assets/" + filename, PackedStringArray(["Authorization: Bearer " + token]))
	if error != OK:
		request.queue_free()
		asset_pending.erase(filename)
		return
	var response: Array = await request.request_completed
	request.queue_free()
	if response[0] != HTTPRequest.RESULT_SUCCESS or response[1] != 200:
		asset_pending.erase(filename)
		return
	var bytes: PackedByteArray = response[3]
	var digest := HashingContext.new()
	digest.start(HashingContext.HASH_SHA256)
	digest.update(bytes)
	if digest.finish().hex_encode() != filename.trim_suffix(".glb"):
		push_warning("Asset hash mismatch")
		asset_pending.erase(filename)
		return
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var parse_error := document.append_from_buffer(bytes, "", state)
	if parse_error != OK:
		push_warning("GLB import failed: %s" % parse_error)
		asset_pending.erase(filename)
		return
	var scene := document.generate_scene(state)
	if scene == null:
		asset_pending.erase(filename)
		return
	vertex_color_repairs += GLTF_MATERIALS.enable_vertex_colors(scene)
	var packed := PackedScene.new()
	if packed.pack(scene) != OK:
		scene.free()
		asset_pending.erase(filename)
		return
	scene.free()
	model_scenes[filename] = packed
	asset_pending.erase(filename)
	for chunk in snapshot.get("chunks", []):
		for entity in chunk.get("entities", []):
			if str(entity.get("asset", "")) == filename and entity_nodes.has(str(entity.id)):
				_replace_visual(entity_nodes[str(entity.id)], packed)

func _nearest_entity() -> Dictionary:
	var closest: Dictionary = {}
	var distance := INTERACT_RANGE
	for chunk in snapshot.get("chunks", []):
		for entity in chunk.get("entities", []):
			if entity.get("state", {}).get("removed", false) or entity.get("kind") == "rock":
				continue
			var at := _vector(entity.position)
			var candidate := Vector2(player.position.x, player.position.z).distance_to(Vector2(at.x, at.z))
			if candidate < distance:
				closest = entity
				distance = candidate
	return closest

func _command(payload: Dictionary) -> Dictionary:
	request_sequence += 1
	payload["id"] = "%s-%d" % [client_id, request_sequence]
	return await _api("/command", HTTPClient.METHOD_POST, payload)

func _interact(entity_id: String) -> void:
	command_busy = true
	var result: Dictionary = await _command({"type": "interact", "entityId": entity_id})
	command_busy = false
	_notify(str(result.get("message", result.get("error", "世界状态已保存"))))
	await _refresh_snapshot()

func _save_position() -> void:
	command_busy = true
	var position_value := player.position
	var result: Dictionary = await _command({"type": "move", "position": [position_value.x, position_value.y, position_value.z]})
	command_busy = false
	if result.get("ok", false):
		last_saved = position_value

func _notify(message: String) -> void:
	notification = message
	notification_until = Time.get_ticks_msec() / 1000.0 + 5.0
	if target_label:
		target_label.text = message

func _vector(value: Array) -> Vector3:
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

func _save_screenshot() -> bool:
	if DisplayServer.get_name() == "headless":
		return false
	await RenderingServer.frame_post_draw
	return get_viewport().get_texture().get_image().save_png(screenshot_path) == OK

func _save_smoke_state_screenshot(state_name: String) -> void:
	var final_path := screenshot_path
	screenshot_path = final_path.get_basename() + "-" + state_name + ".png"
	await _save_screenshot()
	screenshot_path = final_path

func _smoke_test() -> void:
	var wait_deadline := Time.get_ticks_msec() + 240000
	var frozen_y := player.position.y
	var pending_safe := true
	var waiting_screenshot := false
	var failure_screenshot := false
	while (not started or not _position_ready(player.position)) and Time.get_ticks_msec() < wait_deadline:
		_step_player(Vector2(1, 0), 1.0 / 60.0)
		pending_safe = pending_safe and is_equal_approx(player.position.y, frozen_y)
		if pending_observed and not waiting_screenshot and not screenshot_path.is_empty():
			waiting_screenshot = true
			await _save_smoke_state_screenshot("waiting")
		if failure_observed and not failure_screenshot and not screenshot_path.is_empty():
			failure_screenshot = true
			await _save_smoke_state_screenshot("failed")
		if smoke_retry and not smoke_retry_requested and not _failed_region().is_empty():
			smoke_retry_requested = true
			await _retry_region()
		await get_tree().create_timer(0.1).timeout
	var report := {"ok": false, "chunks": snapshot.get("chunks", []).size(), "entities": entity_nodes.size(), "assets": 0,
		"pending_observed": pending_observed, "pending_safe": pending_safe,
		"failure_observed": failure_observed, "retry_requested": smoke_retry_requested,
		"initial_position_restored": player.position.is_equal_approx(initial_player_position)}
	if not _position_ready(player.position):
		report["error"] = "Initial region did not become ready before the smoke timeout"
		print("OPENFUN_SMOKE_JSON " + JSON.stringify(report))
		get_tree().quit(1)
		return
	# Exercise actual engine collision against streamed floor geometry.
	for frame in range(40):
		await get_tree().physics_frame
		player.velocity = Vector3(0, -3, 0)
		player.move_and_slide()
	report["floor_collision"] = player.is_on_floor() and player.position.y > 1.4
	# Check the same guard used by keyboard movement at each ungenerated frontier.
	var frontier_checked := false
	var frontier_safe := true
	for chunk in snapshot.chunks:
		for direction in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]:
			if not ready_chunks.has(_chunk_key(int(chunk.x) + direction.x, int(chunk.z) + direction.y)):
				var beyond := Vector3(float(chunk.x) * CHUNK_SIZE + direction.x * (CHUNK_SIZE / 2.0 + 1), 1.7, float(chunk.z) * CHUNK_SIZE + direction.y * (CHUNK_SIZE / 2.0 + 1))
				frontier_checked = true
				frontier_safe = frontier_safe and not _can_stand_at(beyond)
	report["frontier_checked"] = frontier_checked
	report["frontier_safe"] = frontier_safe
	var target: Dictionary = {}
	for chunk in snapshot.chunks:
		for entity in chunk.get("entities", []):
			if entity.get("kind") in ["tree", "crystal", "house"] and not entity.get("state", {}).get("removed", false):
				target = entity
				break
		if not target.is_empty():
			break
	if target.is_empty():
		report["error"] = "No interactive entity in loaded chunks"
	else:
		var target_position := _vector(target.position) + Vector3(1.5, 1.7, 0)
		var move_result: Dictionary = await _command({"type": "move", "position": [target_position.x, target_position.y, target_position.z]})
		player.position = target_position
		var interact_result: Dictionary = await _command({"type": "interact", "entityId": target.id})
		while snapshot_busy:
			await get_tree().process_frame
		await _refresh_snapshot()
		var changed := false
		for chunk in snapshot.chunks:
			for entity in chunk.get("entities", []):
				if entity.id == target.id:
					changed = entity.get("state", {}) != target.get("state", {})
		report["move"] = move_result.get("ok", false)
		report["interaction"] = interact_result.get("ok", false)
		report["persisted_state"] = changed
		report["entity_id"] = target.id
		report["ok"] = report.chunks > 0 and report.entities > 0 and report.move and report.interaction and changed and report.floor_collision and pending_safe and frontier_safe and report.initial_position_restored
	# Runtime GLB jobs finish asynchronously, also in exported applications.
	var deadline := Time.get_ticks_msec() + 15000
	while not asset_pending.is_empty() and Time.get_ticks_msec() < deadline:
		await get_tree().create_timer(0.1).timeout
	report["assets"] = model_scenes.size()
	report["vertex_color_repairs"] = vertex_color_repairs
	report["pending_assets"] = asset_pending.size()
	if not screenshot_path.is_empty():
		report["screenshot"] = await _save_screenshot()
	print("OPENFUN_SMOKE_JSON " + JSON.stringify(report))
	get_tree().quit(0 if report.ok else 1)

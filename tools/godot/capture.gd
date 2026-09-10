extends SceneTree
## OpenFun's isolated, timed visual diagnostic. Never edits the original save.
var config: Dictionary
var started := false
var start_us := 0
var last_us := 0
var input_index := 0
var capture_index := 0
var intervals: Array[float] = []
var executed: Array[Dictionary] = []
var captures: Array[Dictionary] = []
var peak_draw_calls := 0.0
var peak_nodes := 0.0
var peak_memory := 0.0
var peak_process_ms := 0.0
var peak_physics_ms := 0.0
var peak_primitives := 0.0
var skipped_capture_intervals := 0
var capture_previous_frame := false

func _initialize() -> void:
	if "--openfun-prepare-preview" in OS.get_cmdline_user_args():
		var overrides := ConfigFile.new()
		if FileAccess.file_exists("res://override.cfg") and overrides.load("res://override.cfg") != OK:
			push_error("Could not load preview overrides")
			quit(2)
			return
		overrides.set_value("display", "window/size/no_focus", true)
		overrides.set_value("display", "window/size/always_on_top", false)
		overrides.set_value("display", "window/size/mode", 0)
		overrides.set_value("display", "window/subwindows/embed_subwindows", true)
		quit(0 if overrides.save("res://override.cfg") == OK else 2)
		return
	var config_path := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--openfun-capture="): config_path = arg.substr(18)
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(config_path))
	if not parsed is Dictionary:
		push_error("Invalid OpenFun capture configuration")
		quit(2)
		return
	config = parsed
	call_deferred("start_game")

func protect_desktop() -> void:
	if bool(config.get("headless", false)): return
	if not root.unfocusable: root.unfocusable = true
	if root.always_on_top: root.always_on_top = false
	if not root.mouse_passthrough: root.mouse_passthrough = true
	if Input.mouse_mode != Input.MOUSE_MODE_VISIBLE: Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func start_game() -> void:
	protect_desktop()
	var packed = load(ProjectSettings.get_setting("application/run/main_scene"))
	if not packed is PackedScene:
		push_error("Main scene is not a PackedScene")
		quit(2)
		return
	var game = packed.instantiate()
	root.add_child(game)
	current_scene = game
	protect_desktop()
	for item in config.inputs:
		if item.kind == "action" and not InputMap.has_action(item.name):
			push_error("Unknown input action: " + str(item.name))
			quit(2)
			return
		if item.kind == "key" and OS.find_keycode_from_string(item.name) == KEY_NONE:
			push_error("Unknown key name: " + str(item.name))
			quit(2)
			return
	start_us = Time.get_ticks_usec()
	last_us = start_us
	started = true

func _process(_delta: float) -> bool:
	if not started: return false
	protect_desktop()
	var now := Time.get_ticks_usec()
	var elapsed := float(now - start_us) / 1000000.0
	# Real wall-clock intervals remain meaningful when gameplay uses hit-stop/time_scale.
	if float(last_us - start_us) / 1000000.0 >= float(config.get("warmupSeconds", 1.0)):
		if capture_previous_frame: skipped_capture_intervals += 1
		else: intervals.append(float(now - last_us) / 1000.0)
	capture_previous_frame = false
	last_us = now
	peak_draw_calls = maxf(peak_draw_calls, Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	peak_process_ms = maxf(peak_process_ms, Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
	peak_physics_ms = maxf(peak_physics_ms, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
	peak_primitives = maxf(peak_primitives, Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME))
	peak_nodes = maxf(peak_nodes, Performance.get_monitor(Performance.OBJECT_NODE_COUNT))
	peak_memory = maxf(peak_memory, Performance.get_monitor(Performance.MEMORY_STATIC))
	while input_index < config.inputs.size() and float(config.inputs[input_index].at) <= elapsed:
		var item: Dictionary = config.inputs[input_index]
		inject(item)
		executed.append({"requested":item,"observedAt":elapsed})
		input_index += 1
	while capture_index < config.frames.size() and float(config.frames[capture_index].at) <= elapsed:
		capture_previous_frame = true
		RenderingServer.force_draw(false)
		var screenshot := root.get_texture().get_image()
		if screenshot == null or screenshot.is_empty():
			push_error("No rendered image available")
			quit(3)
			return false
		var frame: Dictionary = config.frames[capture_index]
		if screenshot.save_png(frame.path) != OK:
			push_error("Could not save preview image")
			quit(4)
			return false
		captures.append({"requestedAt":frame.at,"observedAt":elapsed,"path":frame.path})
		capture_index += 1
	if elapsed >= float(config.seconds):
		started = false
		var report := {"frameIntervalsMs":intervals,"inputs":executed,"captures":captures,
			"elapsedSeconds":elapsed,"warmupSeconds":config.get("warmupSeconds",1.0),
			"skippedCaptureIntervals":skipped_capture_intervals,"peakProcessMs":peak_process_ms,
			"peakPhysicsMs":peak_physics_ms,"peakPrimitives":peak_primitives,"peakDrawCalls":peak_draw_calls,
			"peakNodes":peak_nodes,"peakStaticMemoryBytes":peak_memory,"os":OS.get_name(),
			"videoAdapter":RenderingServer.get_video_adapter_name(),
			"renderer":RenderingServer.get_current_rendering_method(),
			"windowUnfocusable":root.unfocusable,"mouseMode":Input.mouse_mode,
			"displayDriver":DisplayServer.get_name(),"headless":bool(config.get("headless",false))}
		var file := FileAccess.open(config.reportPath, FileAccess.WRITE)
		if file == null:
			push_error("Could not save capture report")
			quit(4)
			return false
		file.store_string(JSON.stringify(report))
		file.close()
		print("OPENFUN_PREVIEW_CAPTURED 0")
		quit(0)
	return false

func inject(item: Dictionary) -> void:
	var event: InputEvent
	if item.kind == "action":
		var action := InputEventAction.new()
		action.action = item.name
		action.pressed = item.pressed
		action.strength = 1.0 if item.pressed else 0.0
		event = action
	elif item.kind == "key":
		var key := InputEventKey.new()
		key.keycode = OS.find_keycode_from_string(item.name)
		key.physical_keycode = key.keycode
		key.pressed = item.pressed
		event = key
	else:
		var mouse := InputEventMouseButton.new()
		mouse.button_index = int(item.button)
		mouse.pressed = item.pressed
		if item.has("position"):
			mouse.position = Vector2(item.position[0], item.position[1])
			mouse.global_position = mouse.position
		event = mouse
	Input.parse_input_event(event)

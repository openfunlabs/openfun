extends Node2D
# Instrumentation fixture, not shipped gameplay or an art-quality example.
var clock := 0.0
var swing := -1.0
var blade_angle := -0.9
var contact := false
var hits := 0
var stalled := false
var moved := false
var released := false
var player := Vector2(230, 220)
const TARGET := Vector2(305, 220)

func _ready() -> void:
	# A game may request capture; headless QA must remain independent of the desktop.
	if DisplayServer.get_name() == "headless": Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	InputMap.add_action("attack")

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("attack"):
		swing = 0.0
		contact = false
		print("FIXTURE_ATTACK_STARTED")
	if event is InputEventMouseButton and event.pressed:
		print("FIXTURE_MOUSE_RECEIVED " + str(event.position))

func _physics_process(delta: float) -> void:
	if Input.is_physical_key_pressed(KEY_D):
		player.x += delta * 30.0
		if not moved:
			moved = true
			print("FIXTURE_KEY_MOVED")
	elif moved and not released:
		released = true
		print("FIXTURE_KEY_RELEASED")
	if swing >= 0.0:
		swing += delta
		if swing < 0.16: blade_angle = lerpf(-0.9, -1.5, swing / 0.16)
		elif swing < 0.4:
			blade_angle = lerpf(-1.5, 1.2, (swing - 0.16) / 0.24)
			var tip := player + Vector2.from_angle(blade_angle) * 88.0
			if not contact and Geometry2D.get_closest_point_to_segment(TARGET, player, tip).distance_to(TARGET) < 20.0:
				contact = true
				hits += 1
				print("FIXTURE_CONTACT " + str(hits))
		elif swing < 0.65: blade_angle = lerpf(1.2, -0.9, (swing - 0.4) / 0.25)
		else: swing = -1.0
	queue_redraw()

func _process(delta: float) -> void:
	clock += delta
	if clock > 1.6 and not stalled:
		stalled = true
		OS.delay_msec(90) # Controlled hitch: prove telemetry sees a stalled frame.
		print("FIXTURE_HITCH")

func _draw() -> void:
	draw_rect(Rect2(0, 0, 640, 480), Color("15232b"))
	draw_circle(player, 22, Color("72b8ab"))
	draw_circle(TARGET, 20, Color("e6aa76") if hits == 0 else Color("a8534b"))
	var direction := Vector2.from_angle(blade_angle)
	var normal := direction.orthogonal() * 5
	var base := player + direction * 25
	var tip := player + direction * 88
	draw_colored_polygon(PackedVector2Array([base+normal, tip, base-normal]), Color("e3cf9b"))
	draw_line(player + direction * 18, base, Color("6b4739"), 8)

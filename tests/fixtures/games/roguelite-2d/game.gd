extends Node2D
## Editable native Godot sample. Openfun supplies only generic content and state APIs.
const CONTENT = preload("res://content.gd")
const NS := "roguelite2d"
const TILE := 56.0
const ORIGIN := Vector2(128, 142)
const ROOM := Rect2(128, 142, 896, 448)
const PLAYER_RADIUS := 15.0
const BASE_STATS := {"max_hp":100.0,"damage":18.0,"speed":230.0,"attack_interval":0.25,"dash_cooldown":1.35}
var host := ""
var token := ""
var demo_mode := false
var smoke := false
var smoke_resume := false
var screenshot_path := ""
var font: SystemFont
var jobs: Dictionary = {}
var levels: Dictionary = {}
var rewards: Dictionary = {}
var requested: Dictionary = {}
var polling := false
var poll_clock := 0.0
var save_clock := 0.0
var save_revision := 0
var save_busy := false
var dirty := false
var save_conflict := false
var initialized := false
var restored := false
var saw_loading := false
var source_note := "正在连接世界"
var error_message := ""
var content_rejection := ""
var notice := ""
var notice_timer := 0.0
var current_level := 1
var level_data: Dictionary = {}
var level_history: Dictionary = {}
var player_pos := Vector2.ZERO
var player_hp := 100.0
var player_stats: Dictionary = BASE_STATS.duplicate()
var aim := Vector2.RIGHT
var walk_clock := 0.0
var attack_timer := 0.0
var dash_timer := 0.0
var dash_left := 0.0
var dash_direction := Vector2.RIGHT
var invulnerable := 0.0
var player_flash := 0.0
var enemies: Array = []
var bullets: Array = []
var particles: Array = []
var walls: Array[Rect2] = []
const DEATH_LIFECYCLE = preload("res://openfun_death_lifecycle.gd")
var death_presentations: Array = []
var selected_skills: Array = []
var skill_chosen := false
var dead := false
var exiting := false
var wanted_level := 1
var elapsed := 0.0
var run_number := 1
var quitting := false
var metrics := {"shots":0,"hits":0,"kills":0,"contact_hits":0,"projectile_hits":0,"dashes":0,"deaths":0,"restarts":0,"levels_entered":0}

func _ready() -> void:
	get_tree().auto_accept_quit = false
	var args := OS.get_cmdline_user_args()
	for i in range(args.size()):
		var arg := str(args[i])
		if arg.begins_with("--host="): host = arg.substr(7).trim_suffix("/")
		elif arg == "--host" and i + 1 < args.size(): host = str(args[i+1]).trim_suffix("/")
		elif arg.begins_with("--token="): token = arg.substr(8)
		elif arg == "--token" and i + 1 < args.size(): token = str(args[i+1])
		elif arg == "--demo": demo_mode = true
		elif arg == "--smoke-test": smoke = true
		elif arg == "--smoke-resume": smoke = true; smoke_resume = true
		elif arg.begins_with("--screenshot="): screenshot_path = arg.substr(13)
	font = SystemFont.new()
	font.font_names = PackedStringArray(["PingFang SC","Noto Sans CJK SC","Microsoft YaHei","sans-serif"])
	player_pos = _cell(1,4)
	if not host.begins_with("http://127.0.0.1:") or token.is_empty():
		error_message = "请通过 Openfun 启动此项目，提供本机 Host 和能力令牌。"
		if smoke: _finish_smoke({"ok":false,"error":error_message})
		return
	var health := await _api("/health")
	demo_mode = demo_mode or health.get("generationMode", "ai") == "demo"
	source_note = "DEMO · 明确的手工演示内容" if demo_mode else "AI · 内容来自世界文档"
	var saved := await _api("/game/state?namespace=" + NS)
	if saved.has("error"):
		error_message = str(saved.error)
		return
	save_revision = int(saved.get("revision",0))
	if saved.get("state") is Dictionary and saved.state.get("version") == 1:
		_restore(saved.state)
		restored = true
		if bool(saved.state.get("demo",false)):
			demo_mode = true
			source_note = "DEMO · 此存档使用手工演示内容"
	initialized = true
	if level_data.is_empty():
		await _ensure_content("level",current_level)
		await _ensure_content("skills",current_level)
	else:
		_prepare_walls()
		_ensure_content("skills",current_level)
		_ensure_content("level",current_level+1)
	if smoke:
		_run_smoke()
	elif not screenshot_path.is_empty():
		await get_tree().create_timer(3.0).timeout
		await _screenshot(screenshot_path)

func _process(delta: float) -> void:
	if not initialized:
		queue_redraw()
		return
	poll_clock += delta
	save_clock += delta
	if poll_clock > 0.65:
		poll_clock = 0
		_poll_jobs()
	if save_clock > 1.0:
		save_clock = 0
		if dirty and not save_conflict: _flush_save()
	queue_redraw()

func _physics_process(delta: float) -> void:
	if smoke or not initialized or quitting: return
	var input := Vector2(float(Input.is_physical_key_pressed(KEY_D))-float(Input.is_physical_key_pressed(KEY_A)),float(Input.is_physical_key_pressed(KEY_S))-float(Input.is_physical_key_pressed(KEY_W))).normalized()
	var direction := get_global_mouse_position() - player_pos
	if direction.length_squared() > 1: aim = direction.normalized()
	_simulate(minf(delta,0.04), input, Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))

func _unhandled_input(event: InputEvent) -> void:
	if smoke: return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE: _dash()
		elif event.keycode in [KEY_R,KEY_ENTER] and dead: _restart()
		elif event.keycode == KEY_R and not error_message.is_empty(): _retry_failed()
		elif event.keycode in [KEY_1,KEY_2,KEY_3] and _choosing_skill(): _choose_skill(event.keycode-KEY_1)
		elif event.keycode == KEY_E and _exit_open(): _try_exit()
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed and _choosing_skill():
		for i in range(3):
			if _card_rect(i).has_point(event.position): _choose_skill(i); return

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST: _save_and_quit()

func _save_and_quit() -> void:
	if quitting: return
	quitting = true
	while save_busy: await get_tree().process_frame
	if initialized and not save_conflict: await _flush_save()
	get_tree().quit()

func _api(path: String, payload: Variant = null) -> Dictionary:
	var request := HTTPRequest.new()
	request.timeout = 30
	request.body_size_limit = 512*1024
	add_child(request)
	var method := HTTPClient.METHOD_GET if payload == null else HTTPClient.METHOD_POST
	var err := request.request(host+path,PackedStringArray(["Authorization: Bearer "+token,"Content-Type: application/json"]),method,"" if payload == null else JSON.stringify(payload))
	if err != OK:
		request.queue_free()
		return {"error":"无法连接世界 Host。","status":0}
	var result: Array = await request.request_completed
	request.queue_free()
	var data: Variant = JSON.parse_string(result[3].get_string_from_utf8())
	if not data is Dictionary: return {"error":"Host 返回无效响应。","status":int(result[1])}
	data["status"] = int(result[1])
	if result[0] != HTTPRequest.RESULT_SUCCESS:
		data["error"] = "世界请求超时或连接中断。"
	return data

func _key(kind: String, index: int) -> String:
	return "%s:%d:v1" % [kind,index]

func _ensure_content(kind: String, index: int) -> void:
	var key := _key(kind,index)
	if requested.has(key): return
	requested[key] = true
	if demo_mode:
		_accept_content(kind,index,CONTENT.demo_level(index) if kind == "level" else CONTENT.demo_skills())
		return
	var existing := await _api("/content/jobs?namespace="+NS+"&key="+key.uri_encode())
	if existing.has("job"):
		_apply_job(existing.job,kind,index)
		return
	if existing.get("status",0) != 404:
		error_message = str(existing.get("error","无法查询创作任务。"))
		return
	var response := await _api("/content/jobs",{"namespace":NS,"key":key,"prompt":CONTENT.prompt(kind,index),"schema":CONTENT.level_schema() if kind == "level" else CONTENT.skill_schema(),"context":{"floor":index,"project":"Lanternfall editable 2D sample v1"}})
	if response.has("job"):
		_apply_job(response.job,kind,index)
	else:
		error_message = str(response.get("error","无法提交创作任务。"))
		requested.erase(key)

func _apply_job(job: Dictionary, kind: String, index: int) -> void:
	var key := _key(kind,index)
	jobs[key] = {"id":str(job.id),"kind":kind,"index":index,"status":str(job.status)}
	if job.status == "ready":
		if not job.get("result") is Dictionary:
			error_message = "已完成的创作任务没有有效内容。"
			return
		_accept_content(kind,index,job.result)
	elif job.status == "failed":
		jobs[key]["error"] = str(job.get("error","创作失败。"))
		error_message = str(job.get("error","创作失败。"))

func _poll_jobs() -> void:
	if polling: return
	polling = true
	for key in jobs.keys():
		var job: Dictionary = jobs[key]
		if job.status in ["ready","failed"]: continue
		var response := await _api("/content/jobs?id="+str(job.id).uri_encode())
		if response.has("job"): _apply_job(response.job,str(job.kind),int(job.index))
		else: error_message = str(response.get("error","无法读取创作进度。"))
	polling = false

func _retry_failed() -> void:
	if not content_rejection.is_empty():
		error_message = content_rejection
		return
	for key in jobs.keys():
		var job: Dictionary = jobs[key]
		if job.status == "failed":
			var response := await _api("/content/jobs/"+str(job.id).uri_encode()+"/retry",{})
			if response.has("job"):
				error_message = ""
				_apply_job(response.job,str(job.kind),int(job.index))
			else: error_message = str(response.get("error","无法重试。"))
			return
	# Admission failures may have no job identity. Retrying is always explicit.
	error_message = ""
	await _ensure_content("level",wanted_level)
	await _ensure_content("skills",current_level)

func _accept_content(kind: String, index: int, data: Dictionary) -> void:
	var issue := CONTENT.validate_level(data) if kind == "level" else CONTENT.validate_skills(data)
	if not issue.is_empty():
		content_rejection = "AI 内容未通过玩法检查："+issue+" 请在 CLI 修正项目或用新版本内容 key 重新创作。"
		error_message = content_rejection
		return
	if kind == "level":
		levels[str(index)] = data.duplicate(true)
		if (level_data.is_empty() or exiting) and index == wanted_level: _enter_level(index)
	elif kind == "skills": rewards[str(index)] = data.duplicate(true)
	dirty = true

func _enter_level(index: int) -> void:
	if not levels.has(str(index)): return
	current_level = index
	wanted_level = index
	level_data = levels[str(index)].duplicate(true)
	player_pos = _cell(1,4)
	player_hp = minf(player_hp+8.0,float(player_stats.max_hp))
	enemies.clear()
	bullets.clear()
	particles.clear()
	death_presentations.clear()
	for source in level_data.enemies:
		var enemy: Dictionary = source.duplicate(true)
		enemy["position"] = [_cell(int(source.x),int(source.y)).x,_cell(int(source.x),int(source.y)).y]
		enemy["max_hp"] = float(source.hp)
		enemy["attack_timer"] = float(source.cooldown)*0.4
		enemy["flash"] = 0.0
		enemies.append(enemy)
	dead = false
	exiting = false
	skill_chosen = false
	invulnerable = 0.7
	_prepare_walls()
	metrics.levels_entered += 1
	dirty = true
	_ensure_content("skills",index)
	# This is actual background prefetch. It does not replace a pending room.
	_ensure_content("level",index+1)
	_notify("第 %d 层 · %s" % [index,str(level_data.title)])

func _prepare_walls() -> void:
	walls.clear()
	for wall in level_data.get("walls",[]):
		walls.append(Rect2(ORIGIN+Vector2(float(wall.x),float(wall.y))*TILE,Vector2(TILE,TILE)))

func _simulate(delta: float, input: Vector2, firing: bool) -> void:
	elapsed += delta
	for presentation in death_presentations:
		presentation.lifecycle.advance(delta)
	death_presentations = death_presentations.filter(func(p): return p.lifecycle.phase != DEATH_LIFECYCLE.Phase.FINISHED)
	notice_timer = maxf(0,notice_timer-delta)
	for particle in particles:
		particle.life -= delta
		particle.position = _v(particle.position)+_v(particle.velocity)*delta
	particles = particles.filter(func(p): return p.life > 0)
	if level_data.is_empty() or dead or _choosing_skill() or exiting or save_conflict: return
	attack_timer = maxf(0,attack_timer-delta)
	dash_timer = maxf(0,dash_timer-delta)
	invulnerable = maxf(0,invulnerable-delta)
	player_flash = maxf(0,player_flash-delta)
	if dash_left > 0:
		dash_left = maxf(0,dash_left-delta)
		player_pos = _move_actor(player_pos,dash_direction*640.0*delta,PLAYER_RADIUS)
	else:
		player_pos = _move_actor(player_pos,input*float(player_stats.speed)*delta,PLAYER_RADIUS)
	if input.length_squared() > 0.1: walk_clock += delta*13
	if firing and attack_timer <= 0: _shoot_player()
	for enemy in enemies:
		if enemy.hp <= 0: continue
		enemy.flash = maxf(0,float(enemy.flash)-delta)
		enemy.attack_timer = maxf(0,float(enemy.attack_timer)-delta)
		var position := _v(enemy.position)
		var toward := player_pos-position
		var distance := toward.length()
		var desired := toward.normalized()
		if enemy.kind == "shooter":
			if distance < 165: desired = -desired
			elif distance < 300 and _line_clear(position,player_pos): desired = Vector2.ZERO
			if enemy.attack_timer <= 0 and _line_clear(position,player_pos):
				enemy.attack_timer = float(enemy.cooldown)
				bullets.append({"position":position,"velocity":toward.normalized()*245.0,"enemy":true,"damage":float(enemy.damage),"life":3.0})
		else:
			if distance < PLAYER_RADIUS+17 and enemy.attack_timer <= 0:
				enemy.attack_timer = float(enemy.cooldown)
				_damage_player(float(enemy.damage),"contact_hits")
		var motion := desired*float(enemy.speed)*delta
		var moved := _move_actor(position,motion,16)
		if desired.length_squared() > 0 and moved.distance_to(position) < motion.length()*0.3:
			var path := _path_direction(position,player_pos)
			moved = _move_actor(position,path*float(enemy.speed)*delta,16)
		enemy.position = moved
	for bullet in bullets:
		if bullet.life <= 0: continue
		var old := _v(bullet.position)
		var next := old+_v(bullet.velocity)*delta
		bullet.life -= delta
		if not ROOM.has_point(next) or not _line_clear(old,next):
			bullet.life = 0
			continue
		bullet.position = next
		if bullet.enemy:
			if Geometry2D.get_closest_point_to_segment(player_pos,old,next).distance_to(player_pos) < PLAYER_RADIUS+4:
				bullet.life = 0
				_damage_player(float(bullet.damage),"projectile_hits")
		else:
			for enemy in enemies:
				var at := _v(enemy.position)
				if enemy.hp > 0 and Geometry2D.get_closest_point_to_segment(at,old,next).distance_to(at) < 20:
					enemy.hp -= float(bullet.damage)
					enemy.flash = 0.14
					bullet.life = 0
					metrics.hits += 1
					_burst(at,Color("f4cc74"),7)
					if enemy.hp <= 0:
						metrics.kills += 1
						var lifecycle = DEATH_LIFECYCLE.new()
						lifecycle.begin()
						death_presentations.append({"enemy":enemy.duplicate(true),"lifecycle":lifecycle,"direction":signf(_v(bullet.velocity).x) if absf(_v(bullet.velocity).x) > 0.1 else 1.0})
						_burst(at,Color("db6c68"),14)
					break
	bullets = bullets.filter(func(b): return b.life > 0)
	enemies = enemies.filter(func(e): return e.hp > 0)
	if enemies.is_empty():
		bullets.clear()
		if _exit_open() and player_pos.distance_to(_cell(14,4)) < 28: _try_exit()
	dirty = true

func _move_actor(at: Vector2, move: Vector2, radius: float) -> Vector2:
	var result := at
	var candidate := Vector2(clampf(at.x+move.x,ROOM.position.x+radius,ROOM.end.x-radius),at.y)
	if not _hits_wall(candidate,radius): result.x = candidate.x
	candidate = Vector2(result.x,clampf(at.y+move.y,ROOM.position.y+radius,ROOM.end.y-radius))
	if not _hits_wall(candidate,radius): result.y = candidate.y
	return result

func _hits_wall(at: Vector2, radius: float) -> bool:
	for wall in walls:
		var nearest := Vector2(clampf(at.x,wall.position.x,wall.end.x),clampf(at.y,wall.position.y,wall.end.y))
		if at.distance_squared_to(nearest) < radius*radius: return true
	return false

func _line_clear(a: Vector2,b: Vector2) -> bool:
	var count := maxi(1,int(ceil(a.distance_to(b)/10.0)))
	for i in range(count+1):
		var point := a.lerp(b,float(i)/count)
		for wall in walls:
			if wall.has_point(point): return false
	return true

func _path_direction(from: Vector2,to: Vector2) -> Vector2:
	var start := Vector2i(clampi(int((from.x-ORIGIN.x)/TILE),0,15),clampi(int((from.y-ORIGIN.y)/TILE),0,7))
	var goal := Vector2i(clampi(int((to.x-ORIGIN.x)/TILE),0,15),clampi(int((to.y-ORIGIN.y)/TILE),0,7))
	var queue: Array[Vector2i] = [start]
	var previous := {start:start}
	var cursor := 0
	while cursor < queue.size():
		var cell: Vector2i = queue[cursor]
		cursor += 1
		if cell == goal: break
		for d in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
			var next: Vector2i = cell+d
			if next.x < 0 or next.x > 15 or next.y < 0 or next.y > 7 or previous.has(next) or _hits_wall(_cell(next.x,next.y),17): continue
			previous[next] = cell
			queue.append(next)
	if not previous.has(goal): return (to-from).normalized()
	var step := goal
	while previous[step] != start and step != start: step = previous[step]
	return (_cell(step.x,step.y)-from).normalized()

func _shoot_player() -> void:
	attack_timer = float(player_stats.attack_interval)
	bullets.append({"position":player_pos+aim*21,"velocity":aim*620,"enemy":false,"damage":float(player_stats.damage),"life":1.0})
	metrics.shots += 1

func _dash() -> void:
	if dash_timer > 0 or dead or level_data.is_empty() or _choosing_skill(): return
	dash_direction = aim.normalized()
	dash_timer = float(player_stats.dash_cooldown)
	dash_left = 0.15
	invulnerable = 0.28
	metrics.dashes += 1
	_burst(player_pos,Color("79d7d0"),8)

func _damage_player(amount: float, kind: String) -> void:
	if invulnerable > 0 or dead: return
	player_hp = maxf(0,player_hp-amount)
	invulnerable = 0.62
	player_flash = 0.18
	metrics[kind] += 1
	_burst(player_pos,Color("e78578"),10)
	if player_hp <= 0:
		dead = true
		metrics.deaths += 1
		_flush_save()
	dirty = true

func _restart() -> void:
	if not dead: return
	player_stats = BASE_STATS.duplicate()
	player_hp = float(player_stats.max_hp)
	selected_skills.clear()
	level_history.clear()
	run_number += 1
	metrics.restarts += 1
	_enter_level(1)
	_flush_save()

func _death_in_motion() -> bool:
	return death_presentations.any(func(p): return p.lifecycle.phase == DEATH_LIFECYCLE.Phase.DYING)

func _choosing_skill() -> bool:
	return not dead and not _death_in_motion() and not level_data.is_empty() and enemies.is_empty() and not skill_chosen and rewards.has(str(current_level))

func _choose_skill(index: int) -> void:
	if not _choosing_skill() or index < 0 or index > 2: return
	var choice: Dictionary = rewards[str(current_level)].choices[index]
	var amount := float(choice.amount)
	match str(choice.effect):
		"damage": player_stats.damage += 4*amount
		"vitality": player_stats.max_hp += 12*amount; player_hp = minf(player_hp+12*amount,float(player_stats.max_hp))
		"haste": player_stats.speed += 14*amount
		"rapid_fire": player_stats.attack_interval /= 1+0.12*amount
		"evasion": player_stats.dash_cooldown = maxf(0.25,float(player_stats.dash_cooldown)-0.12*amount)
	selected_skills.append({"level":current_level,"choice":choice.duplicate(true)})
	skill_chosen = true
	dirty = true
	_notify("获得祝福 · "+str(choice.name))
	_flush_save()

func _exit_open() -> bool:
	return not dead and not _death_in_motion() and not level_data.is_empty() and enemies.is_empty() and skill_chosen

func _try_exit() -> void:
	if not _exit_open() or player_pos.distance_to(_cell(14,4)) > 62: return
	level_history[str(current_level)] = {"content":level_data.duplicate(true),"enemies":enemies.duplicate(true),"cleared":true}
	wanted_level = current_level+1
	if levels.has(str(wanted_level)):
		_enter_level(wanted_level)
	else:
		exiting = true
		_ensure_content("level",wanted_level)
		dirty = true

func _cell(x: int,y: int) -> Vector2:
	return ORIGIN+(Vector2(x,y)+Vector2(0.5,0.5))*TILE

func _v(value: Variant) -> Vector2:
	if value is Vector2: return value
	return Vector2(float(value[0]),float(value[1]))

func _json_value(value: Variant) -> Variant:
	if value is Vector2: return [value.x,value.y]
	if value is Array:
		var array := []
		for item in value: array.append(_json_value(item))
		return array
	if value is Dictionary:
		var object := {}
		for key in value: object[key] = _json_value(value[key])
		return object
	return value

func _save_payload() -> Dictionary:
	return _json_value({"version":1,"level":current_level,"wantedLevel":wanted_level,"levelData":level_data,"levels":levels,"rewards":rewards,"jobs":jobs,"player":{"position":player_pos,"hp":player_hp,"stats":player_stats,"attackTimer":attack_timer,"dashTimer":dash_timer,"dashLeft":dash_left,"dashDirection":dash_direction,"invulnerable":invulnerable},"enemies":enemies,"bullets":bullets,"selectedSkills":selected_skills,"skillChosen":skill_chosen,"dead":dead,"exiting":exiting,"history":level_history,"run":run_number,"metrics":metrics,"demo":demo_mode,"contentRejection":content_rejection})

func _flush_save() -> void:
	if save_busy or save_conflict or not initialized: return
	save_busy = true
	dirty = false
	var payload := _save_payload()
	var result := await _api("/game/state",{"namespace":NS,"expectedRevision":save_revision,"state":payload})
	if result.get("code") == "revision_conflict":
		save_conflict = true
		error_message = "另一个进程已修改此存档。当前游戏已暂停，请关闭并重新进入，避免覆盖进度。"
	elif result.has("error"):
		dirty = true
		error_message = str(result.error)
	else: save_revision = int(result.revision)
	save_busy = false

func _restore(state: Dictionary) -> void:
	current_level = int(state.get("level",1))
	wanted_level = int(state.get("wantedLevel",current_level))
	level_data = state.get("levelData",{})
	levels = state.get("levels",{})
	rewards = state.get("rewards",{})
	jobs = state.get("jobs",{})
	for key in jobs:
		requested[key] = true
		if jobs[key].status == "failed": error_message = str(jobs[key].get("error","创作失败。按 R 重试。"))
	content_rejection = str(state.get("contentRejection",""))
	if not content_rejection.is_empty(): error_message = content_rejection
	player_pos = _v(state.player.position)
	player_hp = float(state.player.hp)
	player_stats = state.player.stats
	attack_timer = float(state.player.get("attackTimer",0))
	dash_timer = float(state.player.get("dashTimer",0))
	dash_left = float(state.player.get("dashLeft",0))
	dash_direction = _v(state.player.get("dashDirection",[1,0]))
	invulnerable = float(state.player.get("invulnerable",0))
	enemies = state.get("enemies",[])
	bullets = state.get("bullets",[])
	selected_skills = state.get("selectedSkills",[])
	skill_chosen = bool(state.get("skillChosen",false))
	dead = bool(state.get("dead",false))
	exiting = bool(state.get("exiting",false))
	level_history = state.get("history",{})
	run_number = int(state.get("run",1))
	metrics = state.get("metrics",metrics)

func _burst(at: Vector2, color: Color, count: int) -> void:
	for i in range(count):
		var angle := float(i)*TAU/count+elapsed
		particles.append({"position":at,"velocity":Vector2.from_angle(angle)*(50+i%4*24),"life":0.25+i%3*0.1,"color":color})

func _notify(text: String) -> void:
	notice = text
	notice_timer = 3.5

func _palette() -> Dictionary:
	match str(level_data.get("theme","moss")):
		"ember": return {"floor":Color("332826"),"tile":Color("392f2b"),"wall":Color("65463a"),"cap":Color("967053"),"accent":Color("edb16d"),"muted":Color("afa08b")}
		"moon": return {"floor":Color("292d41"),"tile":Color("2f344b"),"wall":Color("484f6e"),"cap":Color("727b9b"),"accent":Color("adb9f0"),"muted":Color("a0abc5")}
		_: return {"floor":Color("25332f"),"tile":Color("2b3b34"),"wall":Color("3d5549"),"cap":Color("65806b"),"accent":Color("e1be78"),"muted":Color("9db6a6")}

func _draw() -> void:
	if font == null: return
	var p := _palette()
	draw_rect(Rect2(0,0,1152,720),Color("10171c"))
	for i in range(20):
		draw_line(Vector2(0,110+i*31),Vector2(1152,110+i*31),Color(0.12,0.17,0.17,0.16),1)
	_text(Vector2(32,39),"LANTERNFALL",22,Color("f0e4c6"))
	_text(Vector2(245,38),"灯火之下",16,Color("a8b6ac"))
	_text(Vector2(32,66),source_note,12,Color("8ea49b"))
	_text(Vector2(1048,38),"FLOOR %02d" % current_level,16,Color("e1be78"))
	if not level_data.is_empty():
		_draw_room(p)
		var actors: Array = []
		for enemy in enemies: actors.append({"y":_v(enemy.position).y,"enemy":enemy})
		for presentation in death_presentations:
			actors.append({"y":_v(presentation.enemy.position).y,"death":presentation})
		actors.append({"y":player_pos.y,"player":true})
		actors.sort_custom(func(a,b): return a.y < b.y)
		for actor in actors:
			if actor.has("player"): _draw_player()
			elif actor.has("death"):
				var pdeath: Dictionary = actor.death
				_draw_enemy(pdeath.enemy, pdeath.lifecycle.death_progress(), pdeath.lifecycle.opacity(), pdeath.direction)
			else: _draw_enemy(actor.enemy)
		for bullet in bullets:
			var at := _v(bullet.position)
			var color := Color("cf8cc4") if bullet.enemy else Color("f7d58d")
			draw_line(at-_v(bullet.velocity).normalized()*12,at,color.darkened(0.45),5)
			draw_circle(at,5 if bullet.enemy else 4,color)
			draw_circle(at,2,Color("fff3c6"))
		for particle in particles:
			var c: Color = particle.color
			c.a = clampf(float(particle.life)*3,0,1)
			draw_circle(_v(particle.position),2.5,c)
		_draw_hud(p)
	if _choosing_skill(): _draw_skills(p)
	if level_data.is_empty() or exiting:
		saw_loading = true
		_draw_overlay("AI 正在绘制下一束灯火" if not demo_mode else "正在载入演示关卡", "正根据这个世界的设定创作新的关卡。\n已完成内容和进度会保存，请稍候。",p.accent)
	elif dead:
		_draw_overlay("灯火熄灭了", "第 %d 层 · 击败 %d 名守卫\n按 R 或 Enter 重新出发。已生成关卡会直接复用。" % [current_level,int(metrics.kills)],Color("dc927f"))
	elif enemies.is_empty() and not skill_chosen and not rewards.has(str(current_level)):
		_draw_overlay("守卫已清除，祝福正在生成", "AI 将提供三个真正改变属性的候选技能。\n房间与进度已保存，请稍候。",p.accent)
	if not error_message.is_empty():
		draw_rect(Rect2(128,608,896,74),Color("3d272d"))
		_wrap(Vector2(145,629),error_message,14,Color("f3c3b6"),862,3)
	elif notice_timer > 0 and not _choosing_skill():
		_text(Vector2(128,644),notice,16,p.accent)
	else:
		_wrap(Vector2(128,635),str(level_data.get("story","每一次前行，都会留下自己的灯火。")),12,Color("99afa4"),896,2)
	_text(Vector2(128,688),"WASD 移动 · 鼠标左键攻击 · Space 闪避 · E 进入出口 · 自动保存",12,Color("718b81"))
	_text(Vector2(845,688),"SAVE %d  ·  RUN %02d" % [save_revision,run_number],12,Color("5e7770"))

func _draw_room(p: Dictionary) -> void:
	draw_rect(Rect2(ROOM.position+Vector2(-18,-10),ROOM.size+Vector2(36,34)),Color("0b1115"))
	draw_rect(Rect2(ROOM.position-Vector2(12,12),ROOM.size+Vector2(24,24)),p.wall)
	draw_rect(ROOM,p.floor)
	for y in range(8):
		for x in range(16):
			var rect := Rect2(ORIGIN+Vector2(x,y)*TILE+Vector2(1,1),Vector2(TILE-2,TILE-2))
			if (x+y)%2 == 0: draw_rect(rect,p.tile)
			if (x*13+y*7)%11 == 0:
				var at := rect.position+Vector2(12,30)
				draw_line(at,at+Vector2(9,-3),p.floor.lightened(0.08),1)
				draw_line(at+Vector2(9,-3),at+Vector2(17,0),p.floor.lightened(0.08),1)
	for wall in walls:
		draw_rect(Rect2(wall.position+Vector2(7,12),wall.size),Color(0.02,0.04,0.04,0.5))
		draw_rect(wall,p.wall.darkened(0.23))
		draw_rect(Rect2(wall.position-Vector2(0,10),Vector2(TILE,TILE-3)),p.cap)
		draw_rect(Rect2(wall.position+Vector2(5,-5),Vector2(TILE-10,TILE-13)),p.wall)
		draw_line(wall.position+Vector2(5,9),wall.position+Vector2(TILE-5,9),p.cap.darkened(0.15),2)
		if int(wall.position.x+wall.position.y)%3 == 0:
			draw_circle(wall.position+Vector2(15,-2),4,Color("87a572"))
	for x in [ROOM.position.x-6,ROOM.end.x+6]:
		for y in [ROOM.position.y+30,ROOM.end.y-25]:
			_lantern(Vector2(x,y),p.accent)
	var exit := _cell(14,4)
	var door_color: Color = Color("6dc6b2") if _exit_open() else Color("796953")
	draw_circle(exit,29,door_color.darkened(0.72))
	draw_arc(exit,26,0,TAU,40,door_color,2)
	draw_rect(Rect2(exit-Vector2(18,24),Vector2(36,48)),Color("102326"))
	draw_line(exit+Vector2(-18,24),exit+Vector2(-18,-24),door_color,4)
	draw_line(exit+Vector2(18,24),exit+Vector2(18,-24),door_color,4)
	draw_line(exit+Vector2(-18,-24),exit+Vector2(18,-24),door_color,4)
	if _exit_open():
		draw_line(exit+Vector2(-6,0),exit+Vector2(7,0),door_color,3)
		draw_line(exit+Vector2(2,-6),exit+Vector2(8,0),door_color,3)
		draw_line(exit+Vector2(2,6),exit+Vector2(8,0),door_color,3)
	else:
		for y in [-11,0,11]: draw_line(exit+Vector2(-13,y),exit+Vector2(13,y),door_color,3)
	_text(ORIGIN+Vector2(0,-31),str(level_data.get("title","")),20,Color("e8e7cf"))
	_text(ORIGIN+Vector2(896,-31),"%d 守卫" % enemies.size(),15,p.accent,100,HORIZONTAL_ALIGNMENT_RIGHT)

func _draw_player() -> void:
	draw_set_transform(player_pos)
	draw_set_transform(player_pos,0,Vector2(1,0.45))
	draw_circle(Vector2(0,15),21,Color(0,0,0,0.34))
	draw_set_transform(player_pos)
	var body := Color("8ed5cb") if player_flash <= 0 else Color("ffe3c1")
	if dead: body = Color("5f7772")
	var stride := sin(walk_clock)*2.5
	draw_rect(Rect2(-11,5+stride,8,14),Color("253c40"))
	draw_rect(Rect2(3,5-stride,8,14),Color("253c40"))
	draw_colored_polygon(PackedVector2Array([Vector2(-15,10),Vector2(-11,-10),Vector2(0,-17),Vector2(11,-10),Vector2(15,10)]),body.darkened(0.18))
	draw_circle(Vector2(0,-10),12,body)
	draw_circle(Vector2(2,-10),8,Color("1c3440"))
	draw_rect(Rect2(-2,-12,9,4),Color("e6dfb1"))
	draw_line(Vector2(0,2),aim*23,Color("c6bc91"),7)
	draw_line(aim*19,aim*30,Color("f3d083"),4)
	if invulnerable > 0 and not dead: draw_arc(Vector2.ZERO,24,0,TAU,36,Color(0.5,0.95,0.9,0.3),2)
	draw_set_transform(Vector2.ZERO)

func _draw_enemy(enemy: Dictionary, death_progress: float = 0.0, alpha: float = 1.0, fall_direction: float = 1.0) -> void:
	var at := _v(enemy.position)
	draw_set_transform(at,0,Vector2(1,0.4))
	draw_circle(Vector2(0,20),22,Color(0,0,0,0.35*alpha))
	# Recoil, loss of balance and collapse retain the actual actor silhouette.
	var collapse := smoothstep(0.15, 1.0, death_progress)
	var recoil := sin(death_progress * PI) * 8.0
	draw_set_transform(at + Vector2(fall_direction*(recoil + collapse*12), collapse*10), fall_direction*collapse*1.45, Vector2(1,1-collapse*0.15))
	var c := Color(Color("cf7568"),alpha) if enemy.kind == "chaser" else Color(Color("a58bbd"),alpha)
	if enemy.flash > 0 and death_progress <= 0: c = Color(Color("fff0c9"),alpha)
	if enemy.kind == "chaser":
		draw_colored_polygon(PackedVector2Array([Vector2(-19,8),Vector2(-16,-10),Vector2(-10,-18),Vector2(0,-13),Vector2(10,-18),Vector2(16,-10),Vector2(19,8),Vector2(9,16),Vector2(-9,16)]),c.darkened(0.25))
		draw_circle(Vector2(0,-4),14,c)
		draw_colored_polygon(PackedVector2Array([Vector2(-12,-12),Vector2(-18,-25),Vector2(-4,-16)]),Color(Color("e2be8b"),alpha))
		draw_colored_polygon(PackedVector2Array([Vector2(12,-12),Vector2(18,-25),Vector2(4,-16)]),Color(Color("e2be8b"),alpha))
		draw_line(Vector2(-9,-5),Vector2(-3,-3),Color(Color("382529"),alpha),3)
		draw_line(Vector2(3,-3),Vector2(9,-5),Color(Color("382529"),alpha),3)
	else:
		draw_colored_polygon(PackedVector2Array([Vector2(-18,17),Vector2(-12,-10),Vector2(0,-24),Vector2(12,-10),Vector2(18,17)]),c.darkened(0.25))
		draw_circle(Vector2(0,-8),13,c)
		draw_circle(Vector2(0,-7),8,Color(Color("302b43"),alpha))
		draw_circle(Vector2(0,-8),3,Color(Color("e7c4ed"),alpha))
		draw_line(Vector2(15,15),Vector2(15,-19),Color(Color("796780"),alpha),4)
		draw_circle(Vector2(15,-22),6,Color(Color("ddb1db"),alpha))
	if death_progress <= 0:
		draw_rect(Rect2(-18,-34,36,4),Color(Color("222a2d"),alpha))
		draw_rect(Rect2(-18,-34,36*maxf(0,float(enemy.hp)/float(enemy.max_hp)),4),c)
	draw_set_transform(Vector2.ZERO)

func _lantern(at: Vector2,color: Color) -> void:
	draw_circle(at,23,Color(color,0.04))
	draw_circle(at,14,Color(color,0.07))
	draw_rect(Rect2(at-Vector2(5,8),Vector2(10,16)),Color("1d292a"))
	draw_rect(Rect2(at-Vector2(3,5),Vector2(6,10)),color)
	draw_line(at+Vector2(-7,-8),at+Vector2(7,-8),Color("a79873"),2)

func _draw_hud(p: Dictionary) -> void:
	var hp_width := 235.0
	draw_rect(Rect2(480,27,hp_width,12),Color("27352f"))
	draw_rect(Rect2(480,27,hp_width*maxf(0,player_hp/float(player_stats.max_hp)),12),Color("9ac897"))
	_text(Vector2(480,60),"HP  %d / %d" % [player_hp,player_stats.max_hp],13,Color("cbd4b8"))
	_text(Vector2(753,37),"ATK %d" % player_stats.damage,16,p.accent)
	_text(Vector2(850,37),"SPD %d" % player_stats.speed,16,p.accent)
	var dash_ready := dash_timer <= 0
	_text(Vector2(753,61),"闪避就绪" if dash_ready else "闪避 %.1fs" % dash_timer,12,Color("93cbbd") if dash_ready else Color("7a8c85"))
	_text(Vector2(850,61),"祝福 %d" % selected_skills.size(),12,p.muted)

func _card_rect(index: int) -> Rect2:
	return Rect2(132+index*302,247,282,280)

func _draw_skills(p: Dictionary) -> void:
	draw_rect(Rect2(0,85,1152,555),Color(0.025,0.04,0.055,0.88))
	_text(Vector2(132,195),"拾起一份祝福",29,Color("f3e6c7"))
	_text(Vector2(132,222),"AI 创作的三个候选 · 按 1 / 2 / 3 或点击选择，效果立即生效" if not demo_mode else "手工演示候选 · 按 1 / 2 / 3 或点击选择",14,p.muted)
	for i in range(3):
		var card := _card_rect(i)
		var choice: Dictionary = rewards[str(current_level)].choices[i]
		draw_rect(card,Color("263532"))
		draw_rect(card,Color("688373"),false,1)
		draw_rect(Rect2(card.position,Vector2(card.size.x,4)),p.accent)
		draw_circle(card.position+Vector2(37,42),17,Color("344b40"))
		_text(card.position+Vector2(31,49),str(i+1),19,p.accent)
		_wrap(card.position+Vector2(20,87),str(choice.name),20,Color("eee3c7"),242,2)
		_wrap(card.position+Vector2(20,139),str(choice.description),16,Color("afc0ad"),242,5)
		_text(card.position+Vector2(20,255),_effect_text(choice),14,p.accent)

func _effect_text(choice: Dictionary) -> String:
	var amount := float(choice.amount)
	match str(choice.effect):
		"damage": return "攻击 +%d" % (4*amount)
		"vitality": return "生命上限 +%d · 同时治疗" % (12*amount)
		"haste": return "移动速度 +%d" % (14*amount)
		"rapid_fire": return "攻击频率 +%d%%" % (12*amount)
		_: return "闪避冷却 −%.2fs" % (0.12*amount)

func _draw_overlay(title: String,body: String,accent: Color) -> void:
	draw_rect(Rect2(0,85,1152,520),Color(0.025,0.04,0.055,0.83))
	draw_rect(Rect2(258,245,636,224),Color("22322f"))
	draw_rect(Rect2(258,245,636,3),accent)
	_text(Vector2(288,294),title,28,Color("f0e5cb"))
	_wrap(Vector2(288,341),body,17,Color("b5c6b5"),575,4)

func _text(at: Vector2,text: String,size: int,color: Color,width := -1.0,alignment := HORIZONTAL_ALIGNMENT_LEFT) -> void:
	draw_string(font,at,text,alignment,width,size,color)

func _wrap(at: Vector2,text: String,size: int,color: Color,width: float,lines: int) -> void:
	draw_multiline_string(font,at,text,HORIZONTAL_ALIGNMENT_LEFT,width,size,lines,color)

func _screenshot(path: String) -> bool:
	if DisplayServer.get_name() == "headless": return false
	queue_redraw()
	# Occluded macOS windows may never emit frame_post_draw. Force a single render
	# after the next process frame so an optional screenshot cannot stall gameplay.
	await get_tree().process_frame
	RenderingServer.force_draw(false)
	return get_viewport().get_texture().get_image().save_png(path) == OK

func _run_smoke() -> void:
	print("ROGUELITE_STAGE waiting-content")
	var deadline := Time.get_ticks_msec()+240000
	while (level_data.is_empty() or (not smoke_resume and not rewards.has(str(current_level)))) and Time.get_ticks_msec() < deadline:
		if not error_message.is_empty() and jobs.values().all(func(job): return job.status in ["ready","failed"]): break
		await get_tree().create_timer(0.1).timeout
	if level_data.is_empty() or (not smoke_resume and not rewards.has(str(current_level))):
		_finish_smoke({"ok":false,"error":"Initial AI content did not become ready","detail":error_message})
		return
	if smoke_resume:
		_finish_smoke({"ok":restored and current_level >= 2 and not selected_skills.is_empty(),"restored":restored,"level":current_level,"hp":player_hp,"enemyCount":enemies.size(),"enemies":_json_value(enemies),"skills":selected_skills,"stats":player_stats,"playerPosition":[player_pos.x,player_pos.y]})
		return
	var report := {"ok":false,"native_2d":true,"source":"explicit-demo" if demo_mode else "host-generated","initial_enemies":enemies.size(),"prefetch_requested":requested.has(_key("level",2))}
	print("ROGUELITE_STAGE passive-combat")
	# First stand still. Real chaser contact / shooter projectiles must cause death.
	for frame in range(5400):
		_simulate(1.0/60.0,Vector2.ZERO,false)
		if frame%8 == 0: await get_tree().process_frame
		if dead: break
	report["combat_death"] = dead and metrics.contact_hits+metrics.projectile_hits > 0
	if not dead:
		_finish_smoke(report.merged({"error":"Enemies did not kill a passive player"}))
		return
	_restart()
	print("ROGUELITE_STAGE restart-and-active-combat")
	report["restart"] = not dead and is_equal_approx(player_hp,float(BASE_STATS.max_hp)) and enemies.size() == int(report.initial_enemies)
	var dash_start := player_pos
	aim = Vector2.RIGHT
	_dash()
	for frame in range(10): _simulate(1.0/60.0,Vector2.ZERO,false)
	report["dash_moved"] = player_pos.distance_to(dash_start) > 70 and dash_timer > 0
	# Drive the exact movement, dash, aim and projectile simulation used by input.
	for frame in range(10800):
		if dead or enemies.is_empty(): break
		var target: Dictionary = enemies[0]
		var nearest := INF
		for enemy in enemies:
			var distance := player_pos.distance_to(_v(enemy.position))
			if distance < nearest: nearest = distance; target = enemy
		var at := _v(target.position)
		aim = (at-player_pos).normalized()
		var input := Vector2.ZERO
		if not _line_clear(player_pos,at): input = _path_direction(player_pos,at)
		elif nearest > 235: input = aim
		elif nearest < 145: input = -aim
		if dash_timer <= 0 and nearest < 100:
			aim = -aim
			_dash()
			aim = (at-player_pos).normalized()
		_simulate(1.0/60.0,input,true)
		if frame%6 == 0: await get_tree().process_frame
	report["real_hits"] = int(metrics.hits)
	report["real_kills"] = int(metrics.kills)
	report["cleared"] = enemies.is_empty() and not dead
	if dead or not enemies.is_empty():
		_finish_smoke(report.merged({"error":"Autoplay failed to clear the room","metrics":metrics}))
		return
	# Wait for genuine generated choices, then exercise the same selection handler.
	while not _choosing_skill() and Time.get_ticks_msec() < deadline:
		# Smoke mode owns the simulation clock, including post-combat presentation.
		_simulate(0.1,Vector2.ZERO,false)
		await get_tree().create_timer(0.1).timeout
	if not _choosing_skill():
		_finish_smoke(report.merged({"error":"AI skill choices unavailable","detail":error_message}))
		return
	print("ROGUELITE_STAGE skills-screenshot")
	if not screenshot_path.is_empty(): await _screenshot(screenshot_path.get_basename()+"-skills.png")
	print("ROGUELITE_STAGE choose-skill-and-exit")
	var before: Dictionary = player_stats.duplicate()
	_choose_skill(0)
	report["skill_applied"] = before != player_stats and selected_skills.size() == 1
	report["exit_unlocked"] = _exit_open()
	# Walk through the real exit trigger. There is no direct level variable assignment.
	for frame in range(3600):
		if current_level == 2 or exiting: break
		var direction := _path_direction(player_pos,_cell(14,4))
		_simulate(1.0/60.0,direction,false)
		if frame%6 == 0: await get_tree().process_frame
	while current_level != 2 and Time.get_ticks_msec() < deadline:
		await get_tree().create_timer(0.1).timeout
	report["entered_second_level"] = current_level == 2 and not enemies.is_empty()
	print("ROGUELITE_STAGE second-level-combat")
	# Leave an actual moving, partially damaged encounter to prove exact restoration.
	var level_two_hits := int(metrics.hits)
	for frame in range(240):
		if enemies.is_empty() or int(metrics.hits) > level_two_hits: break
		var target := _v(enemies[0].position)
		aim = (target-player_pos).normalized()
		_simulate(1.0/60.0,_path_direction(player_pos,target),true)
		if frame%6 == 0: await get_tree().process_frame
	report["second_level_combat_saved"] = int(metrics.hits) > level_two_hits
	var save_deadline := Time.get_ticks_msec()+10000
	while save_busy and Time.get_ticks_msec() < save_deadline: await get_tree().process_frame
	if save_busy:
		_finish_smoke(report.merged({"error":"Save request did not complete within 10 seconds"}))
		return
	await _flush_save()
	report["saved"] = save_revision > 0 and not save_conflict
	report["metrics"] = metrics
	report["stats"] = player_stats
	report["ok"] = report.combat_death and report.restart and report.dash_moved and report.cleared and report.skill_applied and report.exit_unlocked and report.entered_second_level and report.second_level_combat_saved and report.saved and report.real_hits > 0
	if not screenshot_path.is_empty(): report["screenshot"] = await _screenshot(screenshot_path)
	print("ROGUELITE_STAGE complete")
	_finish_smoke(report)

func _finish_smoke(report: Dictionary) -> void:
	print("OPENFUN_ROGUELITE_SMOKE "+JSON.stringify(report))
	get_tree().quit(0 if report.get("ok",false) else 1)

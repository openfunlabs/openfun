extends RefCounted
## This is one editable game's vocabulary, not an Openfun engine restriction.

static func level_schema() -> Dictionary:
	var wall := {"type":"object","properties":{"x":{"type":"integer","minimum":2,"maximum":13},"y":{"type":"integer","enum":[1,2,5,6]}},"required":["x","y"],"additionalProperties":false}
	var enemy := {"type":"object","properties":{
		"id":{"type":"string","minLength":1,"maxLength":40},"kind":{"type":"string","enum":["chaser","shooter"]},
		"x":{"type":"integer","minimum":4,"maximum":13},"y":{"type":"integer","minimum":1,"maximum":6},
		"hp":{"type":"integer","minimum":22,"maximum":90},"speed":{"type":"integer","minimum":48,"maximum":110},
		"damage":{"type":"integer","minimum":5,"maximum":14},"cooldown":{"type":"number","minimum":1.0,"maximum":2.8}},
		"required":["id","kind","x","y","hp","speed","damage","cooldown"],"additionalProperties":false}
	return {"type":"object","properties":{
		"title":{"type":"string","minLength":1,"maxLength":32},"story":{"type":"string","minLength":1,"maxLength":140},
		"theme":{"type":"string","enum":["moss","ember","moon"]},"walls":{"type":"array","items":wall,"minItems":3,"maxItems":16},
		"enemies":{"type":"array","items":enemy,"minItems":3,"maxItems":7}},
		"required":["title","story","theme","walls","enemies"],"additionalProperties":false}

static func skill_schema() -> Dictionary:
	return {"type":"object","properties":{"choices":{"type":"array","minItems":3,"maxItems":3,"items":{
		"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":32},
		"name":{"type":"string","minLength":1,"maxLength":16},"description":{"type":"string","minLength":1,"maxLength":70},
		"effect":{"type":"string","enum":["damage","vitality","haste","rapid_fire","evasion"]},
		"amount":{"type":"integer","minimum":1,"maximum":3}},
		"required":["id","name","description","effect","amount"],"additionalProperties":false}}},
		"required":["choices"],"additionalProperties":false}

static func prompt(kind: String, index: int) -> String:
	if kind == "level":
		return "Create floor %d of Lanternfall, a playable top-down 2D roguelite, using this world's design documents. Return only the requested JSON. The arena is a 16 by 8 grid. Player starts at (1,4); exit is at (14,4). Keep rows 3 and 4 free of walls so combat and exit remain connected. Walls must be unique cells; enemies must occupy unique, non-wall cells and include at least one chaser and one shooter. Prefer readable tactical cover and 3-5 enemies, not overcrowding. Give the room a distinctive title and story matching the world. Health 22-60 is recommended. Theme controls presentation only." % index
	return "Create exactly three different skill rewards for floor %d of Lanternfall, based on the world documents. Each choice needs a distinct id AND effect. Give short evocative names and honest descriptions matching actual effects: damage adds 4*amount attack damage; vitality adds and heals 12*amount HP; haste adds 14*amount movement speed; rapid_fire reduces the attack interval by factor 1/(1+0.12*amount); evasion reduces dash cooldown by 0.12*amount seconds (minimum 0.25). Amount must be 1-3. The three choices should offer meaningful different play styles. Return only the requested JSON." % index

static func validate_level(data: Dictionary) -> String:
	if not data.get("walls") is Array or not data.get("enemies") is Array:
		return "关卡缺少墙体或敌人数组。"
	if data.enemies.size() < 3 or data.enemies.size() > 7:
		return "关卡敌人数量必须为 3–7。"
	var occupied := {}
	var blocked := {}
	for wall in data.walls:
		if not wall is Dictionary or not wall.has("x") or not wall.has("y"):
			return "墙体格式无效。"
		if wall.x < 2 or wall.x > 13 or not int(wall.y) in [1,2,5,6]:
			return "墙体阻挡了保留的战斗与出口通道。"
		var key := "%s,%s" % [wall.x,wall.y]
		if occupied.has(key): return "墙体重叠。"
		occupied[key] = true
		blocked[Vector2i(int(wall.x),int(wall.y))] = true
	var ids := {}
	var kinds := {}
	for enemy in data.enemies:
		if not enemy is Dictionary: return "敌人格式无效。"
		for field in ["id","kind","x","y","hp","speed","damage","cooldown"]:
			if not enemy.has(field): return "敌人定义不完整。"
		var key := "%s,%s" % [enemy.x,enemy.y]
		if occupied.has(key) or ids.has(str(enemy.id)): return "敌人重叠或身份重复。"
		if enemy.x < 4 or enemy.x > 13 or enemy.y < 1 or enemy.y > 6: return "敌人超出了可玩区域。"
		if not str(enemy.kind) in ["chaser","shooter"]: return "敌人行为不受此示例支持。"
		if enemy.hp < 22 or enemy.hp > 90 or enemy.speed < 48 or enemy.speed > 110 or enemy.damage < 5 or enemy.damage > 14 or enemy.cooldown < 1 or enemy.cooldown > 2.8: return "敌人属性超出此示例的可玩范围。"
		occupied[key] = true
		ids[str(enemy.id)] = true
		kinds[str(enemy.kind)] = true
	if not kinds.has("chaser") or not kinds.has("shooter"): return "关卡必须同时包含追击与远程敌人。"
	# Reserved rows guarantee an exit path, but authored walls can still enclose an enemy.
	var queue: Array[Vector2i] = [Vector2i(1,4)]
	var reachable := {Vector2i(1,4):true}
	var cursor := 0
	while cursor < queue.size():
		var at := queue[cursor]
		cursor += 1
		for direction in [Vector2i.LEFT,Vector2i.RIGHT,Vector2i.UP,Vector2i.DOWN]:
			var next: Vector2i = at+direction
			if next.x < 0 or next.x > 15 or next.y < 0 or next.y > 7 or blocked.has(next) or reachable.has(next): continue
			reachable[next] = true
			queue.append(next)
	for enemy in data.enemies:
		if not reachable.has(Vector2i(int(enemy.x),int(enemy.y))): return "敌人被墙封闭，无法完成清关。"
	return ""

static func validate_skills(data: Dictionary) -> String:
	if not data.get("choices") is Array or data.choices.size() != 3: return "技能必须有三个候选。"
	var ids := {}
	var effects := {}
	for choice in data.choices:
		if not choice is Dictionary: return "技能格式无效。"
		for field in ["id","name","description","effect","amount"]:
			if not choice.has(field): return "技能定义不完整。"
		if ids.has(str(choice.id)) or effects.has(str(choice.effect)): return "三个候选必须有不同的身份和效果。"
		if not str(choice.effect) in ["damage","vitality","haste","rapid_fire","evasion"] or choice.amount < 1 or choice.amount > 3: return "技能效果超出此示例能力。"
		ids[str(choice.id)] = true
		effects[str(choice.effect)] = true
	return ""

static func demo_level(index: int) -> Dictionary:
	# Authored fixtures are used exclusively when the user explicitly chooses demo.
	return {"title":"灯塔下的回廊 %d" % index,"story":"演示关卡：清除守卫，选择祝福，前往下一层。","theme":["moss","ember","moon"][(index-1)%3],
		"walls":[{"x":5,"y":2},{"x":6,"y":2},{"x":10,"y":5},{"x":11,"y":5}],
		"enemies":[{"id":"hunter","kind":"chaser","x":7,"y":3,"hp":34,"speed":70,"damage":8,"cooldown":1.1},
		{"id":"sentinel","kind":"shooter","x":12,"y":2,"hp":30,"speed":58,"damage":7,"cooldown":1.7},
		{"id":"brute","kind":"chaser","x":10,"y":6,"hp":42,"speed":64,"damage":10,"cooldown":1.4}]}

static func demo_skills() -> Dictionary:
	return {"choices":[{"id":"ember","name":"余烬之牙","description":"攻击伤害提高 8。","effect":"damage","amount":2},
		{"id":"bloom","name":"苔石之心","description":"生命上限提高 24，并恢复同等生命。","effect":"vitality","amount":2},
		{"id":"wind","name":"夜行者","description":"移动速度提高 28。","effect":"haste","amount":2}]}

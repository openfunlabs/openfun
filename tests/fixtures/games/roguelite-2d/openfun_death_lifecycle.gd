extends RefCounted
## Presentation lifecycle shared by sprite, cutout and skeletal characters.
## The game owns damage/loot/save state and the actual animation assets.
signal defeated
signal presentation_finished

enum Phase { ALIVE, DYING, HOLDING, FADING, FINISHED }
var phase: Phase = Phase.ALIVE
var age := 0.0
var death_seconds := 0.55
var hold_seconds := 0.45
var fade_seconds := 0.3

func begin() -> bool:
	if phase != Phase.ALIVE: return false
	phase = Phase.DYING
	age = 0.0
	# Disable AI/hitboxes and commit a stable death/reward ID here, once.
	defeated.emit()
	return true

func advance(delta: float) -> void:
	if phase in [Phase.ALIVE, Phase.FINISHED] or not is_finite(delta) or delta <= 0: return
	age += delta
	var death_end := maxf(death_seconds, 0.01)
	var hold_end := death_end + maxf(hold_seconds, 0.0)
	var fade_end := hold_end + maxf(fade_seconds, 0.01)
	if age >= fade_end:
		phase = Phase.FINISHED
		presentation_finished.emit()
	elif age >= hold_end:
		phase = Phase.FADING
	elif age >= death_end:
		phase = Phase.HOLDING

func death_progress() -> float:
	return clampf(age / maxf(death_seconds, 0.01), 0.0, 1.0)

func opacity() -> float:
	if phase == Phase.FINISHED: return 0.0
	var fade_start := maxf(death_seconds, 0.01) + maxf(hold_seconds, 0.0)
	return 1.0 - clampf((age - fade_start) / maxf(fade_seconds, 0.01), 0.0, 1.0)

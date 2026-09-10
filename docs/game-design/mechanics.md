# Designing a loop worth continuing

Use when creating a game or expanding progression. Begin with the desired player experience and observable decisions, not a list of features or an ever-increasing enemy HP number.

## A small design experiment

State a hypothesis: “The player must choose between committing to a heavy strike and preserving an escape route.” Define what the player sees, their options, the opportunity cost, consequence and feedback. Implement a short complete encounter that tests this hypothesis before expanding content. Two situationally useful options are more interesting than ten differently named versions of one option.

For each major mechanic, write one interaction with another system: enemy tells versus movement, terrain versus range, resource scarcity versus a tempting reward, or story information versus commitment. Preserve a coherent identity; do not add crafting, skill trees and quests simply because games often have them. A peaceful exploration game may rely on discovery and interpretation rather than combat or punishment.

Use two relevant reference games when useful. Research first-party talks or development notes with available web tools, extracting a specific principle and how it fits THIS game. Explain one aspect you deliberately change. Without online access, use the bundled sources and label unverified recollections. Do not claim a famous game's design guarantees yours is fun.

[Into the Breach's design postmortem](https://www.gdcvault.com/play/1025772/-Into-the-Breach-Design) discusses iteration, cuts, difficulty and randomness. [Slay the Spire's balance talk](https://www.gdcvault.com/play/1025731/-Slay-the-Spire-Metrics%EF%BB%BF) describes using play data in development. They support testing and revising a focused design rather than treating the first generated rules as finished.

## Continuing AI content

Preserve stable executable mechanics; generated content arranges valid encounters, choices, rewards and consequences. Supply recent player choices, difficulty, unused combinations and narrative consequences to future jobs. Curate a vocabulary that contains genuinely different roles and costs. Keep difficulty growth bounded and avoid purely cosmetic variations. Test combinations for unreachable goals, unwinnable resource requirements and dominant strategies.

Alternate pressure, learning, recovery and payoff where appropriate. Future jobs should respect these pacing decisions, not generate arbitrary harder rooms forever. Keep a polished authored starting area and prefetch while it is played. On failure, preserve the current game and show a recoverable wait state; never silently manufacture fake AI results.

## Playtest

Run a first-time-player route with controls visible, then a deliberately adversarial route: repeat the strongest action, avoid rewards, spend all resources, lose, retry and reload. Record concrete observations: time to understand the goal, idle travel, repeat choices, deaths and their cause. Fix the largest source of confusion or boredom and replay the same route. Human feedback is needed to assess enjoyment; a bot winning or a test passing is not a fun score. Keep notes concise and don't require a questionnaire.

## Further reading

Jesse Schell's [The Art of Game Design](https://schellgames.com/art-of-game-design) uses different lenses to evaluate a game. It is optional deeper reading, not a redistributed knowledge base. This guide contains OpenFun's own workflow; no book chapters or talk transcripts are included.

## Richness that serves the core appeal

Identify what remains enjoyable after the first encounter: anticipation, positioning, execution, inference, planning, expression, discovery or another game-specific experience. State this in ordinary design notes. A new object earns its place through a changed decision or interaction; content counts do not establish depth. A peaceful mystery can deepen through information and trust without adding combat. A combat game can deepen through range, commitment and terrain without adding another weapon category.

Audit the implementation before expanding the map. For each meaningful variation, identify the actual behavior, readable cue, player response, opportunity cost, outcome and state/data fields. If the schema only allows names, palette, enemy count and HP, the runtime cannot produce a new decision merely by asking the model harder. During creation, implement reusable behavior interfaces and compatible interactions appropriate to this game's identity. Do not build a universal system or a checklist of enemy/weapon types for every game.

Make the first delivered version demonstrate development beyond its opening: an established action in a changed context, a situational alternative, a consequence or payoff. These are reasons to play, not mandatory stage counts or a fixed sequence. Existing three-unit continuation checks test wiring and variation; they do not certify depth. A later unit must be judged in relation to what the player has already learned, chosen and accomplished.

Use observed play context where available: available actions/build, actions used, outcomes, repeated situations and unresolved consequences. Interpret it cautiously. Repeating a tactic may mean enjoyment, habit or lack of alternatives, not necessarily boredom. Avoid opaque difficulty manipulation or nullifying an earned build. Introduce fair counterplay or a meaningful tradeoff, preserve opportunities to enjoy mastery, and allow recovery and resolution. Do not inject novelty into every room.

For each important refinement, replay the formerly dominant tactic and a plausible alternative in a later situation. Record why their relative usefulness changed and whether cues remain readable. Remove additions that create chores, confusion or redundancy. A successful automated route verifies behavior, not enjoyment; human play feedback is still needed. Prefer a coherent, rewarding limited sequence over an endless sequence of empty encounters.

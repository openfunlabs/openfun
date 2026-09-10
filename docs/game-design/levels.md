# Levels and content that develop

Use for maps, stages, encounter sequences and exploration routes in any presentation style. Start from a specific player decision and spatial purpose, then choose a coherent asset kit. A visually different room with the same objective and strategy is weak novelty.

Describe entry, visible goal, routes, landmarks, hazards, optional risk/reward and exit or resolution. Introduce a mechanic safely, vary its context, combine it with an established mechanic and offer recovery or payoff. Adapt this rhythm to the genre; peaceful discovery need not introduce combat. Avoid adding systems only because a reference game has them.

Find a relevant reference through world_search_design_references and read it before adopting an idea. [Game Design Concepts](https://gamedesignconcepts.wordpress.com/2009/07/13/level-5-mechanics-and-dynamics/) helps connect rule changes with player behavior; [Red Blob Games](https://www.redblobgames.com/maps/mapgen2/) offers spatial and terrain references. Geometry algorithms can inform constraints and validation, but must not replace OpenFun's AI-authored continuation with procedural filler.

Keep a vocabulary of meaningful encounter roles, goals, routes and consequences in design/runtime.md. Use stable imported asset IDs and reuse the kit across future content. Specify what can evolve: access, ownership, character relationships, available strategies or an unresolved objective. Preserve existing geometry/state when revisiting. Prefetched content is not played content; bind consequences at activation or regenerate an obsolete proposal deliberately.

Validate connectivity from entry to objective and exit, navigable clearance, spawn safety, required keys/resources, optional routes and difficulty/reward bounds. Test short-range and long-range strategies, avoiding a reward, losing a resource and returning after completion. Check that the camera reveals information the player needs. Profile a representative dense room and loading/activation, not just an empty map.

For three successive units, record the new decision, changed layout/encounter and consequence carried forward. If these remain the same, revise the content grammar or context rather than merely renaming rooms or raising enemy HP. Run actual gameplay and state checks; a map screenshot cannot prove reachability, pacing, novelty or enjoyment.

## Depth before novelty

Before adding an encounter, ask which existing player decision it deepens and why it fits the current pacing. Reuse a familiar setting if it provides a satisfying payoff or room to master an interaction. Do not mechanically rotate enemy/weapon types or introduce a new system at every stage. Test the formerly strongest tactic and a situational alternative; fair changes to space, information, objectives or combinations can create depth without adding an asset. If the game cannot express the planned interaction, extend its authoring-time behavior/schema rather than disguising the same encounter with new labels.

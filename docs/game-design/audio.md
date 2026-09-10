# Music and sound for playable worlds

For a new game, search and select music deliberately alongside visual art. Start with `world_search_assets source=opengameart kind=music` using English mood, setting or genre words. Use `world_asset_info` then `world_download_asset` with a returned individual file variant. The native adapter searches public pages, not an official API; it verifies CC0 on each entry and supports bounded OGG/MP3/WAV files, not ZIP-only albums. Source receipts travel with the game. Search sound effects separately via Kenney audio. A click sound is not background music.

## Sources and rights

- [OpenGameArt music](https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=12): native CC0 music search/download. Other tracks on the site can have different licenses; do not generalize CC0 to the whole site.
- [Incompetech](https://incompetech.com/music/royalty-free/music.html): additional browser research source, not a native API integration. Its [free licensing route](https://incompetech.com/music/royalty-free/licenses/) requires credit. Preserve each selected track's actual credit/license and verify sharing terms before importing it into an editable world.
- [itch.io music assets](https://itch.io/game-assets/tag-music): optional browser discovery; individual creators and packs have different licenses. No automated purchase, subscription integration or redistribution assumption.

Do not introduce a music-generation provider in this version. Do not fake sourced music with script-synthesized tones. Silence can serve the game's pacing or user preference; record why rather than omitting music by accident. Respect explicit no-audio requirements.

## Select and implement

Audition the actual file before selecting: mood, energy, melodic density, speech masking and fatigue matter more than keyword match. Listen through a loop seam; a music tag does not prove seamless looping. Record title, creator, source/license, local path, gameplay use and any edits in design/audio.md. Use an intentionally small coherent set, not one download per generated island.

Use AudioStreamPlayer and separate Music/SFX buses with volume and mute controls. Import at a sensible size; use streaming compressed OGG/MP3 for long tracks. WAV loop metadata and OGG loop flags/offsets must be explicitly checked. Crossfade on meaningful game-state changes, not every frame or area boundary. Stop duplicate players, avoid abrupt restarts on pause/reload, and keep dialogue and important cues intelligible. AI continuation can choose from a preloaded vocabulary of music IDs; do not put searching/downloading/decoding in the render loop or assume the runtime downloads new tracks.

## Verify

Play opening, exploration, a transition, pause/resume and mute. Check bus levels and overlapping streams; audition before claiming the mix sounds good. Decode/import success or nonzero captured audio proves only that a signal exists. If listening is unavailable, label subjective audio quality unverified. Test repeated transitions, missing tracks and loop boundaries; keep music failure from blocking gameplay. Include sources in credits and the shared package.

[Godot audio streams](https://docs.godotengine.org/en/stable/tutorials/audio/audio_streams.html) and [audio buses](https://docs.godotengine.org/en/stable/tutorials/audio/audio_buses.html) describe the native playback/mixing model.

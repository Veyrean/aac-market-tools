# AACMT Pack Export (in-game addon)

A small, read-only ArcheAge Classic addon that exports trade pack data straight from the
game client, using only the official Addon API. It answers one question: does the game
itself tell us what every pack pays at every destination?

For every route (production zone → destination) it stores what the game returns:
the packs that can be delivered, their item information and the current demand %.

- No network requests, no automation of gameplay, no character or account data.
- Writes one file: `Documents/AAClassic/Addon/aacmt_pack_export/export.txt`.

## Install

1. Copy the `aacmt_pack_export` folder into your addons folder (`Documents/AAClassic/Addon/`, called `addons` on some installs).
2. Add a line `aacmt_pack_export` to `Documents/AAClassic/Addon/addons.txt`.
3. Start the game (or `/reload`), then type **`/packexport`** in chat.
4. Wait for the "Done" message (about one second per route; you can keep playing).
   `/packexport stop` cancels.
5. Send `export.txt` to the maintainer, then remove the addon again if you like.

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
2. Add a line `aacmt_pack_export` to the `addons.txt` file in that folder.
3. Start the game and log in with any character. About 15 seconds later the export starts by
   itself and takes a few minutes (about one second per route). You can keep playing.
4. Check `aacmt_pack_export/status.txt`: `loaded` means the game picked up the addon,
   `running` shows progress, `done` means finished.
5. Send `aacmt_pack_export/export.txt` to the maintainer, then remove the addon again if you like.

It runs only once: if a finished `export.txt` exists it does nothing. Delete `export.txt`
to export again (e.g. after a patch). Where chat commands work, `/packexport` and
`/packexport stop` are also available.

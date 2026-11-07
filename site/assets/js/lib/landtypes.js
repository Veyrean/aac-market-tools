// Property type groups for My Setup → Land. The types themselves (size, base tax, seedbeds, pens)
// come from data/land.json, a snapshot of the game's building design descriptions.

/** Display order of the property type groups. */
export const LAND_GROUPS = ['Farms', 'Farmhouses', 'Houses', 'Aquafarms & marine', 'Private workstations'];

/** Labels used by earlier versions of the Land tab. */
export const LEGACY_LAND_TYPES = {
  'Scarecrow Garden (8x8)': 'Scarecrow Garden',
  'Scarecrow Farm (16x16)': 'Scarecrow Farm',
  'Tradesman Manor': "Tradesman's Manor",
};

/** '1 d 2 h' style text for a number of hours. */
export function duration(h) {
  const m = Math.round(h * 60), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d && `${d} d`, hh && `${hh} h`, mm && `${mm} m`].filter(Boolean).join(' ') || '0 m';
}

// Which continent each trade-pack zone is on. No DOM access.
// Every zone in the trade-pack data was confirmed one by one by a player (19 Nov 2026); Mistmerrow and
// Reedwind (no packs) come from the AAClassic wiki's Auroria page.

export const CONTINENTS = {
  Nuia: ['Ahnimar', 'Airain Rock', 'Aubre Cradle', 'Cinderstone Moor', 'Dewstone Plains', 'Gweonid Forest', 'Halcyona', 'Hellswamp',
    'Karkasse Ridgelands', 'Lilyut Hills', 'Marianople', 'Sanddeep', 'Solzreed Peninsula', 'Two Crowns', 'White Arden'],
  Haranya: ['Arcum Iris', 'Falcorth Plains', 'Hasla', 'Mahadevi', 'Perinoor Ruins', 'Rokhala Mountains', 'Rookborne Basin',
    'Silent Forest', 'Solis Headlands', 'Sunbite Wilds', 'Tigerspine Mountains', 'Villanelle', 'Windscour Savannah', 'Ynystere'],
  Auroria: ['Calmlands', 'Diamond Shores', 'Exeloch', 'Golden Ruins', 'Heedmar', 'Marcala', 'Mistmerrow', 'Nuimari', 'Reedwind',
    'Sungold Fields', 'Whalesong Harbor'],
};
export const FACTIONS = ['Nuia', 'Haranya'];
/** Turn-ins out at sea or on islands (no continent). */
export const SEA_ZONES = new Set(['Freedich Island', 'Sunspeck Sea']);

const byZone = new Map(Object.entries(CONTINENTS).flatMap(([c, zones]) => zones.map((z) => [z, c])));

/** 'Nuia' | 'Haranya' | 'Auroria' | 'Sea' | null (unknown zone) */
export const continentOf = (zone) => byZone.get(zone) ?? (SEA_ZONES.has(zone) ? 'Sea' : null);

/**
 * Kind of delivery for a pack made in `from` and turned in at `to`, seen from the player's continent:
 * 'home' (same continent), 'cross' (the other continent), 'auroria', 'sea' (Freedich, Sunspeck Sea) or null (unknown).
 */
export function deliveryKind(from, to) {
  const a = continentOf(from), b = continentOf(to);
  if (b === 'Sea') return 'sea';
  if (b === 'Auroria') return 'auroria';
  if (!a || !b) return null;
  return a === b ? 'home' : 'cross';
}

export const DELIVERY_LABEL = { home: 'home continent', cross: 'cross-continent', auroria: 'Auroria', sea: 'at sea' };

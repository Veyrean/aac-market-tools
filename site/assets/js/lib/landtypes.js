// Property types for My Setup → Land, from the game's building designs (aa-classic.com item data,
// category "Buildings"). Variants of the same house (Porch, Sunroom, Balcony…) and the Haranyan
// versions of private workstations are folded into one entry. The type is only a label.

const housesBase = [
  'Amethyst Solarium', "Apothecary's Chalet", "Apothecary's Manor", "Apothecary's Townhouse", "Apothecary's Villa",
  "Armorer's Chalet", "Armorer's Manor", "Armorer's Townhouse", "Armorer's Villa",
  'Aspen Treehouse', 'Beanstalk House', 'Birch Treehouse', 'Breezy Bungalow', 'Cherry Treehouse', 'Desserted Cottage',
  'Forest Mushroom House', 'Freezing Cold Icehouse', 'Little Witch Pinnacled House', "Little Witch's House",
  'Midnight Swept-Roof Mansion', 'Oak Treehouse', 'Raised Mushroom House', 'Raised Rose Cottage', 'Raised Slate Cottage',
  'Raised Spring Cottage', 'Raised Swept-Roof Chalet', 'Raised Swept-Roof Cottage', 'Rose Quartz Solarium', 'Ruby Solarium',
  'Rustic Rose Chalet', 'Rustic Rose Cottage', 'Rustic Rose Manor', 'Rustic Rose Townhouse', 'Rustic Rose Villa',
  'Rustic Slate Chalet', 'Rustic Slate Cottage', 'Rustic Slate Manor', 'Rustic Slate Townhouse', 'Rustic Slate Villa',
  'Rustic Spring Chalet', 'Rustic Spring Cottage', 'Rustic Spring Manor', 'Rustic Spring Townhouse', 'Rustic Spring Villa',
  'Sapphire Solarium', 'Spired Chateau', 'Spring Swept-Roof Mansion',
  'Stone Rose Cottage', 'Stone Rose Manor', 'Stone Rose Mansion', 'Stone Rose Townhouse', 'Stone Rose Villa',
  'Stone Slate Chalet', 'Stone Slate Cottage', 'Stone Slate Manor', 'Stone Slate Mansion', 'Stone Slate Townhouse', 'Stone Slate Villa',
  'Stone Spring Chalet', 'Stone Spring Cottage', 'Stone Spring Manor', 'Stone Spring Mansion', 'Stone Spring Townhouse', 'Stone Spring Villa',
  'Swept-Roof Cottage', 'Swept-Roof Manor', 'Tidal Bungalow',
  "Tradesman's Chalet", "Tradesman's Manor", "Tradesman's Townhouse", "Tradesman's Villa",
  'Tudor Rose Chalet', 'Tudor Rose Cottage', 'Tudor Rose Manor', 'Tudor Rose Townhouse', 'Tudor Rose Villa', 'Vintage Tudor Rose Villa',
  'Tudor Slate Chalet', 'Tudor Slate Cottage', 'Tudor Slate Manor', 'Tudor Slate Townhouse', 'Tudor Slate Villa',
  'Tudor Spring Chalet', 'Tudor Spring Cottage', 'Tudor Spring Manor', 'Tudor Spring Townhouse', 'Tudor Spring Villa',
  'Winter Maiden Cottage', "Winter Maiden's Cozy House",
];

/** [group label, [type…]] */
export const LAND_TYPE_GROUPS = [
  ['Farms', [
    'Scarecrow Garden', 'Lunar Scarecrow Garden', 'Solar Scarecrow Garden', 'Stellar Scarecrow Garden',
    'Scarecrow Farm', 'Improved Scarecrow Farm', 'Lunar Scarecrow Farm', 'Solar Scarecrow Farm', 'Stellar Scarecrow Farm', 'Eggyweggy Scarecrow Farm',
    'Gazebo Farm', 'Lunar Pavilion Farm', 'Solar Pavilion Farm', 'Stellar Pavilion Farm',
    'Improved Lunar Pavilion Farm', 'Improved Solar Pavilion Farm', 'Improved Stellar Pavilion Farm',
    'Aquafarm', 'Storage Silo',
  ]],
  ['Farmhouses', ["Harvester's Bungalow", "Harvester's Farmhouse", "Miner's Farmhouse", "Rancher's Farmhouse", 'Thatched Farmhouse']],
  ['Houses', housesBase],
  ['Private workstations', ['Private Leatherwork Table', 'Private Loom', 'Private Masonry Table', 'Private Sawmill', 'Private Smelter']],
  ['Other', ['Public land (no tax)', 'Other']],
];

export const LAND_TYPES = LAND_TYPE_GROUPS.flatMap(([, list]) => list);

/** Labels used by earlier versions of the Land tab. */
export const LEGACY_LAND_TYPES = {
  'Scarecrow Garden (8x8)': 'Scarecrow Garden',
  'Scarecrow Farm (16x16)': 'Scarecrow Farm',
  'Tradesman Manor': "Tradesman's Manor",
};

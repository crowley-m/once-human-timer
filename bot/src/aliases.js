// Distinctive words for each zone — the part that says WHICH place it is.
// Do NOT put "elite" / "red" / "blue" / "card" here; those are handled
// separately as qualifiers that pick between same-place siblings.
// Add spellings here whenever the bot reacts ❓ to something it should catch.
export const ALIASES = {
  // --- red card rooms ------------------------------------------------------
  'Furnace Lair': ['furnace', 'furnace lair'],
  'Gaia Research Center Ruins': ['gaia', 'gaia research'],
  'Ricci Securement Point': ['ricci'],
  'Forsaken Monolith': ['forsaken', 'forsaken monolith'],

  // --- elites -----------------------------------------------------------
  'Furnace Lair — Elite (Pornis)': ['furnace', 'furnace lair', 'pornis'],
  'Forsaken Monolith — Elite': ['forsaken', 'forsaken monolith'],
  'Blackfell Oil Fields': ['blackfell oil', 'oil fields', 'oilfields', 'blackfell'],
  'Fort Eyrie': ['fort eyrie', 'eyrie', 'fort'],
  'Alpha Institute': ['alpha', 'alpha institute'],
  'Railway Junction': ['railway', 'railway junction', 'railwi', 'railway jct'],
  'Rotten Saddle': ['rotten', 'rotten saddle'],
  'Sunbury Middle School': ['sunbury', 'sunburi', 'sanbori', 'sunbury middle', 'sunbury school'],

  // --- blue card rooms -------------------------------------------------
  'Evergreen Vineyard': ['vineyard', 'evergreen', 'evergreen vineyard'],
  'Hearst Industries': ['hearst', 'hearst industries'],
  'Greywater Industrial Zone': ['greywater', 'grey water', 'greywater industrial'],
  'Mirage Monolith Exclusion Zone': ['mirage', 'mirage monolith'],
  'Blackfell Fallen Zone': ['blackfell fallen', 'fallen zone', 'fallen', 'bf', 'blackfell'],
};

// Words that mean "it's available right now" instead of a clock time.
export const OPEN_WORDS = ['open', 'up now', 'available', 'spawned', 'active'];

// Qualifier words -> which zone type they point at (for sibling disambiguation).
export const QUALIFIER_TYPE = {
  elite: 'elite', mob: 'elite', boss: 'elite',
  red: 'red_card', card: 'red_card', rc: 'red_card', room: 'red_card',
  blue: 'blue',
};

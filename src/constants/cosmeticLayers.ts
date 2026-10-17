// Which cosmetics draw extra layers inside the row, and which piece of
// effectMarkup each one uses. An id missing here renders the classic way
// (a color, a class on the row, or nothing).

/** Effects (rowGlow) that draw an effect layer over the row. */
export const GLOW_LAYERS: Record<string, string> = {
  glow_overcome: 'mastery_ovc',
  glow_strength: 'mastery_str',
  glow_speed: 'mastery_spd',
  glow_endurance: 'mastery_end',
  glow_technique: 'mastery_tec',
  glow_mastery: 'mastery_def',
  glow_rain: 'rain',
  glow_goldrush: 'goldrush',
  glow_spotlight: 'spotlight',
  glow_paparazzi: 'paparazzi',
  glow_premiere: 'premiere',
  glow_shock: 'shock',
};

/**
 * Backdrops that draw a scene under the row's text. '' = the scene is all CSS
 * (no extra pieces). Every one is a dark scene.
 */
export const BACKDROP_LAYERS: Record<string, string> = {
  backdrop_vault: 'vault',
  backdrop_banknote: 'banknote',
  backdrop_terminal: 'terminal',
  backdrop_skyline: 'skyline',
  backdrop_floor: '',
  backdrop_storm: 'storm',
  backdrop_neonalley: 'neonalley',
  backdrop_chalk: 'chalk',
  backdrop_graffiti: 'graffiti',
  backdrop_stars: 'stars',
  backdrop_rooftop: '',
  backdrop_fightnight: 'fightnight',
};

export const SPLIT_FLAP_ID = 'name_splitflap';
export const CORRUPTED_ID = 'name_corrupted';

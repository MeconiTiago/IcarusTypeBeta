export const THEMES = {
  icarus: {
    colors: ["#0d2f45", "#082030", "#3EE39E", "#e6f4f1", "#ca4754"],
  },
  midnight: {
    colors: ["#111111", "#1a1a1a", "#6495ed", "#cccccc", "#ff4444"],
  },
  paper: {
    colors: ["#f5f5f5", "#e0e0e0", "#444444", "#333333", "#d32f2f"],
  },
  matrix: {
    colors: ["#000000", "#001100", "#00ff00", "#00aa00", "#ff0000"],
  },
  sunset: {
    colors: ["#2d1b2e", "#1f1020", "#ff9e64", "#fff0f5", "#ff456a"],
  },
};

const FALLBACK_THEME = "icarus";

export function getThemePalette(themeName) {
  const key = THEMES[themeName] ? themeName : FALLBACK_THEME;
  const palette = THEMES[key]?.colors || THEMES[FALLBACK_THEME].colors;
  return [...palette];
}

export function buildThemeTokens(themeName) {
  const [c1, c2, c3, c4, c5] = getThemePalette(themeName);
  return {
    "--theme-c1": c1,
    "--theme-c2": c2,
    "--theme-c3": c3,
    "--theme-c4": c4,
    "--theme-c5": c5,
  };
}
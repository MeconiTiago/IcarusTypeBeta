export function createThemeApi(THEMES, { buildThemeTokens } = {}) {
  const resolveTokens = (themeName) => {
    if (typeof buildThemeTokens === "function") {
      return buildThemeTokens(themeName);
    }

    const theme = THEMES?.[themeName];
    if (!theme) return null;

    if (Array.isArray(theme.colors) && theme.colors.length >= 5) {
      const [c1, c2, c3, c4, c5] = theme.colors;
      return {
        "--theme-c1": c1,
        "--theme-c2": c2,
        "--theme-c3": c3,
        "--theme-c4": c4,
        "--theme-c5": c5,
      };
    }

    return theme;
  };

  function setTheme(themeName) {
    const tokens = resolveTokens(themeName);
    if (!tokens) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value);
    }
    localStorage.setItem("icarus_theme", themeName);
    renderThemeSelector();
  }

  function renderThemeSelector() {
    const container = document.getElementById("theme-selector");
    if (!container) return;
    container.innerHTML = "";
    const currentTheme = localStorage.getItem("icarus_theme") || "icarus";
    for (const [key, val] of Object.entries(THEMES)) {
      const btn = document.createElement("div");
      btn.className = `theme-btn ${key === currentTheme ? "active" : ""}`;
      btn.addEventListener("click", () => setTheme(key));
      const palette = Array.isArray(val?.colors) ? val.colors : [];
      const preview = palette[2] || val["--main-color"] || "#888";
      const previewBorder = palette[0] || val["--bg-color"] || "#111";
      btn.innerHTML = `<div class="theme-preview" style="background:${preview}; border: 2px solid ${previewBorder};"></div><span class="capitalize text-sub">${key}</span>`;
      container.appendChild(btn);
    }
  }

  function loadTheme() {
    setTheme(localStorage.getItem("icarus_theme") || "icarus");
    renderThemeSelector();
  }

  return { setTheme, renderThemeSelector, loadTheme };
}

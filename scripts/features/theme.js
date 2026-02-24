export function createThemeApi(THEMES, { buildThemeTokens } = {}) {
  const normalizeThemeSearchTerm = (value) => String(value || "").trim().toLowerCase();
  const getThemeSearchTerm = () => {
    const input = document.getElementById("theme-search-input");
    return normalizeThemeSearchTerm(input?.value);
  };

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
    const currentTheme = localStorage.getItem("icarus_theme") || "theme001";
    const searchTerm = getThemeSearchTerm();
    for (const [key, val] of Object.entries(THEMES)) {
      const themeName = val?.name || `Theme ${key.replace("theme", "")}`;
      const themeSection = val?.section || "";
      const searchBlob = `${key} ${themeName} ${themeSection}`.toLowerCase();
      if (searchTerm && !searchBlob.includes(searchTerm)) continue;

      const btn = document.createElement("div");
      btn.className = `theme-btn ${key === currentTheme ? "active" : ""}`;
      btn.addEventListener("click", () => setTheme(key));
      const palette = Array.isArray(val?.colors) ? val.colors : [];
      const preview = palette[2] || val["--main-color"] || "#888888";
      const previewBorder = palette[0] || val["--bg-color"] || "#111111";
      const themeSectionLabel = val?.section ? ` (${val.section})` : "";
      btn.setAttribute("aria-label", `${themeName}${themeSectionLabel}`);
      btn.title = `${themeName}${themeSectionLabel}`;
      btn.innerHTML = `<div class="theme-preview" style="background:${preview}; border: 2px solid ${previewBorder};"></div><span class="capitalize text-sub">${themeName}</span>`;
      container.appendChild(btn);
    }
  }

  function loadTheme() {
    const themeSearchInput = document.getElementById("theme-search-input");
    if (themeSearchInput && !themeSearchInput.dataset.themeSearchBound) {
      themeSearchInput.addEventListener("input", renderThemeSelector);
      themeSearchInput.dataset.themeSearchBound = "1";
    }
    setTheme(localStorage.getItem("icarus_theme") || "theme001");
    renderThemeSelector();
  }

  return { setTheme, renderThemeSelector, loadTheme };
}

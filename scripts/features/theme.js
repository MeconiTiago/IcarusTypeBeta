export function createThemeApi(THEMES) {
  function setTheme(themeName) {
    const theme = THEMES[themeName];
    if (!theme) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme)) {
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
      btn.innerHTML = `<div class="theme-preview" style="background:${val["--main-color"]}; border: 2px solid ${val["--bg-color"]};"></div><span class="capitalize text-sub">${key}</span>`;
      container.appendChild(btn);
    }
  }

  function loadTheme() {
    setTheme(localStorage.getItem("icarus_theme") || "icarus");
    renderThemeSelector();
  }

  return { setTheme, renderThemeSelector, loadTheme };
}

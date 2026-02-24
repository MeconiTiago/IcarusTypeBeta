export function toggleDyslexicMode() {
  const isDyslexic = document.body.classList.contains("dyslexic-mode");
  const btn = document.getElementById("btn-toggle-dyslexic");
  if (isDyslexic) {
    document.body.classList.remove("dyslexic-mode");
    if (btn) {
      if (btn.classList.contains("settings-switch")) {
        btn.classList.remove("is-on");
        btn.setAttribute("aria-pressed", "false");
      } else {
        btn.textContent = "OFF";
      }
    }
    return false;
  } else {
    document.body.classList.add("dyslexic-mode");
    if (btn) {
      if (btn.classList.contains("settings-switch")) {
        btn.classList.add("is-on");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.textContent = "ON";
      }
    }
    return true;
  }
}

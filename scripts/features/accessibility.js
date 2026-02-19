export function toggleDyslexicMode() {
  const isDyslexic = document.body.classList.contains("dyslexic-mode");
  const btn = document.getElementById("btn-toggle-dyslexic");
  if (isDyslexic) {
    document.body.classList.remove("dyslexic-mode");
    if (btn) btn.textContent = "OFF";
  } else {
    document.body.classList.add("dyslexic-mode");
    if (btn) btn.textContent = "ON";
  }
}

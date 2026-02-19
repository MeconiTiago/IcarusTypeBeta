export function bindLegacyInlineHandlers() {
  function splitTopLevel(input, separatorChar) {
    const parts = [];
    let current = "";
    let depth = 0;
    let quote = null;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      const prev = input[i - 1];
      if (quote) {
        current += ch;
        if (ch === quote && prev !== "\\") quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === separatorChar && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function parseArg(raw, event, contextEl) {
    const arg = raw.trim();
    if (!arg) return undefined;
    if (arg === "event") return event;
    if (arg === "this") return contextEl;
    if (arg === "true") return true;
    if (arg === "false") return false;
    if (arg === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg);

    const quoted = arg.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) return quoted[2].replace(/\\'/g, "'").replace(/\\"/g, '"');

    const textContentMatch = arg.match(/^document\.getElementById\((['"])(.+)\1\)\.textContent$/);
    if (textContentMatch) {
      const el = document.getElementById(textContentMatch[2]);
      return el ? el.textContent : "";
    }
    return undefined;
  }

  function runCall(stmt, event, contextEl) {
    const m = stmt.match(/^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/);
    if (!m) return;
    const fnName = m[1];
    const fn = window[fnName];
    if (typeof fn !== "function") return;
    const argsRaw = m[2].trim();
    const args = argsRaw ? splitTopLevel(argsRaw, ",").map((a) => parseArg(a, event, contextEl)) : [];
    fn.apply(contextEl || window, args);
  }

  function run(code, event, contextEl) {
    const statements = splitTopLevel(code || "", ";");
    for (const stmtRaw of statements) {
      const stmt = stmtRaw.trim();
      if (!stmt) continue;

      const ifSelfMatch = stmt.match(/^if\s*\(\s*event\.target\s*===\s*this\s*\)\s*(.+)$/);
      if (ifSelfMatch) {
        if (event.target === contextEl) run(ifSelfMatch[1], event, contextEl);
        continue;
      }

      runCall(stmt, event, contextEl);
    }
  }

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-onclick]");
    if (!el) return;
    run(el.getAttribute("data-onclick"), event, el);
  });

  document.addEventListener("keydown", (event) => {
    const el = event.target.closest("[data-onkeydown]");
    if (!el) return;
    run(el.getAttribute("data-onkeydown"), event, el);
  });
}

# Icarus Theming Standard

## Goal
All platform colors must come from a centralized theme model.
Each theme is defined by exactly 5 hex colors.

## Source of Truth
- Theme palette config: `scripts/config/themes.js`
- Global derived tokens and utility classes: `styles/themes.css`
- Component styling: `styles/components.css`
- Runtime theme application: `scripts/main.js`

## 5-Color Theme Model
Each theme uses:
1. `c1` -> primary background
2. `c2` -> surface/background alt
3. `c3` -> primary accent
4. `c4` -> primary text
5. `c5` -> error/danger

These 5 colors are mapped to CSS variables:
- `--theme-c1` ... `--theme-c5`

Then semantic tokens are derived in `styles/themes.css`:
- Core: `--bg-color`, `--sub-alt-color`, `--main-color`, `--text-color`, `--error-color`
- Secondary: `--sub-color`, `--success-color`, `--gold-color`, `--error-extra-color`, etc.
- Alpha variants for overlays/charts/borders: `--bg-12`, `--bg-18`, `--sub-32`, `--sub-35`, `--sub-90`, etc.

## Rules (Mandatory)
1. Do not add hardcoded colors (`#hex`, `rgb`, `rgba`, `hsl`) in `styles/components.css`.
2. Do not add hardcoded chart/UI colors in `scripts/main.js`.
3. Always consume theme tokens (`var(--token-name)` or `getThemeColor('--token-name')`).
4. New visual states must be added as derived tokens in `styles/themes.css`.

## Add a New Theme
Edit `scripts/config/themes.js`:

```js
newtheme: {
  colors: ["#111111", "#1b1b1b", "#4fd1c5", "#f7fafc", "#f56565"],
},
```

No other file needs direct color changes; the runtime applies the 5-color palette and all UI inherits from tokens.

## Runtime Flow
1. User selects theme in Settings.
2. `scripts/main.js` calls `buildThemeTokens(themeName)`.
3. `--theme-c1..--theme-c5` are applied to `:root`.
4. Derived semantic tokens in CSS update automatically.
5. Choice is persisted in `localStorage` (`icarus_theme`).

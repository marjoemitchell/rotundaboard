# Rotunda Board — logo assets

Vector mark for a Montana legislative bill tracker. Six flat shapes: a semicircular dome with a spire, a cornice, and three ascending columns that read as a colonnade going up and as a rising bar chart going across.

## Files

| File | Use |
|---|---|
| `logo-mark.svg` | Light surfaces. Copper dome, navy cornice and bars. |
| `logo-mark-dark.svg` | Ink/navy surfaces. Copper dome, near-white cornice and bars. |
| `icon-16/32/48.png` | Favicon set, transparent. |
| `icon-180.png` | Apple touch icon, transparent. |
| `icon-512.png` / `icon-512-dark.png` | Large transparent raster if a build step needs one. |
| `app-icon-512.png` | Filled navy app icon with 16% safe-area padding. |

Prefer the SVG everywhere it is supported. The PNGs are drawn from the same geometry, not traced.

## Colors

| Role | Hex |
|---|---|
| Dome, spire, accent | `#b9723d` |
| Cornice and bars, light surfaces | `#0f2547` |
| Cornice and bars, dark surfaces | `#eef1f5` |

## Lockup

The mark plus live type — do not use a pre-rendered lockup image.

```html
<span class="logo">
  <img src="logo-mark-dark.svg" alt="" width="26" height="26" />
  <span>Rotunda <span class="logo-sub">Board</span></span>
</span>
```

```css
.logo { display: flex; align-items: center; gap: 10px;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.logo-sub { font-weight: 400; color: #b7c8dd; }  /* #5c6b80 on light */
```

Gap between mark and wordmark is 0.4× the mark height. Optional tagline sits under the wordmark in IBM Plex Mono, 10px, `0.16em` tracking, uppercase.

## Rules

- Minimum size 16px. Verified legible: dome, cornice, and all three bars stay separate at 16px.
- Clear space on all sides equals the mark's cornice height (3/32 of the mark).
- Do not recolor the dome away from copper, add gradients or shadows, rotate the mark, or wrap type around it in a ring.
- Do not place the light mark on a mid-tone background; the cornice and bars need either navy or paper behind them.

## Geometry

32×32 viewBox. Spire `x15 y2 w2 h3`. Dome: semicircle, center `(16,14)`, radius `10`. Cornice `x3 y14 w26 h3`. Bars `x4.5 y26 w5 h3.5`, `x13.5 y23 w5 h6.5`, `x22.5 y20 w5 h9.5` — 4-unit gaps, common baseline at `y29.5`. The gaps are what keep it readable at 16px; do not narrow them to fit a fourth bar.

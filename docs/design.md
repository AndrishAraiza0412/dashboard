# Dashboard design

Warm cream canvas and coral accent, adapted for a dense, data-first dashboard.
Source of truth for values: `src/styles/tokens.css`. If this file and the CSS disagree, the CSS wins.

## Base palette and shapes
- Warm cream canvas `#faf9f5`, cards `#efe9de`, hairline `#e6dfd8`, warm ink `#141413`.
- Coral as the single accent: one primary action per screen.
- Radii 8px (controls) / 12px (cards) / 16px (large containers); pill for badges.
- Display type is the serif at weight 400 with negative tracking, used for page titles only.

## What changes for a dashboard
| Marketing site | Dashboard | Why |
|---|---|---|
| Section rhythm 96px, card padding 32px | 8px grid, card padding 20-24px | Density: KPIs, tables and charts share one screen |
| Serif for all headlines and prices | Serif for page titles only; KPI numbers in sans with `tabular-nums` | Digits must align in columns |
| Copernicus / StyreneB (commercial) | Source Serif 4 / Inter / JetBrains Mono via `next/font` | Free licences |
| Spike-mark and Anthropic wordmark | Removed | Not our brand |
| White on `#cc785c` buttons | White on `--primary-strong #a8634c` | Brand coral gives 3.28:1; WCAG AA needs 4.5:1 |
| Dark surfaces in marketing bands | Not in v1 (light only) | Dark mode ships in v1.1 |

## Accessible colour roles (all >= 4.5:1 against the surfaces they sit on)
- Text: `--ink`, `--body`, `--muted` (`#6a6863`). `--muted-soft` is decorative only (3.23:1).
- Brand coral `--primary #cc785c`: decorative fills, large shapes, chart marks. Never body text.
- Buttons and badges: `--primary-strong`, hover `--primary-hover`, active `--primary-active`.
- Inline links: `--primary-text #965844`.
- Status: `--success #277640`, `--warning #896109`, `--error #b23e3e`, always with an icon glyph and a word.

## Chart palette (categorical, fixed order, never cycled)
`#cf6a47` coral, `#2a78d6` blue, `#1ba37a` green, `#e8a100` amber, `#6b4fc4` violet.
Validated with the dataviz skill's `validate_palette.js` on `#faf9f5`: lightness, chroma, colour-blind
separation and normal-vision separation pass. Amber is 2.09:1 against the surface, so any amber mark
needs a visible label or a table view. A 6th series folds into "Otros".

## Component rules
- Every status uses icon + text, never colour alone (`Badge`, `StatTile` trend, `Toast`).
- Tables scroll inside their own container; the page never scrolls horizontally.
- Dialogs use native `<dialog>` (focus trap, Esc, backdrop from the platform).
- Charts: 2px lines, recessive grid, tooltip on every point, `role="img"` with a label.
- Focus ring: 2px `--primary-strong`, offset 2px, on every interactive element.

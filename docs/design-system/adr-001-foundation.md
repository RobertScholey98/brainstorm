# ADR 001: Colour tokens, closed scales and the accent

Status: accepted. Rob picked the Lagoon accent at the foundation checkpoint on 2026-11-05, and approved the rest of the direction.

## Context

The round 1 reviews (`design-review/round-1/`, merged in `worklist.md`) scored self-consistency 5.5 to 7. The worklist traces 12 of its 41 findings to the base layer. Brainstorm had shadcn's default palette, with `accent` meaning a grey hover fill and `primary` meaning near-black, and no brand hue. The renderer used five arbitrary font sizes (10, 11 and 13 px, `0.8rem` and `0.85em`), seven arbitrary radii and focus rings of both 2 and 3 px. The canvas showed classic Windows scrollbars with arrow buttons beside thin ones in the shell (W11). The canvas was a cool blue-grey against warm chrome, and in dark it was darker than the window, so a frame read as a hole (W16).

The foundation phase fixes the base layer so the kit, shell and screen phases build on one set of values. This ADR records those values and why.

## Decision

### One source for every colour

`src/core/design.ts` is the only place a colour value lives. It feeds three consumers.

- `npm run design:tokens` writes `src/renderer/design.css` from `designStylesheet()`. A test in `test/design.test.ts` fails when the committed file differs from the generator's output, so nobody edits the CSS by hand.
- The canvas runtime inlines `designCss("bs-")` into the frame. The prefix means block code written by an agent can't pick up `--border` or `--accent` by accident, and the frame still matches the shell exactly.
- `scripts/design/checkpoint.mjs` reads `solidColours()` to draw the mark sheet.

Each colour has one meaning. A role is named for what it does, not for its shade, so a reader of `bg-selected` knows what state the element is in.

| Role | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `app` | `#eae9e4` | `#1a1a18` | The window behind everything, and the sidebar |
| `canvas` | `#f6f5f2` | `#232321` | The canvas behind the frames |
| `card` | `#ffffff` | `#2b2b29` | A frame body, the inspector and inputs |
| `raised` | `#ffffff` | `#343431` | Popovers, menus and the select list |
| `muted` | `#f1f0ec` | `#383834` | A quiet fill, such as a secondary button or a confirmed pin |
| `hover` | `fg` at 8% | same mix | The pointer is over it |
| `selected` | `accent` at 18% | same mix | It is the chosen item |
| `fg` | `#1b1b1a` | `#ecebe8` | Body text |
| `fg-muted` | `#66655f` | `#a8a7a1` | Secondary text and icons |
| `border` | `#e6e5e1` | `#3a3a36` | Dividers and card edges |
| `border-strong` | `#d4d3cd` | `#55554f` | Input and control edges |
| `ring` | `#73726c` | `#94938d` | The focus ring, always at full strength |
| `inverse`, `inverse-fg` | `#1f1f1e`, `#fafaf9` | `#ecebe8`, `#1f1f1d` | The neutral solid fill of the default button, a checked checkbox and an on switch |
| `accent`, `accent-fg`, `accent-hover` | see below | see below | Brainstorm itself: the mark, the primary action, open pins, selection |
| `success` | `#497011` | `#9ccc5a` | Attached, confirmed, done |
| `warning` | `#885600` | `#f2b860` | Needs Rob before it can continue |
| `danger` | `#bb372c` | `#ff8a7f` | Failed, destructive |
| `info` | `#2f63c4` | `#86aeff` | Neutral status, such as the agent asking a question |

Each status colour has a `-subtle` partner, the status mixed 12% into `card`, for a tinted box behind status text. Every derived token is a `color-mix` in oklab over the solids, the same expression in both themes, so a derived value can't drift from its solid.

The neutrals are warm greys, a little yellow, so the app sits next to Claude desktop without looking cold beside it. In both themes the layers step up from `app` to `canvas` to `card`, and in dark on to `raised`, because a shadow barely shows on a dark ground. The window and sidebar recede, and the card is the brightest layer, the way both exemplars draw it. Each step is at least 2.5 CIEDE2000, a test in `test/design.test.ts` checks the order and the steps, and the amendment below says why the order changed in round 3.

Contrast, measured with `contrast()` in `design.ts` against `app`, `canvas`, `card`, `raised` and `muted` in that order:

| Token | Light | Dark |
| --- | --- | --- |
| `fg` | 15.81, 14.85, 17.24, 17.24, 15.12 | 14.32, 13.53, 12.72, 11.10, 10.80 |
| `fg-muted` | 5.36, 5.04, 5.85, 5.85, 5.13 | 7.08, 6.69, 6.29, 5.49, 5.34 |
| `ring` | 4.00, 3.76, 4.37, 4.37, 3.83 | 4.87, 4.60, 4.32, 3.77, 3.67 |
| `accent` | 5.08, 4.77, 5.54, 5.54, 4.86 | 7.99, 7.55, 7.10, 6.20, 6.03 |
| `success` | 4.97, 4.66, 5.41, 5.41, 4.75 | 9.10, 8.60, 8.08, 7.06, 6.86 |
| `warning` | 5.81, 5.45, 6.33, 6.33, 5.55 | 9.59, 9.06, 8.52, 7.44, 7.23 |
| `danger` | 4.95, 4.65, 5.40, 5.40, 4.74 | 7.47, 7.06, 6.64, 5.80, 5.64 |
| `info` | 5.20, 4.89, 5.67, 5.67, 4.97 | 7.73, 7.31, 6.87, 6.00, 5.83 |

Text roles pass 4.5:1 on every surface and the ring passes 3:1. Round 2 found the kit drawing the ring at 40% and 50% opacity, about 1.6:1 and 2.1:1 in dark, so the ring now has no opacity anywhere and the lint's `focus-ring` rule fails one that does. The ring test also measures every derived fill a focused control sits on: each `-subtle` fill, and the hover and selected tints over the window and the card. Light `ring` moved from `#85847e` to `#7a7973`, because the old value was 2.84:1 on a selected row in the sidebar. Dark `border-strong` lifted from `#4a4a45` to `#55554f`, and an unchecked checkbox's edge is `fg-muted`, because its edge is the only thing that shows it. The `-subtle` mix went from 10% to 12%, so dark warning and danger strips read as two tints, at least 5 CIEDE2000 apart, with each status colour still 4.5:1 on its own fill. `test/design.test.ts` asserts those floors, so a token edit that breaks one fails `npm test`. A draft `fg-faint` measured 2.46:1 on the light canvas and had no callers, so it was deleted rather than kept for later.

### Closed scales

`src/renderer/styles.css` clears Tailwind's defaults with `--<namespace>-*: initial` and defines only these keys. A utility outside them generates no CSS, and `npm run lint:design` reports it.

| Scale | Steps |
| --- | --- |
| Spacing | `0` 0, `0.5` 2, `1` 4, `1.5` 6, `2` 8, `3` 12, `4` 16, `5` 20, `6` 24, `8` 32, `10` 40, `12` 48 px |
| Sizing only | `2.5` 10, `3.5` 14, `4.5` 18, `7` 28, `16` 64 px, for icons, dots and control heights |
| Layout widths | `inspector` 280, `popover-sm` 320, `popover-md` 380, `menu` 144, `picker` 220 px; containers `xs` 20rem, `sm` 24rem, `md` 28rem |
| Type | `2xs` 11/14, `xs` 12/16, `sm` 13/18, `base` 14/20, `lg` 16/22, `title` 22/28 px |
| Weight | `normal` 400, `medium` 500, `semibold` 600 |
| Leading | `none` 1, `snug` 1.375, `relaxed` 1.55 |
| Tracking | `tight` -0.01em |
| Radius | `sm` 4, `md` 6, `lg` 8, `xl` 12 px, plus `full` |
| Shadow | `xs`, `sm`, `md`, `lg`, each a per-theme `elevation-*` token; dark adds a 1 px white hairline |
| Layers | `raised` 10, `sticky` 20, `popover` 40, `tooltip` 50, `toast` 60 |

Every font size carries its own line height, so `text-sm` is always 13/18 and a line-height modifier such as `text-sm/6` is off the scale. Sizing-only steps share the spacing namespace, because Tailwind sizes and spaces from one namespace. The lint keeps them off padding, margin and gap. Tailwind still compiles a bare `z-10` from the number, so the lint allows only the named layers.

The runtime `--spacing: 4px` sits outside the theme on `:root`. `tw-animate-css` reads it for slide offsets, and as a plain variable it opens no `p-13`.

### Density

Brainstorm is a tool Rob keeps open all day beside two other dense apps, so the default control is 28 px (`h-7`) and body text is 13 px. Buttons, inputs, selects and toggles moved from 32 to 28 px, and their large sizes from 36 to 32 px. Where the codemod met a spacing value between two steps, it rounded down, so `px-2.5` became `px-2` and `gap-2.5` became `gap-2`. The inspector narrowed from 300 to 280 px so both demo frames fit beside it at 1440 (W4).

### Scrollbars

Every scroll region, the canvas frame included, uses one `::-webkit-scrollbar` style. It is 10 px, with no arrow buttons, a transparent track and a round thumb of `fg` at 22% that darkens to 36% on hover. A 2 px transparent border clipped to the padding box makes the thumb sit inside the track, and the track stops 12 px short of each end, the main card's corner radius. The stylesheet sets neither `scrollbar-width` nor `scrollbar-color`, because Chromium ignores the `::-webkit-scrollbar` rules once either is set, and the standard properties can't round or inset the thumb.

### Font

Brainstorm keeps Segoe UI Variable for the interface and Cascadia Mono for code, and bundles no font. Both ship with Windows 11, where Rob runs Brainstorm, so they cost nothing to load and match the Windows chrome around the window. Segoe UI Variable has an optical-size axis tuned for small text and true 400, 500 and 600 weights. The reviewers' type findings (W12, W13) were about the size scale and the weights in use, and the closed scale fixes both. One reviewer suggested Inter and another called a bundled face optional. Inter would mean bundling and loading font files and would make Brainstorm look like most Electron apps, and no finding needs it.

### Accent

The accent is one token family, `accent`, `accent-fg` and `accent-hover`, set by `ACCENT` in `design.ts`. Changing it, running `npm run design:tokens` and rebuilding moves the mark, the primary button, open pins, selection and the canvas frame together. `selected` and `accent-hover` are mixes of `accent`, so they follow without a second edit.

Rob picked **Lagoon**, a teal: `#0b7570` with `#ffffff` on it in light, and `#43c4b9` with `#062421` on it in dark. It is the quietest of the three candidates (Iris, Lagoon and Plum) and the most like a utility. The other two were deleted with the code that rendered them.

In dark, Lagoon sat 14.3 CIEDE2000 from the old `success` `#5cc48a`, and 14.8 in light, so an open pin and an attached badge read as one family. `success` moved to a yellower green, `#4e7514` light and `#9ccc5a` dark. It now sits 25.5 from the accent in light and 26.8 in dark, and still passes 4.5:1 on every surface.

`test/design.test.ts` holds that apart. Every pair among `accent`, `success`, `warning`, `danger` and `info` must be at least **20 CIEDE2000** apart in each theme. CIEDE2000 is the CIE's perceptual difference formula, and 2.3 is a just-noticeable difference, so 20 is a hue that reads as different at a glance. The closest pair today is light `warning` and `danger` at 23.1. The test checks the formula against Sharma, Wu and Dalal's published reference pairs.

### Mark

The "B" tile is now `src/renderer/Mark.tsx`, an inline SVG drawn from `MARK` in `design.ts` on a 16-unit grid. It is a canvas pin's teardrop, rounded on three corners and square at the bottom left where a pin points, with an `accent-fg` dot where a comment anchors. Brainstorm's one distinct gesture is pinning feedback to a design, so the mark is that pin. The shape has no detail under 2 units, so it holds at 16 and 20 px. `design-review/checkpoint/mark.png` shows it at 16, 20 and 48 px in both themes.

### Pins show status by form as well as colour

An open pin is an accent fill with `accent-fg` numerals. An addressed pin is a card fill with an accent ring and accent numerals. A confirmed pin is a muted fill with `fg-muted` numerals. Rob can tell the three apart without telling hues apart, and the canvas runtime and `Feedback.tsx` use the same three forms.

### The codemod

`scripts/design/codemod.mjs` moved the renderer onto the scales. It parses string literals and template chunks out of each TSX file with `scripts/design/classes.mjs` and rewrites only class tokens. Its tables map arbitrary sizes, radii and widths to scale steps, shadcn colour names to roles, numeric layers to named ones, and any background in a pressed, active or selected state to `bg-selected`. Lookups use `Object.hasOwn`, so a class named `constructor` can't hit `Object.prototype`. Replacements are functions, so a `$` in a class never acts as a replacement pattern. It rewrites only the text inside literals, so a CRLF file keeps its line endings, and it writes a file only when its content changed.

Pass `--shadcn` for a component fresh from `shadcn add`. shadcn's `accent` is a hover fill, and Brainstorm's `accent` is the brand, so the flag maps `accent` to `hover`. Without the flag the codemod is idempotent. A second run over the migrated renderer changed nothing.

### The lint

`npm run lint:design` (`scripts/design/lint.mjs`) checks every TSX file under `src/renderer` for three rules.

- `arbitrary-value` fails a utility with a bracket or parenthesis value, such as `text-[13px]`, outside `components/ui`. Variants such as `data-[selected]:` are allowed.
- `raw-colour` fails a hex colour or a colour function such as `rgb(` or `oklch(` in any string, the kit included.
- `off-scale` fails a utility that generates no CSS under the closed theme, a numeric `z-*`, a sizing-only step on padding, margin or gap, and a ring or outline wider than 2 px.

The lint loads `styles.css` into Tailwind's own design system through `@tailwindcss/node` and asks it whether each candidate compiles, so the theme is the only list of allowed values. A string inside `className`, `cn`, `cva`, `cx` or `clsx` is always classes. Any other string counts as classes only when every word in it parses as a Tailwind candidate and at least one compiles, which keeps `align="end"` and `data-icon="inline-start"` out. `test/design-lint.test.ts` tests each rule with literal input and runs the lint over the real renderer, so `npm test` enforces it too.

## Edits to `components/ui`

These files came from shadcn's base-nova registry. The foundation edited them only where a token or scale required it.

- **Colour names.** The codemod with `--shadcn` renamed shadcn's colours to roles in every file. `primary` became `inverse`, `secondary` became `muted`, `destructive` became `danger`, `input` became `border-strong`, `popover` became `raised`, `background` became `card`, `foreground` became `fg`, the `sidebar-*` family became `app`, `hover`, `border` and `ring`, and shadcn's `accent` became `hover`.
- **Selection.** Pressed, active and selected backgrounds in `toggle.tsx` and `sidebar.tsx` became `bg-selected`.
- **Density.** `button.tsx`, `input.tsx`, `select.tsx` and `toggle.tsx` moved the default height from 32 to 28 px and the large size from 36 to 32 px. Horizontal padding went from 10 to 8 px.
- **Accent variant.** `button.tsx` gained `variant="accent"`, `bg-accent text-accent-fg hover:bg-accent-hover`, for the one primary action on a screen.
- **Radius.** `rounded-[min(var(--radius-md),10px)]` and its 12 px twin became `rounded-md` in `button.tsx`, `select.tsx`, `toggle.tsx` and `toggle-group.tsx`. `rounded-[4px]` in `checkbox.tsx` and `rounded-[2px]` in `tooltip.tsx` became `rounded-sm`. `rounded-4xl` in `badge.tsx` became `rounded-full`.
- **Focus.** Every `ring-3` and `ring-[3px]` became `ring-2`.
- **Layers.** `z-10`, `z-20` and `z-50` became `z-raised`, `z-sticky` and `z-popover`.
- **Widths.** `w-72` in `popover.tsx` became `w-popover-sm`, `min-w-36` in `select.tsx` became `min-w-menu`, and `min-h-40` in `slider.tsx` became `min-h-picker`.
- **Spacing function.** Tailwind's `--spacing()` needs a theme `--spacing`, which the closed theme clears. `toggle-group.tsx` now reads `gap-[calc(var(--gap)*4px)]` and `sidebar.tsx` adds `16px` where it added `--spacing(4)`.
- **Slider thumb.** `bg-white` became `bg-card`, so the thumb follows the theme.

## Consequences

- A new colour, size or layer starts in `design.ts` or `styles.css`, and nowhere else. The lint and the token tests fail anything that skips that step.
- The kit can't drift back to shadcn's defaults without the lint saying so, but a fresh `shadcn add` needs the codemod with `--shadcn` before it passes.

These are open and belong to later phases.

- Both active variant rows in the session panel show `bg-selected`, one per slot, so selection still doesn't say which slot holds the selected frame (W18, shell).
- The selected segment in a toggle group now uses `bg-selected`, but the group's track and the segment's edge need the kit pass to read clearly (W6, kit).
- Tooltips use `bg-fg text-card` and sit on `z-popover`, the same layer as popovers. The kit pass moves them to `inverse` and `z-tooltip`.
- The sheet scrim maps `bg-black/10` to `bg-fg/10`, which lightens the backdrop in dark. Nothing opens a sheet at desktop widths today.

## Amendments

### Round 3: the card is the brightest layer (2026-11-06)

Round 3 found that in light the main card read as a recessed beige hole (SA3-1, U1). The window and sidebar were `#f6f5f2`, and the canvas that fills the main card was one step darker at `#efeeea`, so home put white cards in a well darker than the sidebar beside it. Both exemplars do the opposite. Their sidebar recedes and the main area is the brightest thing on screen. In dark the home cards barely lifted off the canvas (OA3-16, U28), and hover and selected rows read alike (SC3-3, U29).

The surfaces now step up in one order in both themes, `app` to `canvas` to `card`.

| Token | Light, old | Light, new | Dark, old | Dark, new |
| --- | --- | --- | --- | --- |
| `app` | `#f6f5f2` | `#eae9e4` | `#1c1c1a` | `#1a1a18` |
| `canvas` | `#efeeea` | `#f6f5f2` | `#21211f` | `#232321` |
| `card` | `#ffffff` | `#ffffff` | `#262624` | `#2b2b29` |
| `raised` | `#ffffff` | `#ffffff` | `#30302d` | `#343431` |
| `muted` | `#f1f0ec` | `#f1f0ec` | `#32322e` | `#383834` |
| `ring` | `#7a7973` | `#73726c` | `#8a8983` | `#94938d` |
| `success` | `#4e7514` | `#497011` | unchanged | unchanged |
| `danger` | `#c03a2f` | `#bb372c` | unchanged | unchanged |
| `selected` | `accent` at 14% | `accent` at 18% | same mix | same mix |

- **The steps.** Card to canvas is 2.53 CIEDE2000 in both themes, canvas to window 2.75 in light and 2.83 in dark. The old dark card sat 1.6 off the canvas.
- **What moved with them.** A darker light window took `success` and `danger` under 4.5:1 on it, so both went one step darker. They keep their 20 CIEDE2000 from the accent and each other. The selected tint went from 14% to 18%, so it sits at least 5 CIEDE2000 from hover on the window and the card. That took the ring under 3:1 on the selected fill, so the ring went one step darker in light and lighter in dark.
- **The tests.** `test/design.test.ts` checks the order, the 2.5 step between each pair of layers, and the hover to selected distance, beside the contrast and hue tests it already ran.


### Round 3: one chip, one filled button, and hints that name their side (2026-11-06)

Round 3 found the `muted` chip gone on the window and the canvas in light, three inverse fills beside the accent primary, and hints that opened over the controls they served (U4, U10, U13).

- **One chip.** `components/ui/chip.ts` holds the recipe, a `card` fill inside a `border-strong` edge. The edge carries a chip on a card or a popover and the fill carries it on the window and the canvas. `Badge`, `Kbd`, `Code`, the export path and the canvas zoom readout use it. A token test checks the edge sits at least 5 CIEDE2000 from every surface.
- **One filled button.** `Button` has no `default` (inverse) or `secondary` variant, so `accent` is the only filled button. `outline` is the default. Text buttons are 28 px, and the 24 px size is for icon buttons in a row. A checked checkbox and an on switch take the accent. `inverse` is now only the light tooltip's surface, drawn by `overlaySurface`.
- **Hints name their side.** `Hint` needs a `side`. A header hint opens left or right, off the canvas bar and the Inspector header.

The lint gains three rules, each tested in `test/design-lint.test.ts`.

- `inverse-fill` fails `bg-inverse` in any TSX file, the kit included.
- `chip-recipe` fails a `<code>` or `<kbd>` element whose own classes paint a fill.
- `hint-side` fails a `Hint` with no `side`, and a `top` or `bottom` hint in `TopBar.tsx`, `Regenerate.tsx` or `Export.tsx`.

### Round 3, second pass: a title step, a firmer hover, and tracks that clear the corners (2026-11-06)

- **A title step.** The home heading was `lg`, 16 px, beside Claude desktop's page title at about 24 px, so the overview had no page-level presence (round 4 shots 02 and `vs-claude-home`). The scale gains one display step, `title`, 22/28 px, at semibold with `tracking-tight`. Only the kit's `PageHeader` uses it, so every page heading has one size, and the lint's `page-title` rule fails `text-title` anywhere else. The window header's breadcrumb title stays 13 px, because it names the window, as T3 Code's does.
- **Hover.** `hover` went from `fg` at 6% to 8%. At 6% a hovered row sat 2.65 CIEDE2000 off the light window, about a just-noticeable difference (SB3-16, U29). At 8% it is at least 3.6 off the window and the card in both themes, and still at least 7.8 from `selected`. A token test holds the 3.5 floor.
- **Scrollbar tracks.** A thumb ran into the main card's 12 px corners (OD3-22, U50). Every track now stops `SCROLL_TRACK_INSET` short of each end, 12 px, and a test ties that value to `--radius-xl`.

| Token or step | Old | New |
| --- | --- | --- |
| `hover` | `fg` at 6% | `fg` at 8% |
| type `title` | none | 22/28 px |
| scrollbar track | runs end to end | 12 px short of each end |

### Round 4: a hint row, and the scroll edges (2026-11-06)

- **A hint row.** Every Claude reviewer found the blocked Regenerate's hint opening over Open thread and Withdraw, the controls it told Rob to use (U4's fix, reopened as T2). The root was the anchor: a hint opened left of its own control, and in the header's right cluster every control but the first has controls on its left, so Export's hint covered Regenerate and the Inspector toggle's covered Export too. The kit's `HintAnchor` names a row of controls whose hints open off the whole row. The header's right cluster provides it, so all its hints open left of the cluster, over the breadcrumb, and a popover resets it for the hints inside. The blocked hint also shrank to "Withdraw request 1 to send another". `verify:5` hovers each right-cluster control in the queued phase at 1440 and 1100 and fails a hint that overlaps any header control.
- **One gutter rule.** The sidebar reserved its gutter on top of its inset, so row fills sat 16 px off one edge and 26 px off the other; the overview reserved none, so its grid moved 10 px once it scrolled; and the stage padded its left by a gutter it didn't always have (T4). Every scroller now keeps `SCROLLBAR`, 10 px, as a gutter on both sides through the `scroll-gutter` utility (`stable both-edges`), and pads each side by its inset less the gutter. `design.ts` writes the width as `--scrollbar`, the kit `ScrollPane` takes an `inset` of 16 or 24 px, and `SidebarContent` reaches out into the sidebar's padding by the gutter. `verify:7` checks a sidebar row, the overview grid and a stage frame sit as far off both edges of their pane.

### Round 6: one phase table, one field fill, and the fades (2026-11-07)

- **One phase table.** Phases took their tones from two tables, so "Queued in T3" was muted in the header and accent in the sidebar and on home, and a send failure showed its red three times. `PHASE` in `src/renderer/status.ts` now holds each phase's short name, tone and whether it is live, and the header, its strip, home's rows and cards, and the sidebar's Thread row all read it. A status hue (info, warning, danger) shows once, in the header and the strip that explains it. The Thread row and a failed fork's row echo it muted through `echoTone`, the R5-66 rule extended to failures.
- **One field fill.** Every field fills with `bg-card` in both themes: text inputs, the select, the colour field and the checkbox. The `field-fill` lint rule fails a `dark:bg-border-strong/…` tint, in the kit and out of it.
- **The kit separator centres itself.** A vertical `Separator` is 16 px tall and centred on its row. Callers no longer pass `h-4 self-center`, which the kit's `self-stretch` used to outrank.
- **The fades** (replaced in round 8). The top fade runs over 32 px and hides its outer 24 px outright: a switch's 20 px track and its ring, so an accent switch cut there leaves no crescent (R5-21). `scroll-fades-x` is the same recipe on the inline axis, for the history strip.
- **Tokens.** `--container-header` is gone, since the header measures its own fit (ADR 003). `--spacing-strip` (84 px) and `--spacing-still` (56 px) size the history strip and a still's card in it (ADR 005).
- **A raw part.** The `raw-part` lint rule fails a pin's part rendered as its id. Rob reads it through `partLabel`.
- **Kit parts for faults that came twice.** `BlockedHint` is the hint on a control that is off: its own component type, so a control that turns off mounts a fresh tooltip and its hint opens on hover (R6-67); the `blocked-hint` lint rule fails the wrapper written by hand. `Truncate` cuts a one-line title or brief after a letter, never after a space, comma or stop (R6-18); `truncate-text` fails a title or brief cut by the bare `truncate` class. `FieldLabel` is the one field label in a popover, 12 px medium muted with an optional aside such as "optional" (R6-17). `Count` is the one shape a count takes, a muted numeral after its label; a Badge is a label such as the iteration, and `count-badge` fails a count in one (R6-43).
- **Kit sizes and edges.** `SidebarMenuAction` is the 24 px ghost icon button (R6-37). A `wide` callout opens its message with the icon, so its lines and its actions share one edge (R6-52). A toast's edge takes the danger tone at 40% (R6-55). `Empty` takes `align="start"` for a message on a left-aligned page, as home's are (R6-54).
- **Warning leans yellow.** Light `warning` moved from `#8a5300` to `#885600`. Its 12% fill sat 5.3 from danger's, so a warning and a failure read as peach and pink (R6-45). `design.test` now holds every pair of status fills 6 apart in both themes.
- **Two first edges in the card.** A bar row, the canvas bar or the window header, starts its first ink at card + 16, `ScrollPane`'s 16 px inset, so a lone label such as "No slots yet" stands where the breadcrumb does. A page, home and nothing else for now, starts at card + 24, the 24 px inset, because its heading is the `title` step and needs more room than a 13 px row (R5-11, R6-14). No third edge: a pane is a bar row or a page.

### Round 7: measured fades, and kit parts for faults that came twice (2026-11-07)

- **The fades measure what they cut** (replaced in round 8). Round 6's fixed bands still left a slider thumb, a field's edge or a card title half under the top fade, and the bottom's 16 px cut home's last line flat (R7-5, R7-6). `ScrollPane` now measures where its text lines and its controls of 48 px or less sit, and sets each fade from them. The hidden band reaches past any line or control it would cut, up to a third of the pane, and the ramp after it starts at 30%, so one in it reads dimmed, never gone. `fadeCuts` in `fade-cut.ts` holds the rule and `test/fadeCut.test.ts` its cases. `verify:7` shoots the Inspector and home at every 3 px of scroll, painted, unmasked and transparent, and fails any line or control shown in part. The old recipe fails it on both panes.
- **`truncate-text` covers any line of text.** The rule covered only titles and briefs, so the strip's origin still ended on a space (R7-3). It now fails any element whose children are only text and that the bare `truncate` class cuts. `Truncate` takes a ref, so a `Hint` can wrap it.
- **The open look keys off `aria-expanded`.** Base UI marks a tooltip's trigger `data-popup-open` while its hint shows, so every hovered button with a hint took the open-trigger recipe (R7-15). Only a popover's trigger sets `aria-expanded`. The outline button hovers with the ghost's fill, so the pointer has one fill (R7-17).
- **A hint names its control.** `Hint` and `BlockedHint` take a `name` that leads the hint in medium weight, "Regenerate · Withdraw request 1 first", wherever the hint opens off a row rather than its own control (R7-13, R7-32). ADR 003 has the header's case.
- **`SubmitKey`** sets a send button's key 4 px before it and 12 px after the Cancel beside it, so the key reads as the send's (R7-31). Regenerate, Vary, Fork and the comment composer use it.
- **`PopoverHeader` takes an `icon`** that hangs before the title as the Callout's does, so the description starts under the title's words (R7-27).
- **One failure recipe.** A toast draws a failure as a danger Callout does: a danger title over a 12 px fg reason (R7-14, U24).
- **A corner count is cut from its glyph.** The rail's 40 px leaves no room to set the 16 px count clear of the glyph, so `Badge size="corner"` draws a 2 px ring in the card's colour (R7-22).
- **An inert switch fills muted when on.** At a past iteration's 60% the accent track still read as live (R7-33).
- **One clock.** Every age reads `clock` in `time.ts`, which ticks as often as its most frequent reader needs, so a sidebar row and a card never show one brainstorm at two ages (R7-11).
- **The accent waits for the agent.** Sending and starting spin muted. Only working takes the accent, as R5-55 ruled (R7-25). `status.test` holds it.

### Round 8: pane heads, not fades (2026-11-07)

- **No vertical fade.** Four fixes faded content at a pane's top: R5-21, R6-9, R6-57 and round 7's measured fades (R7-5, R7-6). Each kept one premise, that a gradient can mask content at that edge and read as meant. It can't. A gradient over arbitrary content always leaves part of a glyph or a control showing, and the measured fade swapped that for a blank band up to a third of the pane deep. Round 8's shot 69 shows home blanking about 90 px under the query row, with the cut cards' bottom edges still showing. That reads as a rendering fault.
- **Pane heads.** A vertical pane does what Claude and T3 Code do. Its head is opaque on the pane's surface, and content scrolls out of sight at the head's bottom edge. `ScrollPane` takes a `head` and draws its 1 px `border` hairline only while the body is scrolled from the top. Home's heading and query row are that head. The Inspector header keeps its rule at rest as well, because that rule continues the canvas bar's across the seam. The sidebar's bottom gradient is gone, and its last row has 32 px of room after it.
- **Sideways fades only where a row overflows sideways.** `scroll-fades-x` stays on the history strip. It runs off a scroll timeline, so an end fades only while there is more that way.
- **The checks.** `fade-cut.ts`, `test/fadeCut.test.ts` and verify's pixel scan are gone. `verify:7` reads each head through `paneHead`: its fill matches its surface, its rule shows only when it should, the scroller's clip starts at the head's bottom edge, no point of the head's band shows the scroller's content, and nothing from the scroller up carries a mask.
- **A hint never covers the name of what it acts on.** The sidebar's settle hint opened left over its own row and, by R7-28's rule, covered the title from its first letter. So it hid the name of the brainstorm it settles. It now opens right, over the main card. `hint-side` lets a sidebar hint open left or right and still fails up or down, over the rows beside it. `verify:7` checks the hint's rect misses the row title's and covers no other control.

### Round 8 fix pass: the head is its pane's surface (2026-11-07)

- **One surface at rest.** The pane head painted `card` whatever its pane sat on, so home's head was a white band over the grey `canvas` body, 255 over 246 in light and 43 over 35 in dark, with no rule at rest (R8-6). The head now paints no fill of its own and shows the surface its pane sits on, so home reads as one surface until its cards scroll. Nothing scrolls behind the head, so it needs no fill to hide anything. The Inspector header draws its own `card` fill over a `card` body, unchanged. `verify:7`'s `paneHead` compares the colour the head shows with the colour the body shows. The old check compared the head with the inset card, which is how the band passed.
- **The rail's count stands under its glyph.** Round 7 hung a corner badge off the rail's feedback button, ringed in the card's colour so it cut cleanly from the glyph (R7-22). In the 40 px rail it still sat over the speech bubble's tail, and it read as a notification dot over a chip (R8-21). The rail has no room to set a corner count clear of its glyph, so the button now stacks: the glyph, then the kit's `Count` in 11 px type under it, in a 28 by 32 px `icon-count` button that stays inside the head. Badge's `corner` size is gone. `verify:7` measures the count's box against the glyph's: no overlap, wholly below it, and both inside the head.

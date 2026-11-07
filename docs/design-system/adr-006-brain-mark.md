# ADR 006: The brain mark and the app icon

Status: accepted. Rob chose Lucide's brain on 2026-11-07, over a refined canvas pin, interlocking blocks and a folded "B". He asked for no tile behind it on Windows and Linux, so a taskbar shows just the brain, and for the teal tile to stay on macOS.

## Context

The installers need an app icon, and the app shipped with Electron's default. The in-app mark was a canvas-pin teardrop (ADR 001), which says what Brainstorm does but not what it is called. The brain says the name, and it reads at 16 px.

## Decision

One shape everywhere: `__iconNode` of `Brain` in `lucide-react`, 2-unit strokes on a 24-unit grid, round caps and joins. Nothing redraws it by hand, so the icon and the mark can't drift apart.

- **In the app**, `src/renderer/Mark.tsx` draws `<Brain>` in `text-accent`, so it follows the theme: `#0b7570` light, `#43c4b9` dark. The sidebar and the top bar show it at 20 px.
- **Windows and Linux** (`packaging/icon.svg`, `icon.png`, `icon.ico`) draw the brain on a transparent ground. One icon file can't follow the taskbar's theme, so its teal is the midpoint of the two accents, `#279d95`, which reads on a light and a dark taskbar alike.
- **macOS** (`packaging/icon-mac.svg`, `icon.icns`) draws a white brain on a light-accent tile: an 824 px rounded square with a 185 px radius inside the 1024 px canvas, which is Apple's grid. The brain is 600 px wide on it.

`npm run design:icon` (`scripts/design/icon.mjs`) writes every file in `packaging/` from the Lucide shape and the accent tokens. It renders with resvg, which uses no browser or system fonts, so a second run writes the same bytes. electron-builder finds the files by name.

## Consequences

- `MARK` is gone from `design.ts`; only `Mark.tsx` and the checkpoint's mark sheet drew it, and both draw the brain now. The feedback pins on the canvas are unchanged.
- Changing an accent token changes the app icon only after `npm run design:icon` runs again.
- A Lucide upgrade that redraws the brain changes the mark at once and the icon at the next `design:icon`.

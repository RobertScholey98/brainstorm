# ADR 003: The app draws its own window header

Status: accepted. Rob asked for it on 2026-11-06, during the round 2 fix pass, with T3 Code as the reference (`design-review/exemplars/t3/thread-dark.png`).

## Context

The window had the stock Windows title bar: a 40 px strip in the system accent colour that said "Brainstorm" a second time above the sidebar's own "Brainstorm", and held nothing else. Under it, the session top bar sat inside the inset card. So the top of the window spent 88 px on two bars, and the title bar's colour matched neither theme.

T3 Code has no system title bar. Its top row is the app's own: the sidebar toggle and the app name over the sidebar, then the breadcrumb, then panel toggles at the right, just before the native minimise, maximise and close buttons.

## Decision

### Frameless, with the native buttons kept

The window uses `titleBarStyle: "hidden"` and `titleBarOverlay`, so Windows still draws its own minimise, maximise and close buttons, with their snap layouts and keyboard behaviour, over the right end of the app's header. The overlay is 48 px tall, the header's height. Its colour is the `app` token and its symbols the `fg` token for the current theme, read from `solidColours()` in `src/core/design.ts`, the same source as every other colour.

When the OS theme changes, `nativeTheme` emits `updated` and the main process calls `setTitleBarOverlay` with the other theme's tokens. The page follows `prefers-color-scheme`, which Electron ties to the same setting, so theme sync needs no IPC and the renderer keeps its no-preload rule.

The minimum window size is 1100 × 720, the smallest size the brief designs for.

### The session top bar becomes the header

The session top bar moves out of the inset card and becomes the window header, on the app background at the window's top edge. A second bar under the header would repeat the 88 px problem, and the top bar's breadcrumb, iteration and request phase are what a window title should say anyway.

- **Left, over the sidebar.** The sidebar toggle, then the mark and "Brainstorm". When the sidebar is hidden, the toggle moves to the start of the header, as before.
- **Middle.** The breadcrumb, the iteration badge and the request phase, unchanged.
- **Right.** Regenerate and Export, then the right panel toggle, which collapses the Inspector to its rail and back (X4). It is pressed while the Inspector shows, as T3 Code marks an open panel. It replaces the Inspector toggle that was at the end of the canvas bar, so there is one control for one action.
- **Room for the native buttons.** The header's right padding is the width the browser reports outside the titlebar area (`env(titlebar-area-x)` and `env(titlebar-area-width)`), so the last control never slides under the overlay at any width or scale. Without an overlay, in a browser, it falls back to 12 px.

The request strip (send failed, thread lost, no change) stays at the top of the card, under the header, because it belongs to the page, not the window.

### Moving the window

The header and the sidebar's header row carry `data-drag-region`, which sets `-webkit-app-region: drag`. One CSS rule gives every link, button, input, tab and focusable element inside a drag region `no-drag`, so a control added to the header later can't turn into a drag handle by accident.

## Consequences

- Page screenshots stop at the web contents and can't show the native buttons. The capture's `window-title-bar` shot is taken from the screen instead, of a window with no viewport emulation, sized and themed through Electron.
- `verify:7` checks that the header and sidebar header drag and every control in them doesn't, that the Inspector toggle sits in the header, that the overlay leaves the last control clear, that the page fills the window's content area after two resizes, and that the window stops at 1100 × 720.
- A white band at the right and bottom of a window comes from Playwright's viewport emulation in a capture or verify run, which pins the page to 1440 × 900 inside whatever the window is. A real launch, and the verify check above, track the window.

## Rejected

- **Keeping the top bar inside the card, under a thin drag strip.** Two rows again, with the strip holding only the native buttons.
- **Custom-drawn window buttons.** They would lose Windows' snap layouts and its own hover and press behaviour.
- **A preload to send theme changes to the renderer.** `nativeTheme` and `prefers-color-scheme` already agree, and the window-security rules forbid a preload.

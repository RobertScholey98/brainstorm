# ADR 002: The stage view and its page-width rule

Status: accepted. Rob asked for the stage view in the round 2 brief (`design-review/round-2/brief.md`, S1), replacing the "Fit" zoom he had logged as X1.

## Context

The canvas showed every slot side by side. At 1100 px that left one frame on screen and the rest behind a horizontal scroll, and the selected frame could sit off-screen (GS2-1). A 980 px frame never fit a 1440 px window beside both sidebars, so the canvas always scrolled sideways for it (W4, V2). Rob mostly looks at one slot at a time and wanted that to be the default, with the side-by-side board one click away.

A frame's width is part of the agent's contract (`frame.width` in `brainstorm.json`, 240 to 1920). A block is written for that width, so the canvas must never lay it out at another one. Reflowing a 980 px design into 800 px would show Rob something the agent never built.

## Decision

### Two views

- **Stage**, the default. One slot at a time, centred in the space between the sidebar and the Inspector. A bar above the canvas holds previous and next buttons, one tab per slot, and "All slots". The tabs are a Base UI `Tabs` list with arrow-key activation, so left and right move between slots.
- **Board.** Every slot side by side in manifest order, as before. "All slots" is a pressed toggle; pressing it again returns to the stage.

The view and the current slot are kept per brainstorm in `ui_pref` (`canvas.<sessionId>`), so a brainstorm reopens the way Rob left it, across restarts. A brainstorm with no entry opens on the stage at its first slot. Export always writes the board, because a file has no bar to switch slots with.

### The page-width rule

A frame always lays out at its declared `frame.width`. On the stage:

- The room is the canvas iframe's client width less 24 px each side.
- A frame narrower than the room is centred at its own width, at 100%.
- A frame as wide as the room or wider is scaled down to the room with CSS `zoom` (room ÷ width). Its title shows the scale as a percentage, such as "83%", so Rob never mistakes a scaled frame for the real size.
- The stage never scrolls sideways. It scrolls down when a frame is taller than the canvas.

On the board nothing scales. A frame wider than the canvas scrolls there, as before, and never sits under the Inspector.

Measured in the round 3 capture, with the panes at their default widths for each window size (the sidebar starts at 240 px below 1280):

| Frame | Stage at 1440 | Stage at 1100 |
| --- | --- | --- |
| 390 px | centred at 100% | centred at 100% |
| 980 px | 83% | 53% |
| 1440 px | 57% | 36% |

### Why zoom, not transform

`zoom` changes layout size, so the frame body's box is the scaled size and the canvas scrollbars, centring and sticky title all follow it. A `transform: scale()` leaves the unscaled box in layout, which would bring back the sideways scroll the stage exists to remove. Pins are chrome, not design, so they keep one size at any zoom. A pin stays inside the frame body, so it scrolls and clips with it, and takes `zoom: 1 / scale` itself, so its 20 px face and 26 px hit area are screen pixels. The runtime places it in viewport pixels from the body's corner, scaling the body's own scroll offsets by its measured scale (`getBoundingClientRect().width ÷ offsetWidth`), so a pin stays on its element at any zoom. Round 4 found pins shrinking to 13 px on the 64% board before this.

### What keeps working

The frames for the slots that aren't on the stage stay mounted, fixed and hidden (`visibility: hidden`, `aria-hidden`). Their blocks keep their state, a block error still reaches the sidebar, and pin placement still reports placed and detached for every pin. Pick mode, the composer, Regenerate's "Selected blocks" default, block errors and pin pulses work in both views. Clicking a feedback item whose slot isn't on the stage moves the stage to it first.

## Consequences

- `HostToFrame` `state` carries `stage: SlotId | null`. Null is the board. `docs/design.md` records it under Canvas.
- A scaled frame's text is smaller than it will be in the product. The percentage readout says so, and the board or a wider window shows it at full size.
- `verify:7` checks the stage is the default, the tabs and arrows, a 980 px frame at 83% at 1440 and scaled again at 1100 (49% there, where the sidebar keeps its 288 px from launch), with no sideways scroll, the board fitting two 390 px frames at 1440, and a pin on its element in both views.

## Rejected

- **Fit to height as well.** A tall phone frame would shrink to an unreadable size to fit 900 px. The stage scrolls down instead.
- **Reflowing a wide frame to the room.** It breaks the width contract with the agent.
- **A free zoom control.** Nothing in the brief needs one, and a fixed rule means a frame looks the same every time Rob opens it.

## Amendment: round 3, second pass. The board fits too

The round 3 council found the board still scrolled sideways once the window narrowed (U21, U35): at 1100 px beside the Inspector, a third frame peeked in as a sliver and two phone frames ran under the canvas edge. The soft edge cue that said "more this way" (U36) was a patch over that. The fix is one fit rule for both views, in `src/canvas/fit.ts`, with its cases in `test/fit.test.ts`.

| | Before | After |
| --- | --- | --- |
| Board, row too wide | scrolls sideways at full size | every frame takes one `zoom` so the row fits the room |
| Board, row needs below 50% | scrolls sideways | wraps into rows at full size, each frame zoomed only if it alone is wider than the room |
| Stage | zoomed to the room | unchanged |
| Scale readout | in the frame title, stage only | a `Badge` in the canvas bar for the selected frame, with a hint naming Ctrl+B and the Inspector toggle |
| Edge cue | 8 px fade at a side with more to scroll | removed, since nothing scrolls sideways |
| View switch | "All slots" toggle, always shown | a One slot / All slots `Segmented` switch, shown only with two or more slots |
| Reveal on select | `nearest`, so the label could sit flush under the bar | stops 24 px short (`scroll-margin`), so a label sits as far off the bar in both views (U49) |

Half size is the floor because below it a phone frame's 13 px text renders under 7 px, which is no longer a preview. The board measures its room without the scrollbar gutter, since only the stage pads its left by it to centre.

`verify:7` now checks: with one slot there is no view switch; the stage readout is in the bar (83% at 1440, 49% at 1100); two 390 px frames fit at full size at 1440 and at one zoom in one row at 1100 beside the Inspector (58% there), with no sideways scroll and the pin on its element; a frame's label is 24 px under the bar in both views; and pick mode's hint sits in the bar.

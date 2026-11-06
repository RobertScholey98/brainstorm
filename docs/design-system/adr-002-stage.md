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

Measured with both sidebars at their default widths:

| Frame | Stage at 1440 | Stage at 1100 |
| --- | --- | --- |
| 390 px | centred at 100% | centred at 100% |
| 980 px | 83% | 49% |
| 1440 px | 56% | 34% |

### Why zoom, not transform

`zoom` changes layout size, so the frame body's box is the scaled size and the canvas scrollbars, centring and sticky title all follow it. A `transform: scale()` leaves the unscaled box in layout, which would bring back the sideways scroll the stage exists to remove. Pins are placed inside the frame body, so the runtime divides its rect deltas by the body's measured scale (`getBoundingClientRect().width ÷ offsetWidth`) and a pin stays on its element at any zoom.

### What keeps working

The frames for the slots that aren't on the stage stay mounted, fixed and hidden (`visibility: hidden`, `aria-hidden`). Their blocks keep their state, a block error still reaches the sidebar, and pin placement still reports placed and detached for every pin. Pick mode, the composer, Regenerate's "Selected blocks" default, block errors and pin pulses work in both views. Clicking a feedback item whose slot isn't on the stage moves the stage to it first.

## Consequences

- `HostToFrame` `state` carries `stage: SlotId | null`. Null is the board. `docs/design.md` records it under Canvas.
- A scaled frame's text is smaller than it will be in the product. The percentage readout says so, and the board or a wider window shows it at full size.
- `verify:7` checks the stage is the default, the tabs and arrows, a 980 px frame at 83% and 49% with no sideways scroll, the board fitting two 390 px frames at 1440, and a pin on its element in both views.

## Rejected

- **Fit to height as well.** A tall phone frame would shrink to an unreadable size to fit 900 px. The stage scrolls down instead.
- **Reflowing a wide frame to the room.** It breaks the width contract with the agent.
- **A free zoom control.** Nothing in the brief needs one, and a fixed rule means a frame looks the same every time Rob opens it.

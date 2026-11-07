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

## Amendment: round 4. One gutter rule

The round 4 council found the stage frame 5 px left of centre whenever it didn't scroll (U57, reopened as T4), and the board's readout moving from 64% to 63% when a strip brought in the scrollbar. The stage padded its left by a measured gutter that was only there when the scrollbar was, and the room counted the gutter in one view and not the other.

The canvas root now keeps the scrollbar's gutter on both sides (`scrollbar-gutter: stable both-edges`), and `#canvas` pads each side by 24 px less the gutter, `--bs-scrollbar` from `design.ts`. So in both views the room is the window less 24 px a side, a frame's sides sit 24 px off the canvas edges whether or not it scrolls, and nothing is measured. Fixed boxes start after the left gutter, so the pick highlight is placed from a zero-size fixed probe's origin. `verify:7` checks a stage frame that doesn't scroll sits 24 px off each side, and one that scrolls sits centred.

## Amendment: round 4. A scrolling frame's bar sits outside its width

The council found a 390 × 600 phone frame laying its block out at 380 px, because the body's own scrollbar took its 10 px from inside the declared width, and the bar drawn at the frame's zoom, about 6 px wide (T7). A frame lays out at its declared width, always, so the bar can't come out of it.

The runtime watches each frame with a declared height, and while its block is taller than that height the body widens by the gutter, `SCROLLBAR` from `design.ts`, outside the zoom. Its scrollbar is drawn at the gutter divided by the zoom, so it shows 10 px at any fit, and the fit rules count the gutter as width no zoom scales. A frame whose block fits shows no gutter. `verify:2` grows the wheel's block past its 760 px and checks the block keeps 390 px with a 10 px bar, zoomed and not, and that the gutter goes once it fits again.

## Amendment: round 4. A wrapped board centres its rows and says what is below

At 1100 a three-slot board wraps at full size, and its first screen showed one frame hugging the left with nothing to say two more waited below (T16). A wrapped board now centres each row, as the stage centres its frame, and the runtime tells the host how many board frames sit wholly below the window; the canvas bar shows that count as a chip ("2 more below") until they scroll into view. `verify:2` adds a third slot, checks the wrapped rows centre and the bar counts two below, and that the count goes once they are in view.

## Amendment: round 5. The board is one row at any size

Status: accepted. Rob ruled R5-71 from the brief on 2026-11-06: the "All slots" board exists "so the whole flow is still visible at a glance".

The round 5 council found that at 1100 with three slots, All slots showed what One slot shows (SD5-14). Three 390 px frames beside the Inspector need 41% to share a row, under the 50% floor, so the board wrapped to one full-size frame per row, and only the "2 more below" chip said it differed from the stage.

The floor is gone. The board always fits every frame in one row at one zoom, however small that makes them. The floor guarded legibility, and the board isn't where Rob reads a frame: the stage is, one click away, at full size or zoomed only to the room. Pins keep their screen size at any zoom, so pinning and picking still work on a small board.

| | Before | After |
| --- | --- | --- |
| Board, row needs below 50% | wraps into rows at full size, rows centred | one row at the zoom that fits it |
| Three phone slots at 1100 beside the Inspector | one per row | side by side at 41% |
| "2 more below" chip | counted board frames under the fold | removed, since a board never has any |

`fitFrames` returns only the zooms now, and the frame-to-host `below` message is gone with the chip. `test/fit.test.ts` holds three phones at 41% at the minimum window and a desktop frame between two phones at 20%, and `verify:2` checks that at 1100 the three-slot board sits in one row inside the canvas with no sideways scroll.

## Amendment: round 6. A pixel of rounding is not a scrolling frame

The fix pass found the 980 × 360 stage frame resting at two zooms at 1100, 0.5347 or 0.5245, by the order the window was sized in (R6-68). Under the 0.5347 zoom the frame body's heights round at the zoomed size, so a block that exactly fills its 360 px read 361. The runtime counted that pixel as a block taller than its frame and added the 10 px gutter. The gutter lowered the zoom to 0.5245, where the block read 360 again, and nothing measured it again until the block changed size. So the fit kept whichever answer it reached first, and the bar could name the other.

A frame now scrolls only when its block is more than one pixel taller than its declared height, and a body that doesn't scroll clips rather than drawing a scrollbar of its own inside the declared width. The scroll test no longer depends on the zoom it feeds, so the fit has one resting point. `verify:7` sizes the window to 1100 three times from 1440 and checks it lands on 0.534694 each time, with the bar reading 53%.

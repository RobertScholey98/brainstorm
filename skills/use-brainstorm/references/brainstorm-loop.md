# The Brainstorm loop

Brainstorm stores sessions in its own database. You edit a disposable working copy that `pull` writes and `commit` reads, and `commit` validates everything before it saves anything. Rob's control values, variant choices and feedback live in the app, never in the working copy.

## Commands

```
brainstorm session new     --title <t> [--brief -|<text>] [--thread <id>] [--project <path>] [--system <id|name>]
brainstorm session list    [--thread <id>]                 # sessions in the thread's project
brainstorm session attach  <id|title> [--thread <id>]
brainstorm context         <session> [--thread <id>]
brainstorm pull            <session> [--out <dir>]          # default .brainstorm/<session>
brainstorm validate        <session> [--from <dir>]
brainstorm commit          <session> [--from <dir>] [--thread <id>] [--addresses 4,7] [--note <text>]
brainstorm system list                                     # design systems Brainstorm has synced
brainstorm system sync     <system>                         # after the library changes
```

- `--thread` defaults to `$T3CODE_THREAD_ID`. Leave it off.
- Pass `--out .brainstorm/<session>` to `pull` and `--from .brainstorm/<session>` to `commit` and `validate`, run from the repo root, so both name the same folder.
- Text output is compiler-style and enough to act on. Add `--json` when you need a field exactly. It prints one `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", … } }`.
- Exit codes are 0 for ok, 1 when the server rejected the request, 2 for bad usage and 3 when the app is unavailable. On 3, or if `brainstorm` is not on PATH, tell the user in one line that Brainstorm isn't reachable and stop.
- `validate` runs the same checks as `commit` without saving. `commit` saves nothing when a check fails, so committing directly is fine.

Starting a session with the brief on stdin:

```bash
brainstorm session new --title "Start an agent task" --brief - <<'EOF'
# Start an agent task
...
EOF
```

```powershell
@'
# Start an agent task
...
'@ | brainstorm session new --title "Start an agent task" --brief -
```

The output names the session id (`s_…`). Use it in every later command.

## Working copy

```
.brainstorm/<session>/
  .gitignore                          written by pull
  GUIDE.md                            generated block-format reference
  brainstorm.json                     edit only "slots"
  slots/<slot>/<variant>/block.tsx      required; the folder path is the block id "<slot>/<variant>"
  slots/<slot>/<variant>/block.json     required; title and props schema
  slots/<slot>/<variant>/block.css      optional; scoped to the block
  slots/<slot>/<variant>/controls.json  optional; absent means one control per appearance prop
```

`GUIDE.md` is generated from the code that validates your commit. Where it and this file disagree, follow `GUIDE.md`.

- `brainstorm.json` `slots` is `[{ "id": "start-dialog", "title": "Start a task", "frame": { "width": 560, "height": 520 } }]`, in canvas order. `frame.width` is 240 to 1920, and `height` is optional.
- Slot and variant ids are kebab-case (`^[a-z][a-z0-9-]{0,31}$`). Every slot folder is listed in `slots`, and every listed slot has at least one variant.
- Any other file is an error. A block is self-contained, so there are no shared modules or fixture files. There are no notes beside a variant either: the design carries its hypothesis, and Rob judges it on the canvas.
- `pull` replaces `slots/` wholesale. Always pull into a fresh copy at the start of a turn.

## Block files

[`references/example/slots/start-dialog/missing-only/`](example/slots/start-dialog/missing-only/) is a complete, valid variant. Start from it.

**`block.tsx`** default-exports a function component. It receives one flat props object of data samples, appearance defaults and Rob's applicable overrides.
- Import only from `react`. Types are stripped, not checked.
- It must render without throwing with defaults and with Rob's overrides. Touch `window` and `document` only inside effects and handlers.
- Never write `data-bid`. The host wraps every block in `<div data-bid="<slot>/<variant>">`.

**`block.json`** is `{ "title": "…", "props": { "data": {…}, "appearance": {…} } }`. The schema is parsed, never run.
- `data` props are what the block shows: `{ "type": "data", "description": "…", "sample": … }`. Rob can't change them.
- `appearance` props are what Rob adjusts. The types are `number` (`default`, `min` < `max`, optional `step` and `unit`), `color` (`#rrggbb`), `enum` (unique `options` containing `default`), `boolean` and `text` (`multiline`). Each has a `label`.
- Prop names are camelCase, and no name is in both groups.

**`block.css`** is wrapped in `@scope ([data-bid="<slot>/<variant>"])`, so write selectors relative to the block.

**`controls.json`** is optional. Leave it out unless the controls need grouping or ordering that the schema order doesn't give. An explicit spec uses `Section`, `Slider`, `Select`, `Segmented`, `Colour`, `Toggle` and `Text`, each value bound with `{ "$bindState": "/<prop>" }` to an appearance prop of the matching type. `context` prints the full vocabulary.

## Mapping options onto blocks

- **Slot.** A region of the task's screen whose alternatives Rob can choose independently: the entry point, the dialog, the result. When a hypothesis reshapes several regions together, those regions are one slot.
- **Variant.** One UX hypothesis for its slot. Name it for the hypothesis (`missing-only`, `guided-steps`), never `a` to `e`. The slot that carries the task's main decision gets the full set of hypotheses. Other slots get a variant per real hypothesis, which is often one.
- **Appearance props.** What Rob will want to tweak: accent, density, corner radius, the copy of key labels, toggles for optional elements. Colour, card shape and density are props, never separate variants.
- **Situation.** When a state changes the task (no project inferred, launch fails), add an enum appearance prop `situation` with the same options in every variant of the slot, so Rob compares variants in the same state.
- **Fixtures.** The `data` samples are the illustrative data. Give every variant of a slot the same samples, realistic and long enough to wrap. No variant gets better content.
- **Interaction.** Hold the task's state in `useState` and make every enabled control do something. Run the path through to the useful outcome, including retained drafts, failure and recovery. Start timers in effects and clear them in the cleanup.
- **Product look.** Read the product's tokens, CSS and components from the repo, and copy their values into `block.css` or inline styles, since blocks can't import them. Set `frame.width` from the product's real surface. The canvas has no network, so use the product's font stack as system fonts and draw images as inline SVG or `data:` URIs.

## Marking parts

Rob pins feedback to elements with a `data-part`, and pins find their element again by that name after a regenerate.

- Put a `data-part` on every element Rob might comment on: headings, fields, buttons, messages, list items and the containers that group them.
- Name the role, in kebab-case: `start-button`, `recipient`, `launch-error`. For repeated items, use a stable key from the data: `` `project-${p.id}` ``.
- Each name is unique within one render of the block.
- Keep names across regenerations. When you redesign an element, the new version keeps the old name.

## Responses

Errors mean nothing was saved:

| Code | Do this |
|---|---|
| `validation_failed` | Fix every listed issue, then commit again. |
| `stale_working_copy` | Another commit landed after your pull. Run `context` and `pull` again, then redo your change. |
| `thread_not_attached` | Another thread owns the session. Tell the user which one in one line and stop. Attach back only when the user asks. |
| `wrong_project` | The session belongs to another T3 project. Tell the user in one line and stop. |
| `ambiguous_title` | Show the user the candidates and ask which session they mean. |
| `usage` | Fix the command. A missing thread means you are outside a T3 thread. |

Warnings arrive with a saved iteration. Fix the ones you caused and commit again:

| Warning | Do this |
|---|---|
| `pin_lost` | An open pin's `data-part` no longer renders. Restore that name on the element it belonged to. If the feedback asked to remove the element, say so in the reply instead. |
| `override_dropped` | One of Rob's values no longer fits its prop. Restore the prop's name and type, and a range or options containing his value. If the request asked for the change, say so in the reply instead. |
| `out_of_scope` | You changed a block outside the request's scope. Undo that edit, unless the free text asked for it. |
| `not_addressed` | Requested feedback isn't in `--addresses`. Address it and include its id, or say in the reply why it stays open. |
| `duplicate_part` | Two elements share a `data-part` in one render. Make the names unique. |
| `uncontrolled_prop` | An explicit `controls.json` misses an appearance prop. Add the control, or delete `controls.json`. |
| `vary_mismatch` | A vary request's new variant is missing, has another title, or lacks the target `data-part`. Add the folder under the key `context` named, set that title, or restore the part. |

A commit that changes nothing and addresses nothing new returns the latest iteration with `created: false`. That is a safe replay.

## Design systems

A session made with `--system` builds only with that design system, so every design can be built from the real library. `pull` adds `system/CATALOG.md`, which lists each component with its stories, and `system/stories/`, which holds the story sources. Read both before writing a block; commit ignores the folder.

- A block imports components from `"kit"` and composes them: `import { Card, Button, Stack, Text } from "kit"`. Lay out with `Stack`, `Grid` and `Box`, and write text with `Text` and `Heading`. Their spacing and size props take steps on the system's scale.
- A block writes no HTML tags, no `className` or `style`, and no `block.css`. Pins need a `data-part`; pass it to the kit's primitives, which forward `data-*` props.
- When the kit has nothing that fits, write a proposed component in `proposed/<Name>/`: `component.tsx` (default export), `component.json` (`{ "title", "description", "example" }`) and an optional `component.css`. A block imports it as `import ChoreList from "proposed/ChoreList"`. Rob sees it labelled "not in system" and can promote it into the library.
- A proposed component may write HTML, but only with classes the kit's CSS defines, and in `component.css` only the kit's token variables and the values the catalog lists. Prefer the kit's components inside it.
- Once the kit exports a component by a proposed component's name, after Rob upgrades the session to that version, import it from `"kit"` and delete the proposed folder.

| Code | What to do |
| --- | --- |
| `raw_element` | A block writes an HTML tag. Use the kit's component for it, or a proposed component. |
| `style_prop` | A block passes `className` or `style`, or a proposed component passes `style`. Pick a prop or variant of the kit's component, or move the style into `component.css`. |
| `css_in_system` | Delete the block's `block.css`. |
| `unknown_component` | The kit has no export by that name. Check the catalog. |
| `unknown_proposed` | A block imports a proposed component with no folder. Write it, or fix the name. |
| `unknown_class`, `dynamic_class` | A proposed component uses a class the kit doesn't define, or builds one from an expression. Write literal kit classes, or a rule in `component.css`. |
| `off_scale_value` | A value in `component.css` is off the kit's scales. Use the value the message suggests, or read a token. |
| `unused_proposed` | No block imports the proposed component. Import it, or delete its folder. |

## Requests

```
[brainstorm] session s_8f2k3a · request 5 · scope: wheel/neon, result/sheet · feedback: #4 #7 · freetext: "make the spin feel less random"
Handle with the use-brainstorm skill: run `brainstorm context s_8f2k3a`.
```

`context` is the source of truth for the request, not the message. It gives the scope, the free text, each requested feedback item with its block, part, text and history, Rob's applicable overrides on in-scope blocks, all open and addressed feedback, the control vocabulary, and the exact `next` commands to run.

- **Scope** is `all`, a list of block ids, `described`, where the free text names the blocks, or `vary`. Change only those blocks. Add a slot or variant only when the request asks for one.
- **Feedback.** Pass the ids you addressed as `--addresses 4,7`, without `#`. Rob confirms them in the app.
- **Note.** Add `--note "<one sentence on what changed>"`.

## Vary

```
[brainstorm] session s_8f2k3a · request 6 · scope: vary wheel/neon [spin-button] as spin-button-a, spin-button-b, spin-button-c · freetext: "bolder"
```

Rob picked one element and asked for new variants of its slot that differ only there. `context` names the target block, its `data-part` (or the whole block when there is none), and each new variant as `new variant <slot>/<key> titled "<title>"`. The free text, when there is one, is the direction.

- Copy the target's folder to `slots/<slot>/<key>/` once per new variant, and set each copy's `block.json` `title` to the title `context` gave.
- Change only the target part in each copy, each copy in its own way. Keep its `data-part` name and everything around it as it is.
- Rob's overrides on the target are in scope. Write them into each copy's `block.json` as the props' defaults, so the copies start from what Rob sees.
- Leave the target and every other variant unchanged. The commit warns `out_of_scope` for any other block, and `vary_mismatch` for a missing variant, another title or a missing part.

## Forks

```
[brainstorm] session s_q7d1m0 · request 1 · fork of s_8f2k3a iteration 4 · scope: all · feedback: #1 · freetext: "try a calmer wheel for mornings"
Handle with the use-brainstorm skill: this thread is new, so run `brainstorm session attach s_q7d1m0`, then `brainstorm context s_q7d1m0`.
```

A fork is a new brainstorm, linked to its parent, in a new thread. `context` adds a `fork of` line and one `baked default <block> <prop> = <value>` line for each of Rob's settings that became a default. Rob's later requests to the fork arrive as ordinary requests.

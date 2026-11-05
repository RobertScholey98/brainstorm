# Brainstorm v0.1 design

This is the contract every implementation unit builds against. The product spec is the handoff brief (`docs/brief.md`). This file records the shape chosen for it. When code and this file disagree, either fix the code or change this file in the same commit, and say why.

## Decisions that differ from the brief

| Brief | Here | Why |
|---|---|---|
| `--project <path>` identifies a session's project | The project is `thread.projectId` from `t3 thread show <thread>`. A path is recorded but never trusted. | Agents run in git worktrees, whose paths differ from the repo root. |
| `session.attachedThreadId` | The current attachment is the `attachment` row with `detached_at IS NULL` | One table for history and current, with one source of truth. |
| A commit drops overrides that no longer fit | Overrides are never deleted by a commit. Whether one applies is derived on read. Rob dismisses the ones that don't. | Commits never write Rob's rows, and reconciliation can't half-run. The flag Rob sees is the same. |
| `feedback.status`, `addressedIn`, `iteration.addressedFeedbackIds` | `feedback_event` log, folded into a status | The agent and Rob both change feedback state. An append-only log keeps one fact in one place and gives history for free. |
| `block` rows per iteration | Content-addressed `block_content` plus `iteration_block` | "Diff, don't trust" becomes a hash comparison, and unchanged blocks are never re-checked. |
| `catalog.prompt()` is the agent's control vocabulary | `controlVocabulary()` is generated from the same catalog definitions | `catalog.prompt()` is 15k characters of JSONL-patch streaming instructions, wrong for writing a file. |
| `AgentBridge.onReply` | `send` plus `snapshot`. Replies arrive as commits through our API. | The T3 CLI has no push. |
| Variant switch in the control catalog | `Segmented` control for enum props. Slot variant switching is app chrome. | A block can't see its sibling variants. |
| Every flag is required | `--thread` defaults to `$T3CODE_THREAD_ID`, and `--out` to `.brainstorm/<session>` | Fewer things for an agent to quote in PowerShell. The server still requires a thread on every write. |

## Process topology

| Process | Owns | Talks over |
|---|---|---|
| Electron main (`src/electron/main.ts`) | Starts the server in-process and opens one window. Single-instance lock, external links open in the browser. | Imports `startServer` from `src/server`. It is the only file that imports `electron`. |
| Server (`src/server`, plain Node) | HTTP API, SQLite, the request tracker, the AgentBridge, the export writer, and static serving of the renderer and the canvas page | HTTP on 127.0.0.1 |
| Check worker (`src/core/check/worker.ts`, `worker_threads`) | sucrase compile and the render probe inside `vm` | Strings in, results out. Killed after 3 s per block. |
| Renderer (`src/renderer`, React app) | Session picker, canvas host, controls panel, feedback, regenerate | `fetch` to `/v1/ui/*` with the UI token, plus SSE on `/v1/ui/events` |
| Canvas frame (`/canvas`, `<iframe sandbox="allow-scripts">`) | Runs block code | `postMessage` only. Opaque origin `null`. |
| `brainstorm` CLI (`src/cli`, plain Node) | Args, defaults, reading and writing the working copy as a `FileMap`, starting the app | `fetch` to `/v1/agent/*` with the agent token |

`node dist/server/headless.js` runs the server with no Electron, for tests and for Playwright in plain Chromium. Electron adds a window around the same server.

**Window security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and no preload. Electron loads `http://127.0.0.1:<port>/#ui=<uiToken>`. `setWindowOpenHandler` opens http(s) links externally and denies new windows. `will-frame-navigate` blocks any navigation off the app origin, in the window or in the canvas frame, which `will-navigate` alone wouldn't see. Permission requests are denied, and there is no application menu, so no reload drops the in-memory UI token. Electron's profile lives in `<BRAINSTORM_HOME>\electron`, which also scopes the single-instance lock to one home.

**API security.** The server binds 127.0.0.1 only on a random port. It rejects a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, and an `Origin` that is present and not its own (that also rejects the canvas frame's `null`). `/v1/agent/*` needs `Authorization: Bearer <agentToken>`, and `/v1/ui/*` needs `Bearer <uiToken>`. The tokens are separate, so an agent can't set overrides or confirm feedback. Compare tokens in constant time. `GET /health` needs no token. `/v1/ui/events` needs the bearer header too, so the renderer reads it with `fetch`, not `EventSource`.

**App data.** `BRAINSTORM_HOME` overrides the default `%APPDATA%\brainstorm\`. It holds:
- `brainstorm.db`
- `exports\`
- `api.json` with `{ port, agentToken, pid, version, startedAt }`, written atomically (temp file, then rename) on every start. The UI token is never written to disk.

## The agent-facing contract

### Working copy

`pull` writes it and `commit --from` reads it. The CLI moves it over the wire as a `FileMap` (relative POSIX path to UTF-8 text). Only `src/core/workingCopy.ts` knows the layout, in both directions (`emitWorkingCopy`, `parseWorkingCopy`).

```
<dir>/
  .gitignore                          "*"  written by pull, ignored on commit
  GUIDE.md                            generated block-format reference, ignored on commit
  brainstorm.json                     { "format": 1, "session": "s_8f2k3a", "base": 4,
                                        "slots": [ { "id": "wheel", "title": "The wheel", "frame": { "width": 390, "height": 760 } } ] }
  slots/<slot>/<variant>/block.tsx      required. The directory path is the block id "<slot>/<variant>".
  slots/<slot>/<variant>/block.json     required. { "title": "Neon wheel", "props": { "data": {…}, "appearance": {…} } }
  slots/<slot>/<variant>/block.css      optional. Served wrapped in @scope ([data-bid="<slot>/<variant>"]).
  slots/<slot>/<variant>/controls.json  optional. A json-render spec; absent means derived.
  slots/<slot>/<variant>/about.md       optional. Hypothesis, tradeoff and what to try, shown beside the variant switch.
```

Rules (each failure is an `Issue` keyed by file):
- Slot and variant ids are kebab-case (`^[a-z][a-z0-9-]{0,31}$`). Every `slots/<slot>` directory appears in `brainstorm.json` `slots`, and every listed slot has at least one variant.
- Any other file is an error, so a helper the agent expects to import isn't silently dropped.
- `frame.width` is 240–1920 (default 390). `frame.height` is optional (auto).
- `base` is the iteration the copy was pulled from (`null` for an empty session). A commit whose base is behind the latest iteration fails with `stale_working_copy`.

### Props schema (`block.json` `props`)

The schema is declarative JSON. It is parsed, never executed.

```jsonc
{
  "data": {         // data inputs: what the block shows. Not controllable in v0.1; later versions attach data flow here.
    "people": { "type": "data", "description": "household members", "sample": [{ "name": "Kai" }, { "name": "Roz" }] }
  },
  "appearance": {   // what Rob adjusts. Every appearance prop is controllable and overridable.
    "spinSeconds": { "type": "number", "label": "Spin time", "default": 1.5, "min": 0.3, "max": 5, "step": 0.1, "unit": "s" },
    "accent":      { "type": "color",  "label": "Accent", "default": "#ff2bd6" },
    "density":     { "type": "enum",   "label": "Density", "default": "roomy", "options": ["compact", "roomy"] },
    "showOdds":    { "type": "boolean","label": "Show odds", "default": true },
    "headline":    { "type": "text",   "label": "Headline", "default": "Who's up?", "multiline": false }
  }
}
```

- Prop names are camelCase identifiers. Data and appearance names are disjoint, because the component receives one flat props object.
- `number` needs `min < max`, with `default` inside the range. `enum` needs non-empty unique `options`, with `default` among them. `color` is `#rrggbb`.
- **One compatibility rule.** `parseAppearanceValue(spec, value)` validates Rob's writes, and the same function decides on read whether a stored override still applies. A mismatch is one of `prop_removed`, `type_changed`, `out_of_range`, `option_removed` or `block_removed`.

### Block module (`block.tsx`)

```tsx
import { useState } from "react";
export default function Wheel({ people, spinSeconds, accent, density }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <div className="wheel" style={{ "--accent": accent }}>
      {people.map((p) => <span key={p.name} data-part={`slice-${p.name}`}>{p.name}</span>)}
      <button data-part="spin-button" onClick={() => setSpinning(true)}>Spin</button>
    </div>
  );
}
```

- It is a default-exported function component that receives `data samples ⊕ appearance defaults ⊕ applicable overrides` as flat props.
- It may import only `react` (sucrase's automatic runtime adds `react/jsx-runtime`). TypeScript types are stripped, not checked.
- It must render without throwing under the render probe with defaults, and again with Rob's applicable overrides. No `window` or `document` during render, but effects are fine.
- It marks meaningful elements with `data-part`, unique within the block's render. The host wraps the block in `<div data-bid="<slot>/<variant>" style="display:contents">`, so blocks never write `data-bid`.

### Controls spec (`controls.json`)

A json-render spec over a fixed catalog (`src/core/controls.ts`, `defineCatalog`):

| Component | Props | Binds to |
|---|---|---|
| `Section` | `{ title: string \| null }` with children | none |
| `Slider` | `{ label: string \| null, value: { $bindState: "/<prop>" } }` | `number` |
| `Select`, `Segmented` | same | `enum` |
| `Colour` | same | `color` |
| `Toggle` | same | `boolean` |
| `Text` | same | `text` |

- Range, step, unit and options always come from the prop spec, never from the control, so a slider can't disagree with its prop.
- Validation runs `validateSpec`, then `catalog.validate` (normalize every element to `children: []` first), then each element's props against the catalog's own zod schemas (`catalog.validate` checks only structure and type names), then the binding check. That check requires every `$bindState` to target an appearance prop, with a control kind that matches the prop type.
- An explicit spec that leaves an appearance prop without a control gets an `uncontrolled_prop` warning.
- Absent `controls.json` means `deriveControls(schema)` makes one `Section` titled with the block title, holding one control per appearance prop in schema order (enum with up to 3 options → `Segmented`, otherwise `Select`).

### CLI

Every command takes `--json`. Text output is compiler-style. `--json` prints exactly one `Result<T>`: `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", … } }`. Exit codes are 0 for ok, 1 when the server rejected the request, 2 for bad usage and 3 when the app is unavailable.

```
brainstorm session new     --title <t> [--brief -|<text>] [--thread <id>] [--project <path>]
brainstorm session list    [--thread <id>]                 # sessions in the thread's project
brainstorm session attach  <id|title> [--thread <id>]
brainstorm context         <session> [--thread <id>]
brainstorm pull            <session> [--out <dir>]          # default .brainstorm/<session>
brainstorm validate        <session> [--from <dir>] [--thread <id>]
brainstorm commit          <session> [--from <dir>] [--thread <id>] [--addresses 4,7] [--note <text>]
```

- **Startup.** The CLI reads `api.json` and checks `/health` (which must report the pid in `api.json`). If that fails, it starts the app detached behind a `start.lock`, resolved from the CLI's own install path, then waits up to 20 s for a fresh `api.json` with a healthy server. The app is `electron <repoRoot>`, with electron resolved from the repo's `node_modules` and `ELECTRON_RUN_AS_NODE` removed from its environment, since an agent inside an Electron host such as T3 can inherit it. `BRAINSTORM_APP=headless` runs `node dist/server/headless.js` instead, for tests. Only the server's stderr goes to `server.log`, because its stdout carries the UI token.
- **`--thread`** defaults to `$T3CODE_THREAD_ID`. A command that needs a thread and has none fails with a `usage` error that names the variable.
- **`pull`** refuses a non-empty directory unless its `brainstorm.json` names the same session. It then replaces `slots/` wholesale and rewrites `brainstorm.json` and `GUIDE.md`.
- **`commit`** reads every file under the directory (cap 300 files and 4 MB, skipping `node_modules` and `.git`). On success it rewrites `base` in the directory's `brainstorm.json`.

Rules the server enforces:
- `session new` resolves the thread through the bridge and creates the `project` row from `thread.projectId` if new. The session is created attached to that thread.
- `attach` resolves the caller's thread. It refuses a thread whose `projectId` differs from the session's (`wrong_project`), and for a title that matches more than one session it returns `ambiguous_title` with candidates. Matching is an exact id, then a case-insensitive exact title, then a unique case-insensitive substring. The old attachment row gets `detached_at`.
- `commit` and `validate` from a thread other than the attached one fail with `thread_not_attached`, naming the owning thread.
- `commit` writes in one transaction, as follows. `validate` runs steps 1 to 5 and writes nothing.
  1. Check the owner.
  2. Run `parseWorkingCopy`. Its failure still checks the blocks that did parse, so every error comes back in one `validation_failed`.
  3. Diff by hash against the latest iteration.
  4. If there's no change and `--addresses` adds nothing, return the latest iteration with `created: false`. That's an idempotent replay, and it comes before the base check, so a replay converges even when the CLI died before rewriting `base`.
  5. Refuse a stale base, then check every new content hash in the worker. Every error comes back in one `validation_failed`.
  6. In one transaction, re-check the owner and the latest iteration (the check awaited the worker), insert the iteration and its blocks, append `address` events, and fulfil the open request.
  7. Return the warnings (`override_dropped`, `pin_lost`, `duplicate_part`, `out_of_scope`, `not_addressed`, `uncontrolled_prop`).

### Context

`context` returns `AgentContext`:
- the session (id, title, brief), the latest iteration, and whether the caller is attached
- the open request, with its scope, free text, the requested feedback (id, block, part, text and history) and Rob's applicable overrides on in-scope blocks
- all open and addressed feedback
- `controlVocabulary()`
- `next`, the exact commands to run

Text output prints this readably, ending with the `next` commands.

### The `[brainstorm]` message

```
[brainstorm] session s_8f2k3a · request 5 · scope: wheel/neon, result/sheet · feedback: #4 #7 · freetext: "make the spin feel less random"
Handle with the ux-brainstorm skill: run `brainstorm context s_8f2k3a`.
```

The scope is `all`, a block-id list, or `described` (the free text defines it). `formatRequestMessage` and `parseRequestMarker` live in one module. The marker `session <id> · request <n>` is how the tracker finds the message in a thread.

## Storage (`node:sqlite`, `PRAGMA user_version` migrations)

```sql
project(id TEXT PRIMARY KEY, repo_path TEXT, created_at TEXT NOT NULL)            -- id = T3 projectId
session(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project, title TEXT NOT NULL,
        brief TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT)
attachment(session_id TEXT NOT NULL REFERENCES session, thread_id TEXT NOT NULL,
        attached_at TEXT NOT NULL, detached_at TEXT, lost_at TEXT)
  -- UNIQUE INDEX one_open_attachment ON attachment(session_id) WHERE detached_at IS NULL
block_content(hash TEXT PRIMARY KEY, source TEXT NOT NULL, css TEXT, block_json TEXT NOT NULL,
        controls_json TEXT, controls_derived INTEGER NOT NULL, about TEXT, compiled TEXT NOT NULL, parts_json TEXT NOT NULL)
iteration(session_id TEXT NOT NULL REFERENCES session, n INTEGER NOT NULL, thread_id TEXT NOT NULL,
        note TEXT, slots_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id, n))
iteration_block(session_id TEXT NOT NULL, n INTEGER NOT NULL, block_id TEXT NOT NULL, hash TEXT NOT NULL REFERENCES block_content,
        PRIMARY KEY(session_id, n, block_id))
slot_choice(session_id TEXT NOT NULL, slot TEXT NOT NULL, variant TEXT NOT NULL, PRIMARY KEY(session_id, slot))
override(session_id TEXT NOT NULL, block_id TEXT NOT NULL, prop TEXT NOT NULL, value_json TEXT NOT NULL,
        set_at TEXT NOT NULL, PRIMARY KEY(session_id, block_id, prop))
feedback(session_id TEXT NOT NULL, id INTEGER NOT NULL, block_id TEXT NOT NULL, part TEXT, text TEXT NOT NULL,
        created_in INTEGER NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, PRIMARY KEY(session_id, id))
feedback_event(session_id TEXT NOT NULL, feedback_id INTEGER NOT NULL, seq INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('address','confirm','reopen')), iteration INTEGER, at TEXT NOT NULL,
        PRIMARY KEY(session_id, feedback_id, seq))
request(session_id TEXT NOT NULL, n INTEGER NOT NULL, body_json TEXT NOT NULL, feedback_ids_json TEXT NOT NULL,
        base INTEGER, thread_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('sending','sent','send_failed','fulfilled','withdrawn')),
        error TEXT, sent_at TEXT, fulfilled_in INTEGER, created_at TEXT NOT NULL, PRIMARY KEY(session_id, n))
  -- UNIQUE INDEX one_open_request ON request(session_id) WHERE state IN ('sending','sent','send_failed')
```

Each actor writes its own rows:
- The agent's commit writes `block_content`, `iteration`, `iteration_block`, the `address` events and the request's `fulfilled`.
- Rob writes `slot_choice`, `override`, `feedback`, `confirm`/`reopen` events and request creation, retry and withdrawal.
- The tracker writes `sent`/`send_failed` and `attachment.lost_at`.

## State models (`src/core/machines.ts`, pure)

**Feedback.** `foldFeedback(events)` returns `open { previouslyAddressedIn } | addressed { in } | confirmed { addressedIn, at }`. `address` applies from open, and from addressed as a re-address. `confirm` applies only from addressed. `reopen` applies from addressed or confirmed. The fold skips illegal events, and `canAppend(status, kind)` guards writes. Pins are `{ blockId, part | null }`, where null means the whole block. Whether a pin is placed or detached is derived in the frame on every render and never stored.

**Request.** The stored state is `sending | sent | send_failed { error } | fulfilled { iteration } | withdrawn`. The UI phase is derived by one pure function, `requestPhase(request, attachment, observation)`:

| Stored | Condition | Phase Rob sees | Actions |
|---|---|---|---|
| sending | none | "Sending to T3…" | none |
| send_failed | none | "Couldn't send: <error>. The request is saved." | Retry, Withdraw |
| sent | request thread ≠ attached thread | "Sent to the previous thread" | Resend, Withdraw |
| sent | attachment lost | "This session's thread is gone. In a T3 thread on this project, say: pick up the brainstorm session titled "<title>"" | Copy phrase, Withdraw |
| sent | marker not seen, or no observation yet | "Queued in T3" | Open thread, Withdraw |
| sent | marker in active run, `pendingRequestCount > 0` | "The agent is asking something in T3" | Open thread, Withdraw |
| sent | marker in active run | "The agent is working" | Open thread, Withdraw |
| sent | marker's run ended, thread `failed` | "The agent's run failed in T3" | Retry, Withdraw |
| sent | marker's run ended, no commit | "The agent replied in T3 without changing the design" | Retry, Withdraw |
| fulfilled | none | "Iteration n · changed …" | none |

`observeRequest(sessionId, n, snapshot)` finds the user message containing the marker and compares its `runId` with `thread.activeRunId`.
- **Retry or resend** first checks whether the marker already arrived, so it never double-sends blindly.
- **On startup,** every request left in `sending` gets the same check and becomes `sent` or `send_failed`.
- **One open request per session.** Regenerate is disabled while one is open, and the UI shows that request with Withdraw.

**Attachment.** `attached` or `lost`, where lost means `lost_at` is set. It becomes lost only when the bridge reports the thread missing. It recovers when that thread is seen again, commits, or another thread attaches.

## Server modules

- `src/core/` is plain Node with no Electron and no HTTP.
  - `types.ts`
  - `props.ts`: parse schema, `parseAppearanceValue`, `resolveProps`, `classifyOverrides`
  - `controls.ts`: catalog, `validateControls`, `deriveControls`, `controlVocabulary`
  - `workingCopy.ts`
  - `machines.ts`
  - `check/`: the worker pool plus `checkBlocks(drafts, overridesByBlock) → Map<hash, artifacts | issues>`. Results are keyed by content hash, and `parts` come from the defaults render, so stored artifacts don't depend on Rob's overrides at check time.
  - The three boundary parsers (`parsePropsSchema`, `validateControls`, `parseWorkingCopy`) return `Parsed<T>`: `{ ok: true, value, warnings }` or `{ ok: false, issues }`.
  - `store.ts`: SQL only, private to the service
  - `brainstorm.ts`: the `Brainstorm` service. It has one method per agent command (`newSession`, `listSessions`, `attach`, `context`, `pull`, `validate`, `commit`), plus `view(sessionId)`, `act(sessionId, RobAction) → SessionView`, `exportHtml(sessionId) → { path }`, `tick()` for the tracker poll, and `subscribe(listener)`.
  - `bridge/t3.ts`: the only file that knows the `t3` CLI. It runs `cmd.exe /d /s /c <t3.cmd> …` with the message on stdin, and checks thread ids against `^[0-9a-f-]{36}$`. The path comes from `BRAINSTORM_T3_CLI`, then `T3CODE_CLI_PATH`, then `%USERPROFILE%\.t3\bin\t3.cmd`.
- `src/server/http.ts`: auth, Host/Origin checks, body parsing into domain types, `Failure` → HTTP status, SSE, static files. It is adaptation, not a pass-through.
- `src/server/headless.ts`: starts the server with no window and prints the UI URL.
- `src/canvas/runtime.tsx` is bundled with React into `dist/canvas/runtime.js`. `buildCanvasDocument(payload, mode: "live" | "export")` returns the HTML for `/canvas` and for an export file, so the two can't drift.

`RobAction` is `set_override | clear_override | dismiss_inapplicable | select_variant | add_feedback | edit_feedback | delete_feedback (open only) | confirm_feedback | reopen_feedback | regenerate { scope, freetext } | retry_request | withdraw_request | check_thread`.

## Canvas

- **Frame.** `/canvas` serves `buildCanvasDocument(null, "live")` with the CSP header `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`. Anything that renders in the canvas therefore renders from disk. The runtime reports `securitypolicyviolation` to the host.
- **Host to frame.** `modules` sends `{ blockId, hash, compiled, css }[]`, only for new hashes. `state` sends `{ frames: { slot, title, frame, blockId }[], props: Record<BlockId, props> }`. `mode` is `view` or `pin`. `pins` sends `{ id, pin, status }[]`.
- **Frame to host.** The messages are `ready`, `picked { pin }`, `pin_clicked { id }`, `select_block { blockId }`, `pin_placement { placed, detached }` and `block_error { blockId, message }`.
- **Module cache.** It is keyed by hash, so a regenerate remounts only changed blocks. Each block has its own error boundary.
- **Layout.** Each slot renders its active variant inside a frame of the manifest's width, titled with the slot title. Frames are laid out in manifest order.
- **Pins** are drawn inside the frame, anchored to `[data-bid="b"] [data-part="p"]`, and follow layout changes.

## Renderer

The renderer is Vite, React 19, Tailwind v4, `@json-render/react` and `@json-render/shadcn`. It has three columns:
- **Left.** Session list, then slots, each with a variant switch showing the variant title, with `about.md` on hover or expand.
- **Centre.** The canvas iframe.
- **Right.** Controls for the selected block, one json-render `Renderer` per block over a custom `StateStore`. Its `set` updates the frame immediately and sends a debounced `set_override` (250 ms). Below the controls, the inapplicable-override banner and the feedback list.

The top bar shows the attached thread and request phase, a Regenerate menu (everything, selected blocks, free text), and Export.

The registry implements our catalog with shadcn components where their props fit (`Slider`, `Select`, `Switch`, `Input`, `ToggleGroup`). `Colour` is a native `<input type=color>` with a hex field.

## Export

`exportHtml` writes `exports\<session>-i<n>-<yyyyMMdd-HHmmss>.html`. It's one file: `buildCanvasDocument(payload, "export")`, with the runtime and every variant's compiled module inlined, plus the effective props, the active choices and a minimal in-page variant switcher. It needs no network and no server, and loads with no console errors.

## Verification harness

- **Fake T3.** `test/fake-t3/t3.cmd` plus `fake-t3.mjs` drive threads from a JSON state file named in `BRAINSTORM_FAKE_T3_STATE`. Each thread has `projectId`, `status`, `activeRunId`, `pendingRequestCount`, `messages` and `missing`. `send` appends messages and records them. A `fail` flag forces exit 1: `true` for every command, or a list such as `["send"]`. Its JSON mirrors the real shapes recorded in `docs/t3-cli.md`.
- **Unit tests** use `vitest` on `src/core` against literal expected values.
- **Verify scripts.** `npm run verify:<n>` (`scripts/verify/<n>-*.mjs`) starts the real artifact with a temp `BRAINSTORM_HOME`. That's the headless server plus the real CLI for item 1, and Playwright `_electron` for the app items. Each script prints `VERIFIED` or exits non-zero with what failed.
- **Live checks** against real T3 are recorded in the decision trail with thread links.

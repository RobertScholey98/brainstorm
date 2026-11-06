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
| Electron main (`src/electron/main.ts`) | Starts the server in-process and opens one frameless window, at least 1100 x 720, whose native buttons overlay the app's header in the theme's tokens. Single-instance lock, external links open in the browser. | Imports `startServer` from `src/server`. It is the only file that imports `electron`. |
| Server (`src/server`, plain Node) | HTTP API, SQLite, the request tracker, the AgentBridge, the export writer, and static serving of the renderer and the canvas page | HTTP on 127.0.0.1 |
| Check worker (`src/core/check/worker.ts`, `worker_threads`) | sucrase compile and the render probe inside `vm` | Strings in, results out. Killed after 3 s per block. |
| Renderer (`src/renderer`, React app) | Brainstorm list, canvas host, controls panel, feedback, regenerate | `fetch` to `/v1/ui/*` with the UI token, plus SSE on `/v1/ui/events` |
| Canvas frame (`/canvas`, `<iframe sandbox="allow-scripts">`) | Runs block code | `postMessage` only. Opaque origin `null`. |
| `brainstorm` CLI (`src/cli`, plain Node) | Args, defaults, reading and writing the working copy as a `FileMap`, starting the app | `fetch` to `/v1/agent/*` with the agent token |

`node dist/server/headless.js` runs the server with no Electron, for tests and for Playwright in plain Chromium. Electron adds a window around the same server.

**Window security.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and no preload. Electron loads `http://127.0.0.1:<port>/#ui=<uiToken>`. `setWindowOpenHandler` opens http(s) links externally and denies new windows. `will-frame-navigate` blocks any navigation off the app origin, in the window or in the canvas frame, which `will-navigate` alone wouldn't see. Permission requests are denied, except `clipboard-sanitized-write` from the app window's main frame, which Copy phrase needs. There is no application menu, so no reload drops the in-memory UI token. The window has no native title bar (`titleBarStyle: "hidden"` with `titleBarOverlay`); the overlay takes the `app` and `fg` tokens and is updated from `nativeTheme` `updated`, so theme sync needs no IPC and no preload (ADR 003 in `docs/design-system/`). Electron's profile lives in `<BRAINSTORM_HOME>\electron`, which also scopes the single-instance lock to one home.

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
```

Rules (each failure is an `Issue` keyed by file):
- Slot and variant ids are kebab-case (`^[a-z][a-z0-9-]{0,31}$`). Every `slots/<slot>` directory appears in `brainstorm.json` `slots`, and every listed slot has at least one variant.
- Any other file is an error, so a helper the agent expects to import isn't silently dropped. `about.md` was a variant note until Rob dropped notes (he judges the designs himself). It now fails like any other unknown file, as `unexpected_file`, with a message telling the agent to delete it and write no more, so an agent following an older skill learns at its next commit.
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
- `session new` resolves the thread through the bridge and creates the `project` row from `thread.projectId` if new. The session is created attached to that thread. The server names the project from the `--project` path the CLI sends: the folder name of the main checkout (the parent of `git rev-parse --path-format=absolute --git-common-dir` run in that path, `src/core/projectName.ts`), so a worktree still reports its repo's name. A path outside git gives null, which leaves the project's name as it was. T3's CLI can't list projects, so this is the only label the app can show for a `projectId`.
- `attach` resolves the caller's thread. It refuses a thread whose `projectId` differs from the session's (`wrong_project`), and for a title that matches more than one session it returns `ambiguous_title` with candidates. Matching is an exact id, then a case-insensitive exact title, then a unique case-insensitive substring. The old attachment row gets `detached_at`.
- `commit` and `validate` from a thread other than the attached one fail with `thread_not_attached`, naming the owning thread.
- `commit` writes in one transaction, as follows. `validate` runs steps 1 to 5 and writes nothing.
  1. Check the owner.
  2. Run `parseWorkingCopy`. Its failure still checks the blocks that did parse, so every error comes back in one `validation_failed`.
  3. Diff by hash against the latest iteration.
  4. If there's no change and `--addresses` adds nothing, return the latest iteration with `created: false`. That's an idempotent replay, and it comes before the base check, so a replay converges even when the CLI died before rewriting `base`.
  5. Refuse a stale base, then check every new content hash in the worker. Every error comes back in one `validation_failed`.
  6. In one transaction, re-check the owner and the latest iteration (the check awaited the worker), insert the iteration and its blocks, append `address` events, and fulfil the open request.
  7. Return the warnings (`override_dropped`, `pin_lost`, `duplicate_part`, `out_of_scope`, `not_addressed`, `uncontrolled_prop`, `vary_mismatch`). For a vary request, any block but the asked-for variants is `out_of_scope`, and each asked-for variant that is missing, titled otherwise, or no longer renders the varied `data-part` is `vary_mismatch`.
- A fork's new thread has no session, so its first message tells the agent to `session attach` first. That attach adopts the thread when the app hasn't yet, and changes nothing when it has (`#adopt` in the service).

### Context

`context` returns `AgentContext`:
- the session (id, title, brief), the latest iteration, and whether the caller is attached
- `fork`: for a fork, its parent (id and title), the iteration it came from, and the settings baked into its defaults; null otherwise
- the open request, with its scope, free text, the requested feedback (id, block, part, text and history) and Rob's applicable overrides on in-scope blocks. A vary's target block is in scope, so its copies can start from Rob's settings; the text output spells a vary out as the slot, the target, the part and each new variant's key and title
- all open and addressed feedback
- `controlVocabulary()`
- `next`, the exact commands to run

Text output prints this readably, ending with the `next` commands.

### The `[brainstorm]` message

```
[brainstorm] session s_8f2k3a · request 5 · scope: wheel/neon, result/sheet · feedback: #4 #7 · freetext: "make the spin feel less random"
Handle with the ux-brainstorm skill: run `brainstorm context s_8f2k3a`.
```

The scope is `all`, a block-id list, `described` (the free text defines it), or a vary: `vary wheel/neon [spin-button] as spin-button-a, spin-button-b, spin-button-c`, the target block, its part when there is one, and the keys the app named. `formatRequestMessage` and `parseRequestMarker` live in one module. The marker `session <id> · request <n>` is how the tracker finds the message in a thread.

A fork's request 1 is its new thread's first message, sent by `t3 thread start`. It adds `fork of <parent> iteration <n>` after the marker, and its second line has the agent attach before reading context:

```
[brainstorm] session s_9c1d2e · request 1 · fork of s_8f2k3a iteration 4 · scope: all · feedback: #1 #2 · freetext: "Try it as a slot machine"
Handle with the ux-brainstorm skill: this thread is new, so run `brainstorm session attach s_9c1d2e`, then `brainstorm context s_9c1d2e`.
```

When the app runs on a home other than the default, a third line names `BRAINSTORM_HOME`, since T3 starts agents with its own environment.

## Storage (`node:sqlite`, `PRAGMA user_version` migrations)

```sql
project(id TEXT PRIMARY KEY, repo_path TEXT, created_at TEXT NOT NULL,
        name TEXT)                                                               -- id = T3 projectId; name added by migration 2
session(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project, title TEXT NOT NULL,
        brief TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT,
        settled_at TEXT, unsettled_at TEXT)                                     -- migration 5; Rob's settle (ADR 004)
attachment(session_id TEXT NOT NULL REFERENCES session, thread_id TEXT NOT NULL,
        attached_at TEXT NOT NULL, detached_at TEXT, lost_at TEXT)
  -- UNIQUE INDEX one_open_attachment ON attachment(session_id) WHERE detached_at IS NULL
block_content(hash TEXT PRIMARY KEY, source TEXT NOT NULL, css TEXT, block_json TEXT NOT NULL,
        controls_json TEXT, controls_derived INTEGER NOT NULL, compiled TEXT NOT NULL, parts_json TEXT NOT NULL)
  -- migration 4 dropped the about column, storing each noted block again under the hash of its files without the note
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
ui_pref(key TEXT PRIMARY KEY, value_json TEXT NOT NULL)                          -- migration 3; how Rob left the window
fork(session_id TEXT PRIMARY KEY REFERENCES session, parent_id TEXT NOT NULL REFERENCES session,
        parent_n INTEGER NOT NULL, baked_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(parent_id, parent_n) REFERENCES iteration(session_id, n))   -- migration 6 (ADR 005)
variant_seen(session_id TEXT NOT NULL REFERENCES session, block_id TEXT NOT NULL,
        PRIMARY KEY(session_id, block_id))                                       -- migration 6; seeded with every block that existed
```

A fork is a session like any other, plus its `fork` row. `createFork` writes the session, the `fork` row, its iteration 1 (the source iteration narrowed to one variant per slot, with Rob's settings baked into the picked variants' `block.json` defaults and re-checked), his open pins on those variants as new feedback numbered from 1, and request 1, all in one transaction, attached to the sentinel thread `pending:<sessionId>`. The sentinel fails the thread-id pattern, so the bridge refuses to send to it or show it, and the attachment invariant holds while no thread exists yet. An iteration's origin is derived, never stored: the request it fulfilled, a fork's iteration 1, a root's iteration 1 from the brief, or else the agent's own commit and its note. A block is new while it first appeared after iteration 1 and has no `variant_seen` row.

Each actor writes its own rows:
- The agent's commit writes `block_content`, `iteration`, `iteration_block`, the `address` events and the request's `fulfilled`.
- Rob writes `slot_choice`, `override`, `feedback`, `confirm`/`reopen` events, `variant_seen` (`mark_seen`), a fork and its discard (`POST /v1/ui/sessions/:id/fork` with `{ from, picks, instruction }`, and `POST …/discard`, which archives a fork whose thread never started), and request creation, retry and withdrawal, and `session.settled_at` and `unsettled_at` through `POST /v1/ui/sessions/:id/settle` (`{ settled }`). Whether a settle still holds is derived on read: a request created after it, or an iteration that didn't fulfil a request made before it, brings the brainstorm back (`settlementOf` in `machines.ts`, ADR 004).
- The tracker writes `sent`/`send_failed` and `attachment.lost_at`.
- The window writes `ui_pref` through `POST /v1/ui/prefs` (read back with `GET /v1/ui/prefs`): `pane.sidebar` and `pane.inspector` (widths, 120 to 1200), `inspector.rail`, `canvas.<sessionId>` (`{ view: "stage" | "board", slot }`), `history.strip` (whether the history filmstrip shows; open by default), and `home.query` (`{ status, projects, sort }`, home's filters; never the search text). One row per preference, so a change never rewrites another. `readPrefs` in `src/core/prefs.ts` skips a row in a shape it doesn't know. They live on the server because the window's origin changes with each launch's port, so its own storage would forget them.

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
| sending | a fork's thread hasn't started | "Starting a T3 thread…" | none |
| send_failed | a fork's thread hasn't started | "Couldn't start a T3 thread (<error>). The fork is saved." | Retry, Discard fork |

`observeRequest(sessionId, n, snapshot)` finds the user message containing the marker and compares its `runId` with `thread.activeRunId`.
- **Retry or resend** first checks whether the marker already arrived, so it never double-sends blindly.
- **On startup,** every request left in `sending` gets the same check and becomes `sent` or `send_failed`.
- **One open request per session.** Regenerate is disabled while one is open, and the UI shows that request with Withdraw.
- **A fork's thread start.** The fork's request 1 starts its thread. Its success, a retry or restart that finds the thread, and the new agent's own `session attach` all adopt the thread through one idempotent step, which reattaches the session and marks the request sent. A retry, and startup, first list the project's threads created from a minute before the request and look for its marker in the newest ten, so a start whose reply was lost never makes a second thread. Startup never starts a thread itself; one it can't find becomes `send_failed` ("Brainstorm stopped before its thread started"). A fork's thread can't be withdrawn to, so its only ways out are Retry and Discard.
- **Vary.** A vary is a request whose scope is `{ kind: "vary", target: Pin, variants }`. The server names the variants when Rob sends (`varyNames` in `fork.ts`): the element's `data-part` (or the block's variant key) plus the next free letters, titled "Spin button A" and so on. It carries no feedback, and shares Regenerate's gate and every phase.

**Attachment.** `attached` or `lost`, where lost means `lost_at` is set. It becomes lost only when the bridge reports the thread missing. It recovers when that thread is seen again, commits, or another thread attaches.

## Server modules

- `src/core/` is plain Node with no Electron and no HTTP.
  - `types.ts`
  - `props.ts`: parse schema, `parseAppearanceValue`, `resolveProps`, `classifyOverrides`
  - `controls.ts`: catalog, `validateControls`, `deriveControls`, `controlVocabulary`
  - `workingCopy.ts`
  - `machines.ts`
  - `prefs.ts`: the `ui_pref` rows, their patch schema and `applyPrefs`, which the window uses to apply a patch before the server answers
  - `check/`: the worker pool plus `checkBlocks(drafts, overridesByBlock) → Map<hash, artifacts | issues>`. Results are keyed by content hash, and `parts` come from the defaults render, so stored artifacts don't depend on Rob's overrides at check time.
  - The three boundary parsers (`parsePropsSchema`, `validateControls`, `parseWorkingCopy`) return `Parsed<T>`: `{ ok: true, value, warnings }` or `{ ok: false, issues }`.
  - `store.ts`: SQL only, private to the service
  - `brainstorm.ts`: the `Brainstorm` service. It has one method per agent command (`newSession`, `listSessions`, `attach`, `context`, `pull`, `validate`, `commit`), plus `view(sessionId)`, `act(sessionId, RobAction) → SessionView`, `exportHtml(sessionId) → { path, file }`, `prefs()` and `setPrefs(patch)`, `tick()` for the tracker poll, and `subscribe(listener)`. `view()` reuses the last thread snapshot. It asks T3 itself only for a thread it has never seen, or one whose last check failed or came back missing at least 10 s ago, so a T3 outage doesn't spawn `t3` on every view. `tick`, `check_thread`, retry and startup always ask. Listeners hear a session once per microtask, however many writes made it change.
  - `bridge/t3.ts`: the only file that knows the `t3` CLI. It runs `cmd.exe /d /s /c <t3.cmd> …` with the message on stdin, and checks thread ids against `^[0-9a-f-]{36}$`. Besides `send` and `snapshot` it has `start({ project, title, message })` and `list(project)`; project ids must match `PROJECT_PATTERN` and a title passes through `safeTitle` before it reaches the command line. The path comes from `BRAINSTORM_T3_CLI`, then `T3CODE_CLI_PATH`, then `%USERPROFILE%\.t3\bin\t3.cmd`.
- `src/server/http.ts`: auth, Host/Origin checks, body parsing into domain types, `Failure` → HTTP status, SSE, static files. It is adaptation, not a pass-through.
- `src/server/headless.ts`: starts the server with no window and prints the UI URL.
- `src/canvas/runtime.tsx` is bundled with React into `dist/canvas/runtime.js`. `buildCanvasDocument(payload, mode: "live" | "export")` returns the HTML for `/canvas` and for an export file, so the two can't drift.

`RobAction` is `set_override | clear_override | dismiss_inapplicable | select_variant | add_feedback | edit_feedback | delete_feedback | confirm_feedback | reopen_feedback | regenerate { scope, freetext } | vary { target, count, direction } | mark_seen { blocks } | retry_request | withdraw_request | check_thread`. A vary asks for 1 to 6 variants (`VARY_MAX`).

The service also has `fork(parentId, { from, picks, instruction })`, `discard(id)`, `iteration(id, n)` (a past iteration, read-only, at `GET /v1/ui/sessions/:id/iterations/:n`) and `preview(id, { n?, slot? })` (`GET …/preview?n=&slot=`, a filmstrip still). `fork.ts` holds the pure rules a fork and a vary share with the window: `carryOver` (what the Fork popover lists and the service writes, so the two can't disagree), `bakeDefaults`, `forkTitle` (the instruction's first clause, at most 48 characters), `partLabel` and `varyNames`. `SessionView` carries `fork` (parent, its state `active | settled | gone`, and the source iteration), `lineage` (every ancestor, oldest first) and `history` (`iterations` with each one's origin, and the `forks` made from this brainstorm).

`FEEDBACK_ACTIONS` in `machines.ts` maps each feedback status to what Rob may do: open to edit and delete, addressed to confirm and reopen, confirmed to reopen. `act` refuses anything else, and the feedback list draws its buttons from the same table. `regenerateGate` decides `SessionView.regenerate`: no iteration, then an open request, then a lost attachment each block it, and `regenerate` refuses the same cases (`not_found`, `request_open`, `thread_lost`). `requestFeedback(feedback, scope)` is the one rule for which open feedback a request carries.

## Canvas

- **Frame.** `/canvas` serves `buildCanvasDocument(null, "live")` with the CSP header `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`. Anything that renders in the canvas therefore renders from disk. The runtime reports `securitypolicyviolation` to the host.
- **Host to frame.** `modules` sends `{ blockId, hash, compiled, css }[]`, only for blocks whose version the frame doesn't already hold. A past iteration can bring back an older version, which is sent again and found in the frame's module cache. `state` sends `{ frames: { slot, title, frame, blockId }[], props: Record<BlockId, props>, selected: BlockId | null, stage: SlotId | null }`; `selected` outlines the block whose controls are open, and `stage` is the slot on the stage, or null for the board. Export always sends null. `mode` is `view` or `pin`. `pins` sends `{ pins: { id, pin, status }[], focused, hovered }`, where `hovered` is the feedback item under the pointer in the Inspector, whose pin grows as if hovered itself. `pulse { id }` scrolls a pin into view and pulses it. `variants` is export-only (see Export). On every `ready` the host resends everything, so a reloaded frame recovers.
- **Frame to host.** The messages are `ready`, `picked { pin, at }` (`at` is the click point in the frame's viewport, so the host can anchor the comment composer there), `pin_clicked { id }`, `select_block { blockId }` (a pointer-down anywhere in a frame), `pin_placement { placed, detached }`, `zooms { zooms: Record<SlotId, number> }` (each frame the fit rules scaled below 1, sent whenever that changes, so the canvas bar can say so), `block_error { blockId, message }` and `csp_violation { directive, blockedUri }`. Each side accepts messages only from the other's window: the host checks `event.source` against the iframe, because the frame's origin is `null`.
- **Module cache.** It is keyed by hash, so a regenerate remounts only changed blocks. A block's CSS is one `<style>` wrapped in `@scope ([data-bid="<id>"])`, replaced when its hash changes. Each block has its own error boundary, which retries when the block's props change, so a control value that broke a render can be undone.
- **Layout.** Each slot renders its active variant inside a frame of the manifest's width, titled with the slot title and its size. The fit rules live in `src/canvas/fit.ts` (ADR 002 in `docs/design-system/`), and neither view scrolls sideways. The room is the canvas width less 24 px each side. On the board, frames sit side by side in manifest order, 24 px apart, all at one CSS `zoom` that fits the row to the room; below half size they wrap into rows at their own size instead, each zoomed only if it alone is wider than the room. On the stage only the staged slot shows, centred, zoomed only if it is wider than the room. The canvas bar shows the selected frame's scale, such as "83%". The other frames stay mounted, fixed and hidden, so their blocks keep state and still report errors and pin placement. A pointer-down or a pick scrolls its frame into view, stopping 24 px short so a frame's label sits as far off the bar as on the stage, and the canvas keeps a stable scrollbar gutter.
- **Preview.** `/canvas/preview` serves `buildCanvasDocument(null, "preview")` under the same CSP header, for a home card. The host sends it `modules` and `state` for one frame, from `GET /v1/ui/sessions/:id/preview` (the latest iteration's first slot, its selected variant and Rob's settings, or null before the first iteration). The runtime draws that block alone in its frame's declared size, zoomed to the window's width, with no title, switch, pins, pick or key forwarding, and the page takes no pointer events. Once it has painted it posts `painted { image }`: a PNG of what the card shows, drawn from an SVG foreignObject of its DOM and styles onto a canvas, or null if that fails (ADR 004).
- **Export.** `buildCanvasDocument(payload, "export")` inlines `payload: HostToFrame[]` as JSON, and the runtime replays it in order as if a host had sent it, with nothing posted back. The document carries the CSP as a meta tag too, so a file opened from disk runs under the same policy.
- **Pins** are 20 px with a 26 px hit area, and grow slightly on hover, or while their feedback item is hovered in the Inspector. They are drawn inside the frame body, anchored to the top-right corner of `[data-bid="b"] [data-part="p"]` (or of the frame body for a whole-block pin), and numbered with the feedback id. Block code can move a part at any time (transitions, its own state, resizes) and nothing reports all of those, so pins are repositioned every animation frame. Rect deltas are divided by the body's scale, so a pin stays on its element in a zoomed frame. A pin is placed when its part renders with a box, and detached when its block renders and the part doesn't. A pin on a block that isn't showing is neither. The frame posts `pin_placement` whenever that split changes.
- **Pin mode.** Vary picks in the same mode. Pointer moves highlight the nearest `[data-part]` inside a `[data-bid]`, or the whole block outside any part. Pointer and click events are captured at the window and stopped, so a pick never presses the block's own buttons, and the click posts `picked`.

## Renderer

The renderer is Vite, React 19, Tailwind v4, `@json-render/react`, and shadcn components generated in its Base UI flavour (`components.json`, primitives from `@base-ui/react`) under `src/renderer/components/ui`. No Radix is bundled; `verify:7` greps `dist/renderer` for it. Light and dark follow `prefers-color-scheme`. The layout is a desktop shell: a quiet sidebar on the app background, with a collapse toggle, next to the main panel, an inset rounded card. The window header runs across the top on the app background: the sidebar toggle and mark over the sidebar, then the session bar, with the native window buttons overlaid at its right end. It is the window's drag region, and every control in it opts out (`data-drag-region`). The canvas frame paints its own colours, so the card only frames it.

- **Navigation.** The window shows the overview, or one open brainstorm with either its own sidebar or the home list (`Nav` in `App.tsx`). Going back to all brainstorms keeps the open one on the canvas, with its home row marked, until another is chosen or Overview closes it.
- **Home sidebar.** An Overview row, then every brainstorm, grouped by `projectId` in collapsible groups (`groupByProject`). A group is labelled with the listing's `projectName`, the project's stored name, or `Other project` when it has none. Groups and rows run from the most recent `activeAt`, or from when Rob brought a brainstorm back if that is later. A row shows the title, the latest iteration (or a warning "Thread lost" in its place when the attachment is lost) and how long ago it was active, which is never cut, and an accent dot while a request is open (`openRequest`). Up and down move between rows. Settled brainstorms leave their groups for a Settled group at the bottom, shut by default with its count, newest settled first, each row muted with its age counted from the settle. Hovering or focusing a row swaps its age for Settle, or Un-settle on a settled row (ADR 004).
- **Overview.** With nothing open, the main panel shows every brainstorm as a card, newest activity first: project with one status place (a lost thread, or waiting on the agent), title, up to two lines of brief (none when there is no brief), and a footer with iteration and age that lines up across a row of cards, under a line saying how to start one (`/ux-brainstorm` in a T3 thread). Each card opens with a 160 px preview of the latest iteration's first slot, scaled to the card's width from the top (`CardPreview`): a skeleton while it loads, "Waiting for the first commit" before an iteration, a quiet failure line when the block fails to render, and dimmed on a settled card. It loads only while the card is in view; at most three preview frames run at once (`PreviewTurns`), each removed once its still is taken, and stills, or a block's failure, are kept by block, settings, width and theme, and apart for a history strip's thumbnails (`StillCache`, `stillKey`). The card's title is its button, stretched over the whole card, so a click anywhere on it, preview included, opens the brainstorm. Under the heading, one row of controls (`HomeFilters`): a search over titles and briefs that filters as Rob types (`/` or Ctrl+F to focus, Escape to clear, then to leave), a status switch (Active by default, Attention, Settled, All) with counts, a project filter and a sort (`queryHome` in `homeQuery.ts`). Under All, settled brainstorms follow under a Settled heading, muted and marked Settled, their footer counting from the settle. When nothing passes, home says so with Clear search and filters, or with Show settled when everything is settled (ADR 004). A card's settle control sits over its bottom right corner and shows on hover or focus. With no brainstorms it is an empty state instead. The first list load shows skeletons, and a server that doesn't answer at launch shows its error with Try again.
- **Brainstorm sidebar.** Clicking a row swaps the sidebar to that session, sliding in. It has "All brainstorms" to go back, the attached thread (a link to `thread.link`, "Attached" or "Unattached"), then the slots. Each slot lists its variants as a radio list showing the variant title, where up and down select the next variant. Every slot marks its showing variant with a dot, and only the selected slot's row is tinted. A variant whose block failed to render carries a danger marker. A lost attachment shows the takeover phrase, on its own line in mono, with Copy phrase under the thread, also when no request is open.
- **Main panel.** The top bar, then the canvas bar and the canvas iframe, which scrolls inside its own region, beside the Inspector inside the card. The canvas bar (`CanvasBar`) holds previous and next and a tab per slot, then at its right the pick hint in pin mode (with Esc and Cancel), the scale when the fit rules zoomed the selected frame, and a One slot / All slots `Segmented` switch. With one slot the views are the same, so the arrows and the switch don't show. The stage is the default view and "All slots" shows the board; the view and the staged slot are kept per brainstorm in `ui_pref`. A frame never sits under the Inspector. The sidebar and the Inspector resize from their borders (`ResizeHandle`, by drag or arrow keys), and each width is kept in `ui_pref`, so it survives a restart. The window waits for the stored layout before its first paint, so a remembered width never jumps into place.
- **History.** A strip along the bottom of the canvas (`Filmstrip` in `History.tsx`) has a still per iteration, oldest first, with its number, "latest" on the newest, its age and its origin line (`originText`). The forks made from an iteration hang under its still as links, and inside a fork the strip starts with a stub back to the parent, "discarded" once the parent is gone. It is one listbox: Left and Right step, Home and End jump, and the option Rob lands on is what the canvas shows. Stills are the home preview pipeline (`IterationStill` over `GET /v1/ui/sessions/:id/preview?n=&slot=`), showing the slot on the stage. The history toggle in the header, beside the right panel toggle, opens and closes the strip, kept in `ui_pref` as `history.strip`, open by default. Clicking a still fetches that iteration once (`GET /v1/ui/sessions/:id/iterations/:n`; a stored iteration never changes) and shows it read-only under a one-row bar, "Viewing iteration N", with Esc and Back to latest. The canvas keeps what it showed until it arrives. In the past the badge reads "Iteration N of L", Regenerate and Vary are off with hints that say why, Fork reads "Fork iteration N", the Inspector shows its controls inert under a note, and the canvas draws no pins. Variants picked in the past are kept in `SessionWorkspace`, apart from the stored picks, and only a fork from there uses them. Escape backs out one layer: an open popover or hint, then a pick, then the past (ADR 005).
- **Fork.** Fork, before Regenerate, opens a popover (`ForkButton` in `Fork.tsx`) with an instruction box, a Carries over list from the same `carryOver` the service writes with (each slot's variant, the settings to bake, the open pins on those variants) and a footer saying it starts a new T3 thread. A carried variant that failed to render on the canvas shows a warning first. Send calls `POST /v1/ui/sessions/:id/fork` and opens the fork. While its thread starts, the request phase reads "Starting a T3 thread…"; a failed start offers Retry and Discard fork, which opens the parent. A fork's breadcrumb shows its lineage between the project and the title, the nearest two ancestors as links and the rest folded into an ellipsis, and its sidebar has a "Forked from" link under its thread. Home rows carry a branch mark, and cards a "Fork of <parent> · iteration N" line.
- **Vary.** The Inspector has a Vary row above Feedback (`VarySection` in `Vary.tsx`). Vary element starts a pick with its own hint in the canvas bar, "Click an element to vary", and the pick opens a popover where Rob clicked, as the pin composer does: the element and its block, how many (1 to 6, default 3), an optional direction, and the slot the variants land in. Send sends `vary`, which opens a request on Regenerate's lifecycle. New variants carry a "new" mark in the slot's list until they have been on the canvas for 1.5 s, when the renderer sends `mark_seen`.
- **Notices.** A failed call shows a notice bottom right with a close button. It stays until Rob closes it or the next call he makes succeeds.
- **Shortcuts.** Ctrl+B toggles the sidebar and Ctrl+R opens Regenerate, each named in its Hint. Ctrl+Shift+S, T3 Code's settle chord, settles or brings back the brainstorm focused in a list, or else the open one. On home, `/` and Ctrl+F focus the search. Left and right move between slot tabs. Ctrl+Enter sends from the composer, the Regenerate box, the Fork box and the vary popover, each showing the key, and Escape closes overlays, pick mode and the composers, then leaves a past iteration. In the history strip, Left, Right, Home and End move between iterations. The canvas frame forwards Ctrl, Cmd and Escape keys it doesn't handle as `key` messages, and the host replays them, so shortcuts work while the canvas has focus.
- **Thread checks.** The open brainstorm sends `check_thread` every 15 s and on window focus, so a thread that vanishes while nothing is in flight shows as lost.
- **Inspector.** It collapses to a 40 px rail from the right panel toggle at the end of the header, with a button to expand it and the feedback count; the rail is kept in `ui_pref`. The inapplicable-override banner sits under the block header, or above the empty text when nothing is selected, with Dismiss among its own actions (`CalloutItem`); it covers the whole session, removed blocks included, so it doesn't depend on the selection. Then the controls for the selected block: one json-render `Renderer` per block over a custom `StateStore` whose values are the block's effective appearance props. Its `set` repaints the frame at once and sends `set_override` 250 ms after the last change. A pending edit is dropped once a view agrees with it, or when the server refuses it. A control with an override shows a reset button, which sends `clear_override`. The feedback list sits below, grouped open, addressed and confirmed. Each item shows its text, then its block and part, then on its own line "In iteration n" (or "Addressed in iteration n" once confirmed, "Previously addressed in iteration n" once reopened), since the group heading already names the status, and notes a pin that is detached, on a variant that isn't showing, or on a removed block. Addressed items offer Confirm and Reopen, confirmed ones Reopen, and open ones Edit and Delete. Delete asks in place, with Cancel focused and Escape cancelling. Clicking an item selects its slot (switching to its variant if needed) and pulses its pin, and clicking a pin focuses its item. "Pin comment" enters pin mode, and a pick opens a composer 12 px under the picked element (above it when there is no room) that sends `add_feedback`, with the pin to be drawn on the element's corner where the saved pin will land. Before the first iteration the Inspector says when settings appear, and Pin comment is disabled.

Selection is a slot, not a block, so switching a slot's variant keeps the controls on that slot. A pointer-down in a frame selects its slot.

The top bar is the window header. It shows the project and session as a breadcrumb (with a fork's lineage), its iteration and the request phase, Fork, a Regenerate menu, Export, the history toggle and the right panel toggle.
- **Regenerate menu.** A popover with Everything, Selected blocks (a checkbox per block, grouped by slot, defaulting to the selected one) or Describe it (free text required). Each takes optional free text, in a field right under the scope switch so neither moves as a scope adds its block list below, and lists the open feedback in scope before sending, through the service's own `requestFeedback`. Regenerate is disabled unless `view.regenerate.ok`, and its tooltip says why, in `blockedMessage` from `machines.ts`. A disabled Send can't show a Hint, so the footer says what it waits for. While a brainstorm loads, Fork, Regenerate and Export are held in place, disabled.
- **Request status.** The phase's icon and `phaseMessage` copy after the title, and that row's actions at the start of the header's right cluster, then a divider, then Regenerate and Export, so an action keeps its place as the message changes length. Send failed, thread lost and no change are too long for the bar, so the bar names the phase and a tone strip under it holds the whole message. The fulfilled message names changed blocks by title, two and then a count. When the bar is crowded by a long title or a narrow window, the title and message truncate and the actions keep their room. Sending spins and working pulses; queued, asking and the end states are static, so asking never looks like endless progress. Phase actions are full-height outline buttons, like Regenerate and Export. Retry and Resend send `retry_request`, Withdraw `withdraw_request`, Open thread is a link to `thread.link` that the window-open handler sends to the browser, and Copy phrase copies `takeoverPhrase(title)`, showing a check and "Copied" at the same width.

The renderer reads the UI token from `location.hash`, strips it from the URL and history, and keeps it in a closure in `api.ts`. It refetches the session list on each event from `/v1/ui/events`, and the open session's `SessionView` when the event names it, and both whenever the stream reconnects. The open session's state lives in `SessionWorkspace`, keyed by session id, so opening another brainstorm starts from nothing, and going back to the home list keeps it. The server serves the built renderer at `/` and `/assets/*` only, under `default-src 'self'` (styles may be inline).

The registry implements our catalog with the app's own Base UI shadcn components (`src/renderer/components/ui`: `Slider`, `Select`, `Switch`, `Input`, `Textarea`, `Segmented`), each wrapped in one label row and bound through one `useBound` hook over json-render's `useBoundProp`, which applies the prop's default and label. `@json-render/shadcn` is not used: it is built on Radix, and the catalog's schemas live in `src/core/controls.ts`, so nothing needs it. `Colour` is a native `<input type=color>` with a hex field that commits only a complete `#rrggbb`. A derived spec's Section title repeats the block title, which the panel header already shows, so it is hidden.

## Export

`exportHtml` writes `exports\<session>-i<n>-<yyyyMMdd-HHmmss>.html`, stamped in local time because that is what Rob reads in Explorer. It's one file: `buildCanvasDocument(exportPayload(iteration), "export")`. The payload is what a host would send: `modules` for every variant (so any of them can be shown), `variants` with each slot's variants and titles, and `state` with the frames on Rob's choices and every block's effective props. The runtime draws the in-page switcher from `variants` and switches locally. It needs no network and no server, and loads with no console errors.

The Export button shows the file's path with Show in folder. The renderer has no preload, so Show in folder is a link to `/reveal-export/<file>`. Electron's window-open handler catches it, checks the name is a bare `*.html` file name, calls `shell.showItemInFolder` on it inside `exports`, and opens no window. The server never sees that URL.

## Verification harness

- **Fake T3.** `test/fake-t3/t3.cmd` plus `fake-t3.mjs` drive threads from a JSON state file named in `BRAINSTORM_FAKE_T3_STATE`. Each thread has `projectId`, `status`, `activeRunId`, `pendingRequestCount`, `messages` and `missing`. `send` appends messages and records them. `start` makes a thread in a known project with its first message, records it in `started` and prints `--json` as the real one does, and `list` adds each thread's `createdAt`. A `fail` flag forces exit 1: `true` for every command, or a list such as `["send"]`. `failAfter: ["send"]` delivers and then exits 1, as when the CLI loses the reply. `test/fake-t3/control.mjs` moves a thread the way T3 does for verify scripts: a run takes the queued messages, can wait for an answer (`pendingRequestCount`), and ends completed or failed. Its JSON mirrors the real shapes recorded in `docs/t3-cli.md`.
- **Unit tests** use `vitest` on `src/core` against literal expected values.
- **Verify scripts.** `npm run verify:<n>` (`scripts/verify/<n>-*.mjs`) starts the real artifact with a temp `BRAINSTORM_HOME`. That's the headless server plus the real CLI for item 1, and Playwright `_electron` for the app items. Each script prints `VERIFIED` or exits non-zero with what failed. The app scripts save screenshots to `test-results/verify-<n>/` and fail on any error or warning the window logs. They open the seeded session from the home sidebar, as Rob does. `verify:7` checks the shell itself and saves its light and dark screenshots to `test-results/shell/`. `verify:8` checks history, fork and vary (ADR 005).
- **Design lint.** `npm run lint:design` (`scripts/design/lint.mjs`) fails on an arbitrary-value utility in `src/renderer` outside `components/ui`, a raw hex or colour function in any renderer string, and any utility the closed theme in `styles.css` doesn't generate, with numeric `z-*`, sizing-only steps on padding, margin or gap, and rings wider than 2 px. It also fails a raised fill or floating shadow outside `components/ui/overlay.ts`, which owns the one surface every popover, menu, tooltip and toast is drawn on (`surface-recipe`); a native `title=` hint on an element or kit component, where the kit `Hint` belongs (`title-hint`); a class that restyles a kit component with variants instead of placing it (`kit-override`); a focus ring in any colour but the full-strength `ring` token (`focus-ring`); and a button written into a `Callout`'s message instead of its `actions` or a `CalloutItem`'s (`callout-actions`). It fails any iframe that isn't a canvas page, `/canvas` or `/canvas/preview`, under `sandbox="allow-scripts"` and nothing more (`frame-sandbox`), so a preview can never run agent code with more privilege than the canvas. `test/design-lint.test.ts` runs it on the renderer, so `npm test` fails too. The tokens live in `src/core/design.ts`; `npm run design:tokens` regenerates `src/renderer/design.css` and a test fails if it is stale. `scripts/design/codemod.mjs` moves classes onto the scales, and `npm run design:checkpoint` builds the before and after sheets in `design-review/checkpoint/`. `docs/design-system/adr-001-foundation.md` records why.
- **Demo seed.** `scripts/seed-demo.mjs [<home>]` builds the cyberpunk chore roulette (`wheel` with three variants, `result` with two, under `scripts/demo/`) through the real CLI and the fake T3, as an agent would. Without a home it uses `$BRAINSTORM_HOME`, else a temp directory, so a real store never gets the fake thread.
- **Live check.** `npm run verify:live` (`scripts/verify/live-t3.mjs`, not part of `npm test`) runs the app on a temp home with the real bridge. It starts a real T3 thread on a worktree of the current branch that runs `/ux-brainstorm` on a one-slot task, sends a Selected blocks request from the window, takes the session over from a second thread and sends Everything, then forks the latest iteration from the window. The app starts the fork's thread, and the check waits for that thread's agent to attach from its first message alone and fulfil it. It checks each exact `[brainstorm]` message in its thread and each fulfilled top bar. T3 starts agents with its own environment, so each thread's first message tells the agent to set `BRAINSTORM_HOME` on every `brainstorm` command. It refuses to start unless the T3 CLI exists, `brainstorm` is `npm link`ed to this repo and the installed skill matches; `--preflight` checks only that. Waits poll `t3 thread show` every 15 s within 30 minutes, and it prints the thread links and `VERIFIED`.

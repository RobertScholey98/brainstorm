# Brainstorm v0.1: handoff brief

You are building **Brainstorm**, a local Electron app for iterating on UI designs with an agent. Rob Scholey is the user and the only person who can settle anything marked **Confirm**. Every other decision here has already been made with him, and the reasons are given so you can apply them to cases this brief doesn't cover.

## What it is

Brainstorm is a design canvas attached to a T3 Code thread. An agent in T3 builds a design as switchable, adjustable **blocks**. Rob looks at it in Brainstorm, adjusts the controls, and pins feedback to specific elements. Then he clicks **Regenerate**, or types a free-text request such as "regenerate the wheel and the result sheet according to the feedback". The request goes back to the T3 thread. The agent changes only the blocks in scope and commits a new **iteration**, and Brainstorm swaps in the changed blocks.

It replaces the current `/ux-brainstorm` skill (`~/.claude/skills/ux-brainstorm`). That skill produces a static A–E HTML report, and its UX method (`references/ux-method.md`) is still the thinking behind the designs. Brainstorm changes the output into an iterative canvas, not the method.

## Settled decisions

| Decision | Why |
|---|---|
| Electron app | It needs to read and write SQLite, run the `t3` CLI, serve a localhost API and sandbox code the agent writes. A browser tab can't do those. |
| One app-wide **SQLite** database is the only store of record | Brainstorm is meant to be a reusable tool with proper storage, not a viewer for scattered JSON and HTML files. |
| Data lives in `%APPDATA%\brainstorm\`: `brainstorm.db`, `exports\`, `api.json` (localhost port and token) | Same convention as T3 using its own app-data folder. |
| **Agents talk only to Brainstorm's server, through the `brainstorm` CLI.** They never write to `%APPDATA%\brainstorm`. | Brainstorm owns saving and loading. This also avoids any permission setup in Claude Code or Codex. |
| **CLI first**; an MCP wrapper is a later option | A CLI works the same for every provider T3 runs (Claude, Codex) and needs no registration. The skill tells the agent which commands to use. |
| **T3 owns the conversation.** Brainstorm calls the thread back with `t3 thread send` and never runs its own agent. | The thread stays in T3, Rob can keep talking to it there, and Brainstorm needs no Claude login or agent runtime. |
| **A session belongs to exactly one T3 project**: the project of the thread that created it. A project can have many sessions. | Brainstorm is used on existing projects, started by calling `/ux-brainstorm` in a T3 thread on that project. |
| **Any thread in the same project can take over a session**, from the T3 side, by running `brainstorm session attach`. The app has no thread picker. | Rob wants to start a new thread and say "pick up the brainstorm session titled xyz". |
| **Blocks are code; controls are json-render specs** | Blocks have to copy each product's real look and differ between variants, so a fixed component catalog would limit them. Controls are a small fixed set, which is what json-render's catalog and Zod validation are good at. |
| Agents edit blocks in a **disposable working copy**: `pull` to a folder the agent chooses, edit with normal tools, then `commit --from` | Agents edit files precisely. Sending code through shell quoting (especially PowerShell) is fragile. The working copy is only for moving files back and forth; Brainstorm stores nothing there. |
| The agent's report back is **`brainstorm commit`**, which validates before it returns | Errors go straight back to the agent, so Rob never sees a broken canvas. The agent's chat reply in T3 is commentary and isn't part of the protocol. |

## Data model

```
project      t3ProjectId, repoPath
session      id, projectId (immutable), title, brief, attachedThreadId, status
session_attachment   sessionId, threadId, attachedAt          (history: trace iterations to threads)
iteration    sessionId, n, threadId, note, createdAt, addressedFeedbackIds
block        iterationId, blockId, slot, variant, code, propsSchema, controlsSpec
slot_state   sessionId, slot → active variant
override     sessionId, blockId, prop → value                 (Rob's control values, NOT agent defaults)
feedback     sessionId, id, blockId, elementPath, text, status (open | addressed | confirmed), createdIn, addressedIn
```

- **Overrides survive regeneration.** When a block's props schema changes, keep each override whose prop still exists with a compatible type. Drop the rest and flag them to Rob. Without this, every regenerate wipes his adjustments.
- **Feedback is pinned to stable ids.** Blocks put `data-bid` and `data-part` on their meaningful elements, and `elementPath` refers to them, so pins still land on the right element after a regenerate.
- **Diff, don't trust.** On commit, the server works out which blocks changed by comparing against the previous iteration, whatever the agent says.
- **Leave room for data inputs.** A props schema should separate *data inputs* from *appearance controls*. Later versions will show data flow and state boundaries. v0.1 doesn't build that, but the block format needs to allow it.

## CLI contract

The `brainstorm` CLI is a thin client for the app's localhost API. It reads the port and token from `api.json`, and starts the app if it isn't running. Every command takes `--json`.

```
brainstorm session new     --project <path> --thread <id> --title <t> [--brief -]
brainstorm session list    --project <path>
brainstorm session attach  <id|title> --thread <id>
brainstorm context         <session>                      # brief, open feedback in scope, free text, scope
brainstorm pull            <session> --out <dir>          # current iteration → files
brainstorm commit          <session> --from <dir> --thread <id> [--addresses 4,7] [--note <text>]
brainstorm validate        <session> --from <dir>
```

Rules the server enforces:

- **`attach` checks the project.** It refuses a thread from a different project. When a title matches more than one session, it lists the candidates instead of guessing.
- **Commits are tied to the attached thread.** `commit` must include `--thread`. The server rejects a commit from any thread other than the attached one and names the thread that now owns the session. This covers a queued message or an earlier run still finishing in the old thread after a takeover.
- **`commit` validates before saving.** It compiles every block, checks each controls spec against the control catalog, and checks props schemas and override compatibility. Nothing is saved unless all of it passes, and every error comes back in one response.
- **Optional: `apply`.** You may add `brainstorm apply <session> -`, which takes `[{block, old, new}]` on stdin, for small edits without a working copy. It isn't required for v0.1.

## The loop

1. Rob opens a T3 thread on a project and runs `/ux-brainstorm`. The agent works through the UX method, runs `session new --project . --thread $T3CODE_THREAD_ID` (T3 sets that variable for its agents), builds the first blocks in a working copy, and commits.
2. Brainstorm shows the session: a canvas, a variant switch for each slot, a controls panel, and pinned feedback.
3. Rob adjusts controls (saved as overrides) and pins feedback.
4. Rob clicks Regenerate. The options are everything, the selected blocks, or free text.
5. Brainstorm saves the request and runs `t3 thread send <attachedThreadId> -` with a short, structured message that refers to the session instead of including its contents:
   `[brainstorm] session <id> · iteration request 5 · scope: wheel, result-sheet · feedback: #4 #7 · freetext: "make the spin feel less random"`
   It shows the request as **queued**. If the thread is busy, the message becomes its next turn.
6. The agent runs `context`, then `pull`, edits only the blocks in scope, and runs `commit --addresses 4,7`. Validation errors come back, and the agent fixes and commits again.
7. Brainstorm notices the new iteration, swaps in the changed blocks, keeps overrides, and marks feedback #4 and #7 as **addressed** for Rob to confirm.

## T3 integration

The T3 CLI is at `%USERPROFILE%\.t3\bin\t3.cmd`; agents also see its path in `T3CODE_CLI_PATH`. Its `--help` output is the source of truth, so check it before building against it. As of 2026-11-05 it offers:

- `t3 thread send <thread> <message|->`, with `--wait` and `--json`. A busy thread gets the message as its next turn. With `--wait`, exit code `1` means the run failed and `2` means the agent is waiting for an answer.
- `t3 thread show <thread>`, with `--json` and `--messages N`.
- `t3 thread list --project <path>`, with `--json`.
- `t3 thread start <project> <message|->`, with `--worktree`, `--branch`, `--title`, `--model` and `--wait`. Not used in v0.1; it's for the later Build handoff.

Nobody has inspected the JSON these commands return yet. Run them and record the fields you rely on.

Put every T3 call behind one **`AgentBridge`** interface with `send`, `status` and `onReply`, implemented with the `t3` CLI. The CLI may change between T3 versions, and a later fallback such as `claude -p` should mean changing one file. Have the bridge cover these cases:

- **Thread missing or deleted:** show the session as unattached and tell Rob to attach it from a T3 thread.
- **Send failed:** keep the request saved and offer Retry.
- **Exit code 2 / agent waiting for an answer:** show "the agent is asking something in T3" instead of a spinner that never stops.

Send without `--wait`, then follow progress with `brainstorm commit` arriving and with `t3 thread show`.

## json-render notes

Facts from a test run on this machine:

- **Versions:** the packages were at 0.22.0. Peer dependencies are React 19 and Zod 4. It's a pre-1.0 Vercel Labs project, so pin exact versions.
- **Install locally:** packages installed with `npm i -g` can't be imported. Add them as normal dependencies of the app.
- **shadcn is separate:** `@json-render/shadcn` is its own package, needs Tailwind, and isn't installed by `@json-render/core` or `@json-render/react`.
- **It renders inside a running React app**, which suits the Electron renderer.
- **There's no CLI and no static HTML renderer.** Export HTML is Brainstorm's own job.
- A reference spec from the test run is at `C:\Users\RobScholey\.t3\scratch\2026-11-05-i-m-thinking-about-setting-f26ff7dd\tester\_build\src\spec.js`.

Build a fixed **control catalog** (slider, select, colour, toggle, text, variant switch) with `defineCatalog`, using shadcn components for the controls panel. Each block's controls spec binds a control to one of its props with `$bindState`. Use `catalog.prompt()` as the control vocabulary that `context` gives the agent.

## Safety

Blocks are code written by an agent. Render the canvas in a sandboxed iframe, with `contextIsolation` on and `nodeIntegration` off for anything that runs block code. Compile blocks inside the app (esbuild-wasm or sucrase). The localhost API binds to 127.0.0.1 only and requires the token from `api.json`.

## v0.1 scope

Each item is done when the condition after the dash can be seen working:

1. **Storage and API.** SQLite schema, localhost API and `brainstorm` CLI with every command in the CLI contract. — Each command works from a T3 thread in a real project, including `attach` refusing a thread from another project and `commit` refusing a thread that isn't attached.
2. **Canvas.** Blocks render in the sandboxed iframe, with a variant switch per slot. — Switching variants keeps the overrides of the other blocks.
3. **Controls panel.** json-render, bound to block props, with overrides saved. — A value survives an app restart and a regenerate that keeps that prop.
4. **Feedback.** Click an element with `data-part` to pin a comment, which moves through open, addressed and confirmed. — A pin still sits on the right element after its block is regenerated.
5. **Regenerate** (everything, selected blocks, free text) through `AgentBridge`. — A full round trip from the button through the T3 thread to a commit and a swapped canvas works, and the queued, failed, waiting-for-an-answer and missing-thread states each show correctly.
6. **Export HTML.** The current iteration with current overrides as one offline file in `exports\`. — It opens from disk with no server running and no console errors.
7. **Rewrite `/ux-brainstorm`.** It keeps the UX method (task brief; remove, infer, default, defer or ask now; meaningfully different variants) and drives the loop above instead of producing an HTML report. It also handles `[brainstorm]` messages: run `context`, change only the blocks in scope, commit with `--addresses`, reply in one short line. — A fresh thread can run `/ux-brainstorm` from start to finish, and a second thread can take the session over by title.

## Out of scope for v0.1

- The Build handoff (`t3 thread start` in a new worktree)
- A chat panel in Brainstorm
- An MCP wrapper
- Data-flow and state-boundary visualisation
- Syncing between machines; a session and its T3 thread are on the same machine

## Confirm with Rob before building

- **Block format:** the default is React components (TSX/JSX compiled in the app); plain HTML fragments are the alternative.
- **Design context:** the default is freeform. Should a session be able to load a project's design tokens or components so blocks match the product?
- **Repo:** the name and GitHub location of the Brainstorm repo, and how the `brainstorm` CLI gets on PATH on each machine (for example an npm package in the same repo).

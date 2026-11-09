# T3 CLI facts Brainstorm relies on

Observed on 2026-11-05 against `%USERPROFILE%\.t3\bin\t3.cmd`. `src/core/bridge/t3.ts` is the only code that depends on these. Re-check them with `t3 <cmd> --help` when T3 updates.

## `t3 thread show <thread> --json --messages N`

```json
{ "thread": { "threadId": "8ee90f34-…", "projectId": "f0d48734-…", "title": "…", "link": "https://app.t3.codes/threads/…",
              "status": "running", "latestRunId": "run:thread:…:ordinal:1", "activeRunId": "run:thread:…:ordinal:1",
              "pendingRequestCount": 0, "worktreePath": "C:\…", "branch": "…", "archived": false, "settled": false },
  "messages": [ { "role": "user", "runId": "run:thread:…:ordinal:1", "text": "…" } ] }
```

Fields used: `thread.projectId`, `thread.title`, `thread.link`, `thread.status` (seen: `running`, `completed`, `failed`, and `waiting` for an idle thread whose run finished, which the bridge reads as `completed`. `starting` and `preparing` appear while a new run spins up. The bridge reads them as `unknown`, which is harmless because only `failed` changes what Brainstorm shows), `thread.activeRunId` (null when idle), `thread.latestRunId` (tells a finished run from a message queued as the next turn), `thread.pendingRequestCount` (> 0 means the agent is waiting for an answer), and `messages[].role`, `runId` and `text`.

A missing or deleted thread exits 1 and prints `Thread <id> is no longer available.`

## `t3 thread start [flags] <project> <message|->`

Observed on 2026-11-06 (`t3 v0.1.8-nightly.20261104.4179`). It starts a thread in the project and prints its id. `<project>` is a project id or a path inside the project. `-` reads the message from stdin.

- `--title <t>` names the thread. Without it the title is the message's first line.
- Without `--worktree` the thread runs in the project folder. `--worktree <base-ref>` runs it in a new git worktree based on that branch, tag or commit, and `--branch <name>` names that worktree's branch (it needs `--worktree`).
- `--provider <id>` and `--model <slug>` go together; the model defaults to the project's.
- `--wait` waits for the reply, exiting 1 if the run fails and 2 if the agent waits for an answer.
- `--json` prints `{ "threadId": "…", "projectId": "…", "runId": "…" | null }`.
- `--base-dir <dir>` picks another T3 data directory, like `T3CODE_HOME`.

Brainstorm runs `thread start --title "<safe title>" --json <projectId> -` for a brainstorm's fresh thread and for a promotion, with the first message on stdin, no `--worktree` (the brainstorm's agent runs in the project folder) and no `--wait`. Branches start no thread of their own; they share their brainstorm's (ADR 009). The title goes on the command line, so `safeTitle` in the bridge keeps only letters, digits, spaces and `,.'()?+=/_-`, cut to 80 characters, and quotes it. The bridge reads only `threadId`.

## `t3 thread send <thread> <message|->`

A busy thread gets the message as its next turn. `--wait` exits 1 if the run fails and 2 if the agent waits for an answer. Brainstorm sends without `--wait`, with the message on stdin (`-`).

Agents running in T3 get `T3CODE_THREAD_ID` (their own thread) and `T3CODE_CLI_PATH`.

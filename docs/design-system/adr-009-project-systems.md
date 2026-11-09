# ADR 009: A project's design system

Status: accepted. It extends ADR 007 and ADR 008. Rob raised it on 2026-11-08: with a new worktree selected, which he
always has, "that new worktree folder isn't automatically linked to a design system", and in a new T3 project there
is "no way to get it to use that design system (besides saying 'use design system x' which seems flaky and
unreliable)". He agreed to the design below in the same conversation.

## Context

A session builds with one design system or none (ADR 007). The agent chose which. The skill told it to run
`brainstorm system list` and pass `--system` "when the product's UI comes from one of the listed design systems". A
system remembers its source folder, such as `C:\Users\rober\code\app`. An agent in a worktree runs in
`~\.t3\worktrees\app\t3-…`, so the paths don't match, the agent decides no system fits, and `session new` makes a
freeform session without a word. In a new project no system's folder matches at all, so naming one in chat was the
only way, and the agent had to remember it on every brainstorm.

Brainstorm already knows each thread's T3 project, from `t3 thread show`. It is the same in every worktree of a
project, which is why `docs/design.md` keys sessions by it and never by path.

## Decision

### Each project has a design system, or none

- **Keyed by T3 project.** Brainstorm keeps one system per T3 project (`project_system`). Every thread on the project
  shares it, in the main checkout or any worktree.
- **`session new` uses it.** A session builds with its project's system unless the agent names another with
  `--system <id|name>`, for that brainstorm only, or passes `--system none`. The output names the system and says when
  it is the project's, so a wrong one is visible in the agent's transcript.
- **A system awaiting Rob's review refuses the session**, as a named one does (ADR 008). The message adds that it is
  the project's system and that `--system none` makes a brainstorm without it. A project's system is never skipped
  silently, because silent skipping is the bug.
- **No system means freeform**, and the output says the project has none and how to set one.

### Three ways to set it

- **`system add`** makes the new system its project's, unless the project has one already. This covers an imported
  system and every worktree after it with no extra step. A system belongs to the known project whose repo holds it,
  compared by the main checkout's `.git`, so a project known from a worktree matches and, in git, a parent folder doesn't;
  Promote and reviews start their threads there. Brainstorm stores each project's `.git` when it first sees a folder
  of the project, so the match holds after T3 removes the worktree. When an agent on another project adds it, as with a shared library
  in its own repo, that project builds with it too. Without a match, the adding thread's project is the system's.
- **`brainstorm project use <system|none>`** sets or clears it from any thread on the project. This is how a new
  project starts from a system Rob already has: he tells the agent once, and the choice is stored, not remembered.
  `brainstorm project show` prints it.
- **The Design systems page.** A system's header has a Projects control listing every project Brainstorm knows, each a
  checkbox. Checking a project another system has moves it, and the row says which system it uses now. The card lists
  the system's projects.

The window lists only projects Brainstorm has seen: those with a brainstorm, those a system came from, and those set
from a thread. T3's CLI can't list projects, so a project that has none of these is set from its own thread.

### The skill stops choosing

The skill no longer matches systems to the product. It runs `session new`, and only when Rob names a system does it
act: `project use` when the project has none, so later brainstorms keep it, or `--system` for this brainstorm when the
project has another.

## Data

Store migration 10 (`src/core/store.ts`):

```
project_system        project_id -> system_id, set_at
project               + repo_git, the main checkout's .git
```

The migration gives each project that exactly one system came from that system, so that project's next brainstorm
builds with it where it was freeform before. A project that several came from has none until Rob picks. `project` rows are now also made for a system's project on `add`, named after the repo, so the
window can name it; a row made without a path takes the first path a session gives.

## Alternatives not taken

- **Match the worktree to the system's folder by its git common dir.** It fixes worktrees but not a new project, and
  it stays a guess about which system a project uses.
- **A committed `.brainstorm/project.json` naming the system.** It would follow the code into worktrees, but system
  ids are local to one Brainstorm install, and every new project would need a commit to use a system. The adapter
  (ADR 008) stays the project's record of its own system; which system a project's brainstorms use is Brainstorm's.
- **Several systems per project.** A session holds one system (ADR 007), so a default has to be one. `--system`
  reaches any other.
- **Leave the choice to the agent.** That is the flaky behaviour this replaces.

## As built

- `test/projectSystem.test.ts` covers the project's system from a main-checkout thread and a worktree thread on the
  same project, the refusal while it awaits review, `--system none`, a named system for one brainstorm, a second
  system from the same project, a new project set by `project use`, and clearing it.
- `test/store.test.ts` covers the migration's backfill.
- `--system none` means no system, in any case. A system named "none" is still reachable by its id.
- A system name Brainstorm doesn't have fails with the names it does, so the agent can correct a name Rob said loosely.
- `brainstorm project use` checks the system before it records anything, and says when the system still awaits Rob's
  review, since the project's brainstorms are refused until he confirms it.
- The skill's one-line reply names the design system a brainstorm builds with, or says it has none.
- The council review found that round 1's "the adding thread's project wins" sent Promote to the wrong repo for a
  library in another repo; the repo comparison replaced it, and `test/projectSystem.test.ts` covers that case.
- Round 3 found that a project known only from a removed worktree no longer matched, since its folder was gone. The
  stored `repo_git` fixes it. `system add` sends the agent's folder only for the agent's own thread, since
  `--thread` can name another project's. Adding a folder that is already a system says how to use it with
  `project use`.
- Round 4 found the same folder problem in `session new` and `project use`: with `--thread` naming another project's
  thread, the agent's folder stamped that project with the wrong repo and name. They now send a folder only for the
  agent's own thread or an explicit `--project`.
- Round 5 found that a project Brainstorm knows only from a system, added by path from a thread elsewhere, has no folder
  to compare. The repo match also checks each system's own folder. `system add` now says when the agent's project
  keeps the system it had, so a switch the agent assumed shows in its transcript.
- Round 6 found that the round 5 match could name a project whose repo Brainstorm knows to be another, because it once
  added a library from this repo. Only a project with no known repo matches by its systems' folders now. The window's
  route refuses a project Brainstorm doesn't know, which would otherwise show up in every picker.
- Round 7 found that a project matched through another library's folder was stored with that library's repo, and the
  first repo stored is kept, so its own repo never matched afterwards. A project's repo now comes only from its own
  folder. An explicit `--thread` equal to `$T3CODE_THREAD_ID` counts as the agent's own thread.
- `system add` takes no `--project`: with `--thread` naming another thread it sends no folder, and the library's
  project comes from the repo match alone.
- A project whose only system was still awaiting Rob's review before the upgrade gets that system too, so its
  brainstorms are refused until he confirms it, where they were freeform before.
- "Unless the project has one already" reads the project as it is now. A project cleared with `project use none`
  takes the next system added from it.

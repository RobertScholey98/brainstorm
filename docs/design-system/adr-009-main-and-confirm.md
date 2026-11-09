# ADR 009: Main, confirm and branches

Status: accepted. Rob asked for it on 2026-11-08: "The sidebar feels cluttered right now, and it's hard to see how
moving forward works. I don't want the sidebar to be full of stuff I'm not keeping." He settled the questions below in
the same conversation. It changes ADR 005's fork: a fork becomes a branch of the same brainstorm, on the same thread.

## Context

A brainstorm only grows. Each vary adds variants, and nothing takes them away, so the sidebar fills with options Rob
has already turned down. The only way to narrow a brainstorm to what he likes is Fork, which starts another brainstorm
and another T3 thread. Rob's words: "It should move forward over time. Fork is only intended for being able to go back
and try out something different from a history point."

## Decision

### Main

Each slot has a **Main**: the design Rob is carrying forward. It is the slot's kept variant plus the elements he has
asked to bring into it. Rob builds it with three marks, and none of them runs the agent:

- **👍 on a variant** makes it the slot's Main, or, when the slot has a Main and the variant is a vary option, adds the
  varied element to Main as a **graft** ("the spin button from Spin button B"). A variant is a vary option when a
  fulfilled vary request named it, and its varied part comes from that request (`BlockView.variedFrom`).
- **Pick** takes an element from any variant, in any slot, into a Main. It works as Vary's pick does: Rob clicks an
  element and a popover opens where he clicked, with an optional instruction and the slot whose Main it goes into
  (the current slot by default; another slot is allowed but uncommon). With no instruction the agent places it as it
  judges best. A pick is a graft too.
- **🗑 on a variant** trashes it. It leaves the options list and the board at once. A fold at the foot of the slot
  ("2 trashed") brings one back. Main can't be trashed, nor a slot's last variant left showing.

The marks are Rob's rows (`main_choice`, `graft`, `trashed`), per branch. They describe the latest iteration only. A
regenerate or vary leaves them in place; a mark whose block is gone is dropped on read.

A slot with one variant and no mark has that variant as its Main, so after a confirm every slot has a Main without
Rob marking it again. The same holds once trashing leaves one variant showing: the last one left is Main.

### Confirm

Confirm, at the foot of the sidebar, locks the marks in. It opens a popover that lists, per slot, what Main will be
(its variant and grafts) and how many options go, then sends. The new iteration holds only:

- in a slot with a Main: Main, with its grafts applied
- in a slot with no Main: its variants that aren't trashed

Confirm is a request with scope `{ kind: "confirm", mains, grafts, drop }` (`drop` lists every block the confirm removes: trashed options and the options beside a Main), so it shares Regenerate's gate, phases
and history origin.

- **Nothing to graft.** The app answers the request itself. It writes the narrowed iteration, keeping each block's
  content and Rob's settings as they were, and marks the request fulfilled. No agent turn runs. Its marker and context
  still exist, so the request reads like any other in the history.
- **Grafts.** The request goes to the agent. `brainstorm context` spells out each graft (source block, part, target
  slot, instruction) and which variants to delete. A commit that answers it warns `confirm_mismatch` when a slot with
  a Main still has other variants, a Main is gone or renamed, Main lacks a grafted part, or a Main that receives
  grafts comes back unchanged (a vary option's part already renders in Main, and a whole block has no part to look
  for), and `out_of_scope` when it changes any other block. The settings and pins it drops with the variants are no news, so they raise no
  `override_dropped` or `pin_lost`.

A confirm clears the marks it carried once its iteration lands. While it is open, the marks stay as they were sent and
Rob can't change them. A graft still waiting for its slot's Main was never part of the confirm, so it stays. A confirm
Rob withdraws before its commit lands is no longer open, so that commit lands as the agent's own: the confirm stays
withdrawn, the marks stay except those naming a block or slot the commit removed, and nothing is let go of.

A confirm as a branch that asks the agent nothing still shares the gate: it waits for an open request and for a lost
thread to be replaced, like Confirm at the latest.

When its iteration lands, a confirm also lets go of what belonged to the variants it dropped: Rob's settings on them,
and his open pins, which are deleted as when he deletes one. No later request asks the agent about a block that is
gone, and no setting shows as kept but not applied. On the agent path only the variants the commit did drop go; one it
kept against the confirm keeps its settings and pins.

### Confirms are like commits

Each fulfilled confirm starts a new run of history. The strip shows the iterations since the latest confirm, the
confirm's own iteration first. At the strip's left, a dropdown lists the confirms, newest first ("Confirm 3 · 2 days
ago · Kept Floating label"), and "Start" for what came before the first. Choosing one shows that run. The strip's keys
and the past view work as before inside the run that shows.

### Branches replace forks

A **brainstorm** is now a tree of branches. Its first session is the root; every other is a branch made from one of
its iterations. They stay sessions in storage, linked by the `fork` row, so requests, pins, settings and marks keep
working per branch without change.

- **Making one.** Going back in history and confirming there makes a branch. Rob can 👍, pick and trash on the past
  iteration (kept in the renderer, as ADR 005's past picks are), and Confirm reads "Confirm as a branch". The branch's
  first iteration is that iteration with Rob's settings baked in as defaults, as a fork's was, on the thread the tree
  shares. Without grafts it is narrowed by the marks too. With grafts it starts un-narrowed and carries the marks,
  since the agent merges from the graft sources and must still have them; the agent's commit does the narrowing.
  With grafts, its request 1 is the confirm and goes to the thread; without, the app answers it: request 1 is the
  confirm, fulfilled by the branch's first iteration, so that iteration reads as the confirm in the strip and the top
  bar. With an instruction and no grafts, request 1 is the instruction instead, and the first iteration reads as the
  branch point. The Fork button goes; its optional "what to try" box moves into the confirm popover and names the
  branch.
- **One thread.** Every branch of a brainstorm uses its one T3 thread. The attachment rows move together: an attach,
  an adopt or a refresh writes the same thread to every session in the tree. Only one request is open per brainstorm,
  since one thread works on one thing at a time. A branch starts no thread of its own.
- **Numbering.** A branch continues its source's numbers: a branch from iteration 3 starts at 4, so a trail reads
  1, 2, 3, 4 whichever branch it ends on. Migration 11 renumbers existing forks the same way, and a request still open on an old fork's own thread becomes send failed, since the fork now shares its tree's thread. So does a fork's open request beside another open one in its tree, whatever thread it was on. A fork that joins a lost root thread is lost too.
- **Primary.** One branch is primary: the trail leading to the final design. It is the root until Rob presses **Make
  primary** on another, which sits on the branch's line in the sidebar ("Branch from iteration 3 · Make primary").
  The `primary_branch` row records it. The primary's strip shows its whole trail, its ancestors' iterations up to each
  branch point and then its own. Every other branch, the old primary included, hangs off the iteration it left from.
  A branch that went nowhere stays an offshoot and never needs deleting.
- **Home.** Home lists one row per brainstorm, under the root's title. It opens the primary branch. Settling and
  activity are the tree's. The breadcrumb names the branch only when it isn't the primary.

### The sidebar

Top to bottom:

- "All brainstorms", as before.
- **The slot picker**, where the thread was. A dropdown of the slots, each with its count of variants not trashed, and "Add slot…".
  Add slot opens a dialog with a prompt, which can't be blank, and sends a request with scope `{ kind: "add_slot" }`; a
  commit that answers it warns `out_of_scope` when it changes or adds a block in a slot that was already there, and
  `not_addressed` when no slot was added. The picker and
  the canvas bar's slot tabs show the same slot.
- On a branch that isn't primary, its line with Make primary, under the picker, so it reads before the slot it qualifies.
- **Main** for the picked slot: its variant, then its grafts, each removable.
- **Options**: the slot's other variants, each with 👍 and 🗑 at the right, shown on hover and focus and always on the
  selected row. Then the trashed fold.
- **Confirm**, above Settings at the foot. It is off with a hint while there is nothing to confirm or a request is
  open.

### The thread moves to the top bar

The thread becomes a chip in the top bar, beside the request status: its state dot and title, a link out to T3, and a
menu with **Start a fresh thread**. That starts a new T3 thread on the project whose first message tells the agent to
attach to this brainstorm and read its context, then adopts it for every branch, as a fork's start did. It is off
while a request is open. It is also the way back from a lost thread, in place of copying the takeover phrase.

Once the new thread has started, the app reads the brainstorm's open requests again, since one may have opened or been
withdrawn while T3 started it, and moves every one still open to the new thread. A withdrawn request stays withdrawn.
The thread takes one request at a time, so the branch's own request is sent, or the first one when it has none, and
any other waits as send failed for Rob's retry. Only a request being sent to the thread, or queued or worked there,
holds it; one waiting as send failed, or whose run ended, holds nothing. So of several waiting requests the first one
retried goes, and the others wait for it. One start runs per brainstorm at a time; a second press while it runs is
refused.

## Alternatives not taken

- **👍 rebuilds Main at once.** Rob would see the merged Main straight away, but he would wait on the agent after each
  mark, since one request is open at a time. Marks are instant; Confirm is the one agent turn.
- **Branches inside one session.** Iterations, requests, pins, settings and marks would all need a branch column. A
  branch as a linked session reuses all of them, which is why ADR 005 made forks sessions too. Only the thread, home
  and the strip learn about the tree.
- **A thread per branch.** Each fork used to start a thread. Rob wants one brainstorm on one thread, and Start a fresh
  thread covers a context that has grown too long.
- **Clearing the strip on confirm.** Rob described confirms as commits. A dropdown of them keeps every earlier run one
  click away, which a reset strip would hide.

## Checks

- `test/main.test.ts`: which variant is a slot's Main, what a 👍 does on a top-level variant and on a vary option, what
  Confirm narrows each slot to, and dropping marks whose block is gone.
- `test/brainstorm.test.ts`: the marks, a confirm the app answers, a confirm with grafts and its warnings, what a
  confirm lets go of on either path, add slot, a branch from a past iteration on the parent's thread and its answered
  confirm, renumbering, one open request per brainstorm, make primary and the primary's trail, start a fresh thread
  and the requests it moves, and home's one row per brainstorm.
- `test/store.test.ts`: migration 11, including a fork whose own thread never started.
- `verify:8` drives the sidebar's marks, Confirm, the confirms dropdown, a branch and Make primary in the window.

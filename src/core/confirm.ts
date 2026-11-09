import { confirmPlan, liveMarks, showingVariant, slotShapes, trashRefusal, withApproval, withPick, withTrash } from "./main";
import type { Reads } from "./reads";
import type { IterationBlock, IterationProposed, Store, StoredIteration } from "./store";
import { proposedImports } from "./system/conform";
import {
  blockIdOf,
  issue,
  splitBlockId,
  type BlockId,
  type ConfirmScope,
  type ContentHash,
  type Failure,
  type Graft,
  type Issue,
  type IterationN,
  type Marks,
  type PartName,
  type RequestN,
  type Result,
  type RobAction,
  type SessionId,
  type SlotId,
  type VariantKey,
} from "./types";
import { blockFile } from "./workingCopy";

/** What marks and confirms need: the store they write, the service's shared reads, and the clock. */
export type ConfirmDeps = {
  readonly store: Store;
  readonly reads: Reads;
  readonly now: () => string;
};

/** A mark Rob makes on the latest iteration. */
export type MarkAction = Extract<RobAction, { kind: "approve" | "trash" | "restore" | "add_graft" | "remove_graft" }>;

/**
 * What a confirm the iteration lands for spends and lets go of: the iteration it confirmed, the confirm, the blocks it
 * dropped, and the grafts its commit didn't apply, which aren't spent.
 */
export type Confirmed = {
  readonly confirmed: StoredIteration;
  readonly blocks: readonly IterationBlock[];
  readonly scope: ConfirmScope;
  readonly dropped: readonly BlockId[];
  readonly unapplied: readonly Graft[];
};

/**
 * Rob's marks and Confirm on the latest iteration (ADR 009), and the landing every iteration the service writes goes
 * through. The rules are main.ts's; this applies them to the stored marks. Gating a confirm and sending one with grafts
 * to the thread is the service's, as for any request.
 */
export class Confirms {
  readonly #deps: ConfirmDeps;

  constructor(deps: ConfirmDeps) {
    this.#deps = deps;
  }

  /**
   * Rob's marks. They describe the latest iteration and change nothing the agent made. While a confirm is open they are
   * what it was sent with, so they hold still until it lands or he withdraws it. The next marks come from main.ts, the
   * rules the window applies too, and only what changed is written.
   */
  mark(id: SessionId, action: MarkAction, latest: StoredIteration | null, blocks: readonly IterationBlock[]): Failure | null {
    const { store, reads } = this.#deps;
    if (latest === null) return notFound("iteration", `${id} has no iteration to mark yet`);
    if (store.openRequest(id)?.scope.kind === "confirm") return invalid("a confirm is open; its marks change once it lands or you withdraw it");
    const slots = slotShapes(latest, blocks);
    const before = liveMarks(store.marks(id), slots);
    const slotOf = (b: BlockId) => (blocks.some((x) => x.id === b) ? slots.find((s) => s.id === splitBlockId(b).slot) : undefined);
    const missing = (b: BlockId) => notFound("block", `${b} is not in the latest iteration of ${id}`);
    let after: Marks;
    switch (action.kind) {
      case "approve": {
        const slot = slotOf(action.blockId);
        if (slot === undefined) return missing(action.blockId);
        const { variant } = splitBlockId(action.blockId);
        after = withApproval(before, slot, { id: action.blockId, slot: slot.id, variant, variedFrom: reads.variedFrom(id, latest.n).get(action.blockId) ?? null });
        break;
      }
      case "trash": {
        const slot = slotOf(action.blockId);
        if (slot === undefined) return missing(action.blockId);
        const refusal = trashRefusal(slot, splitBlockId(action.blockId).variant, before);
        if (refusal !== null) return invalid(refusal);
        after = withTrash(before, action.blockId, true);
        break;
      }
      case "restore":
        after = withTrash(before, action.blockId, false);
        break;
      case "add_graft": {
        const into = slots.find((s) => s.id === action.into);
        if (into === undefined) return notFound("block", `slot ${action.into} is not in the latest iteration of ${id}`);
        if (slotOf(action.from.blockId) === undefined) return missing(action.from.blockId);
        // A pick into a slot with no Main lands in the variant Rob is looking at there.
        const showing = showingVariant(into, before, store.slotChoices(id).get(into.id) ?? null);
        const picked = withPick(before, into, action.from, action.instruction, showing);
        if ("refused" in picked) return invalid(picked.refused);
        after = picked;
        break;
      }
      case "remove_graft":
        if (!before.grafts.some((g) => g.id === action.id)) return notFound("block", `no graft ${action.id} in ${id}`);
        after = { ...before, grafts: before.grafts.filter((g) => g.id !== action.id) };
        break;
    }
    store.tx(() => {
      store.changeMarks(id, before, after, this.#deps.now());
      // A new Main is what the slot shows.
      for (const slot of slots) {
        const main = after.mains[slot.id];
        if (main !== undefined && main !== before.mains[slot.id]) store.setSlotChoice(id, slot.id, main);
      }
    });
    return null;
  }

  /** What confirming the latest iteration locks in, or why there is nothing to confirm. */
  plan(id: SessionId, latest: StoredIteration, blocks: readonly IterationBlock[]): Result<ConfirmScope> {
    const plan = confirmPlan(slotShapes(latest, blocks), this.#deps.store.marks(id));
    return plan === null ? { ok: false, error: invalid("there is nothing to confirm: choose a Main, trash a variant or pick an element first") } : { ok: true, data: plan };
  }

  /**
   * Carries out a confirm with nothing to graft: the app writes the narrowed iteration itself, as a request it fulfils
   * at once, so history reads it like any other.
   */
  answer(id: SessionId, latest: StoredIteration, blocks: readonly IterationBlock[], plan: ConfirmScope): void {
    const { store } = this.#deps;
    const attachment = store.attachment(id);
    const at = this.#deps.now();
    const kept = blocks.filter((b) => !plan.drop.includes(b.id));
    const n = (latest.n + 1) as IterationN;
    store.tx(() => {
      this.land(
        {
          session: id,
          iteration: { n, threadId: attachment.threadId, note: null, slots: latest.slots, createdAt: at },
          blocks: kept,
          contents: [],
          proposed: this.proposedUsedBy(id, latest.n, kept),
          proposedContents: [],
          addresses: [],
        },
        { confirmed: latest, blocks, scope: plan, dropped: plan.drop, unapplied: [] },
      );
      store.insertRequest(id, { body: { scope: plan, freetext: null }, feedbackIds: [], base: latest.n, threadId: attachment.threadId, at, fulfilledIn: n });
    });
  }

  /**
   * Writes an iteration, the one way every iteration the service writes into a session lands, and settles Rob's marks
   * against it. A confirm's marks are spent, read against the iteration it confirmed, except a graft its commit didn't
   * apply, which waits for the next Confirm; a graft still waiting for its slot's Main never showed in the confirm, so
   * it stays too. What the confirm dropped lets go of Rob's settings and pins. Then any mark naming a block or slot the
   * new iteration lacks goes, so a key the agent reuses later starts unmarked instead of reviving an old Main, trash or
   * graft. Called inside the caller's transaction.
   */
  land(write: Parameters<Store["insertIteration"]>[0], confirm: Confirmed | null): void {
    const { store } = this.#deps;
    const { session, iteration } = write;
    if (confirm !== null) {
      const spent = liveMarks(store.marks(session), slotShapes(confirm.confirmed, confirm.blocks));
      store.changeMarks(session, spent, leftWaiting(spent, confirm, write.blocks), iteration.createdAt);
      this.#letGo(session, confirm.dropped, iteration.createdAt);
    }
    store.insertIteration(write);
    store.pruneMarks(
      session,
      write.blocks.map((b) => b.id),
      iteration.slots.map((s) => s.id),
    );
  }

  /**
   * The proposed components of iteration `n` that `kept` still imports, directly or through another proposed component,
   * so an iteration narrowed by the app carries none that only a dropped variant used (ADR 008's `unused_proposed`).
   */
  proposedUsedBy(session: SessionId, n: IterationN, kept: readonly IterationBlock[]): IterationProposed[] {
    const { store, reads } = this.#deps;
    const all = store.iterationProposed(session, n);
    const importsOf = new Map(all.map((p) => [p.name as string, proposedImports(store.proposedContent(p.hash).compiled)]));
    const used = new Set<string>();
    const pending = kept.flatMap((b) => proposedImports(reads.load(b).content.compiled));
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const imports = importsOf.get(name);
      if (imports === undefined || used.has(name)) continue;
      used.add(name);
      pending.push(...imports);
    }
    return all.filter((p) => used.has(p.name));
  }

  /**
   * What goes with the variants a confirm drops (ADR 009): Rob's settings on them, and his open pins, which no request
   * could address once the variant is gone. A pin goes as when Rob deletes it, so its history stays in the store.
   */
  #letGo(id: SessionId, drop: readonly BlockId[], at: string): void {
    const { store, reads } = this.#deps;
    for (const o of store.overrides(id)) {
      if (drop.includes(o.blockId)) store.deleteOverride(id, o.blockId, o.prop);
    }
    for (const f of reads.feedback(id)) {
      if (f.status.state === "open" && drop.includes(f.pin.blockId)) store.deleteFeedback(id, f.id, at);
    }
  }
}

/** What a commit draws, as a confirm's warnings read it. */
export type DrawnBlocks = {
  readonly titles: ReadonlyMap<BlockId, string>;
  /** The titles in the iteration the commit is based on. */
  readonly titlesBefore: ReadonlyMap<BlockId, string>;
  /** Each block's content hash, in the commit and in the iteration it is based on. */
  readonly hashes: ReadonlyMap<BlockId, ContentHash>;
  readonly hashesBefore: ReadonlyMap<BlockId, ContentHash>;
  readonly parts: ReadonlyMap<BlockId, readonly PartName[]>;
};

/** Whether `block` sits in a slot that has a Main and isn't that Main. */
export function besideMain(scope: ConfirmScope, block: BlockId): boolean {
  const { slot, variant } = splitBlockId(block);
  const main = scope.mains.find((m) => m.slot === slot);
  return main !== undefined && main.variant !== variant;
}

/**
 * A confirm leaves each slot with a Main holding only Main, under the id and title it had, and a Main that receives
 * grafts changes and renders every element grafted into it. Every variant it drops is gone.
 */
export function confirmMismatches(n: RequestN, scope: ConfirmScope, drawn: DrawnBlocks): Issue[] {
  const left = [...drawn.titles.keys()]
    .filter((b) => scope.drop.includes(b) || besideMain(scope, b))
    .map((b) =>
      issue(
        "confirm_mismatch",
        scope.drop.includes(b)
          ? `request ${n} drops ${b}, and this commit still has it`
          : `request ${n} keeps only Main in slot ${splitBlockId(b).slot}, and this commit has ${b} beside it`,
        { file: blockFile(b, "tsx") },
      ),
    );
  const lost = scope.mains
    .map((m) => blockIdOf(m.slot, m.variant))
    .filter((id) => !drawn.titles.has(id))
    .map((id) => issue("confirm_mismatch", `request ${n} keeps ${id} as Main, and this commit no longer has it`, { file: "brainstorm.json" }));
  const renamed = scope.mains.flatMap((m) => {
    const id = blockIdOf(m.slot, m.variant);
    const before = drawn.titlesBefore.get(id);
    const after = drawn.titles.get(id);
    return before === undefined || after === undefined || before === after
      ? []
      : [issue("confirm_mismatch", `${id} is titled "${after}"; request ${n} keeps it as Main titled "${before}"`, { file: blockFile(id, "json") })];
  });
  const grafts = graftsByMain(scope, drawn).flatMap(({ id, unchanged, missed }) => {
    if (unchanged) {
      const what = missed.map((g) => (g.from.part === null ? `all of ${g.from.blockId}` : `data-part "${g.from.part}" from ${g.from.blockId}`));
      return [issue("confirm_mismatch", `request ${n} grafts ${listed(what)} into ${id}, and this commit leaves ${id} as it was`, { file: blockFile(id, "tsx") })];
    }
    return missed.map((g) =>
      issue("confirm_mismatch", `${id} doesn't render data-part "${g.from.part}", the element request ${n} grafts into it from ${g.from.blockId}`, { file: blockFile(id, "tsx") }),
    );
  });
  return [...left, ...lost, ...renamed, ...grafts];
}

/** The confirm's grafts this commit didn't apply: they aren't spent, and wait under their slot's Main for the next Confirm. */
export function unappliedGrafts(scope: ConfirmScope, drawn: DrawnBlocks): Graft[] {
  return graftsByMain(scope, drawn).flatMap((m) => m.missed);
}

/**
 * Each Main that receives grafts and is still there, with the grafts the commit missed. A grafted element can be one
 * Main already renders, as a vary option's is, so only a changed Main shows the agent merged it, and an unchanged one
 * missed them all. A whole-block graft has no element to look for, so a changed Main took it.
 */
function graftsByMain(scope: ConfirmScope, drawn: DrawnBlocks): { id: BlockId; unchanged: boolean; missed: Graft[] }[] {
  return scope.mains.flatMap((m) => {
    const into = scope.grafts.filter((g) => g.into === m.slot);
    const id = blockIdOf(m.slot, m.variant);
    // A Main that is gone is named once, as lost.
    if (into.length === 0 || !drawn.titles.has(id)) return [];
    const unchanged = drawn.hashes.get(id) === drawn.hashesBefore.get(id);
    const parts = drawn.parts.get(id) ?? [];
    return [{ id, unchanged, missed: unchanged ? into : into.filter((g) => g.from.part !== null && !parts.includes(g.from.part)) }];
  });
}

/**
 * The marks a confirm leaves once its iteration lands: the grafts its commit didn't apply, each waiting under its
 * slot's Main. Main is implicit when the commit leaves the slot one variant; when it leaves others beside Main, the
 * slot keeps its Main mark, so the graft still reads.
 */
function leftWaiting(spent: Marks, confirm: Confirmed, blocks: readonly { readonly id: BlockId }[]): Marks {
  const grafts = spent.grafts.filter((g) => confirm.unapplied.some((u) => sameGraft(g, u)));
  const mains: Partial<Record<SlotId, VariantKey>> = {};
  for (const g of grafts) {
    const main = confirm.scope.mains.find((m) => m.slot === g.into);
    const beside = blocks.some((b) => splitBlockId(b.id).slot === g.into && splitBlockId(b.id).variant !== main?.variant);
    if (main !== undefined && beside) mains[g.into] = main.variant;
  }
  return { mains, grafts, trashed: [] };
}

const sameGraft = (a: Graft, b: Graft) => a.into === b.into && a.from.blockId === b.from.blockId && a.from.part === b.from.part && a.instruction === b.instruction;

/** `a`, `a and b`, `a, b and c`. */
function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const invalid = (message: string): Failure => ({ code: "invalid_action", message });
const notFound = (entity: Extract<Failure, { code: "not_found" }>["entity"], message: string): Failure => ({ code: "not_found", entity, message });

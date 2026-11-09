import { requestFeedback } from "./machines";
import { confirmPlan, liveMarks, slotShapes } from "./main";
import { appearanceProp, classifyOverrides } from "./props";
import type { IterationBlock, IterationProposed, SessionSystem, Store, StoredContent, StoredIteration } from "./store";
import type { Trees } from "./tree";
import {
  blockIdOf,
  isError,
  type AppearanceValue,
  type BakedSetting,
  type BlockDraft,
  type BlockId,
  type BranchInput,
  type ConfirmScope,
  type ContentHash,
  type Failure,
  type Feedback,
  type Issue,
  type IterationN,
  type Marks,
  type Override,
  type PropName,
  type ProposedDraft,
  type RequestBody,
  type Result,
  type SessionId,
  type SessionSummary,
  type SlotId,
  type ThreadId,
} from "./types";
import { readStoredBlock, readStoredProposed } from "./workingCopy";

/** `block.json` with `settings` as its appearance defaults. Only the defaults change, so the schema stays the agent's. */
export function bakeDefaults(json: string, settings: readonly { readonly prop: PropName; readonly value: AppearanceValue }[]): string {
  if (settings.length === 0) return json;
  const block = JSON.parse(json) as { props: { appearance: Record<string, { default: unknown }> } };
  for (const s of settings) {
    const spec = block.props.appearance[s.prop];
    if (spec !== undefined) spec.default = s.value;
  }
  return `${JSON.stringify(block, null, 2)}\n`;
}

const TITLE_MAX = 48;

/** A branch is named for what Rob asked of it: the instruction's first clause, cut at a word near 48 characters. */
export function branchTitle(instruction: string): string {
  const line = instruction.trim().split(/\r?\n/)[0] ?? "";
  const clause = line.split(/[,;:.!?]\s|\s[-–—]\s/)[0]?.trim() ?? "";
  const text = clause.length >= 3 ? clause : line;
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * What making a branch needs from the service: the store, the tree, the clock and new session ids, and four of the
 * service's own reads, which stay there because commits and confirms share them. `load` reads a stored block through
 * the service's cache, `feedback` folds a session's live pins, `proposedUsedBy` is the confirm's rule for which
 * proposed components a narrowed iteration keeps, and `check` is the commit's check against the session's kit.
 */
export type BranchDeps = {
  readonly store: Store;
  readonly trees: Trees;
  readonly now: () => string;
  readonly newSessionId: () => SessionId;
  readonly load: (block: IterationBlock) => { readonly draft: Pick<BlockDraft, "title" | "props">; readonly content: StoredContent };
  readonly feedback: (id: SessionId) => Feedback[];
  readonly proposedUsedBy: (session: SessionId, n: IterationN, kept: readonly IterationBlock[]) => IterationProposed[];
  readonly check: (
    blocks: readonly BlockDraft[],
    overrides: readonly Override[],
    ctx: {
      readonly system: SessionSystem | null;
      readonly proposed: readonly ProposedDraft[];
      readonly rawProposed: Readonly<Record<string, string>>;
      readonly previous: readonly IterationBlock[];
    },
  ) => Promise<{ readonly issues: readonly Issue[]; readonly contents: ReadonlyMap<ContentHash, StoredContent> }>;
};

/**
 * Confirms on a past iteration (ADR 009): a new branch of the brainstorm, on its thread, that continues from iteration
 * `from` of its parent. Its first iteration is that one narrowed by Rob's marks, with his settings baked in as defaults
 * and his open pins carried. With grafts, the narrowing waits for the agent: the first iteration keeps every variant,
 * and request 1 is the confirm. An instruction asks the agent to try it on the branch. With neither, request 1 is still
 * the confirm, fulfilled by the first iteration, as an app-applied confirm is.
 */
export class Branches {
  readonly #deps: BranchDeps;

  constructor(deps: BranchDeps) {
    this.#deps = deps;
  }

  /** Makes the branch and returns it with the thread it shares. Sending its request 1, when it has one, is the caller's. */
  async make(parentId: SessionId, input: BranchInput): Promise<Result<{ readonly id: SessionId; readonly thread: ThreadId }>> {
    const start = this.#start(parentId, input);
    if (!start.ok) return start;
    const closed = this.#gate(start.data);
    if (closed !== null) return fail(closed);
    const baked = await this.#bake(start.data);
    if (!baked.ok) return baked;
    const id = this.#deps.newSessionId();
    const written = this.#write(id, start.data, baked.data);
    if (!written.ok) return written;
    return ok({ id, thread: written.data });
  }

  /** What a branch starts from, or why it can't: the parent's iteration, and Rob's marks on it as a plan. */
  #start(parentId: SessionId, input: BranchInput): Result<BranchStart> {
    const { store } = this.#deps;
    const parent = store.session(parentId);
    if (parent === null) return fail(notFound("session", `no session ${parentId}`));
    const source = store.iteration(parentId, input.from);
    if (source === null) return fail(notFound("iteration", `${parentId} has no iteration ${input.from}`));
    const blocks = store.iterationBlocks(parentId, source.n);
    const shapes = slotShapes(source, blocks);
    // Marks made on this iteration name only its blocks, so one that doesn't is refused rather than quietly dropped.
    const named = [...Object.entries(input.marks.mains).map(([s, v]) => blockIdOf(s as SlotId, v!)), ...input.marks.trashed, ...input.marks.grafts.map((g) => g.from.blockId)];
    for (const b of named) {
      if (!blocks.some((x) => x.id === b)) return fail(notFound("block", `${b} is not in iteration ${source.n}`));
    }
    const into = input.marks.grafts.find((g) => !source.slots.some((s) => s.id === g.into));
    if (into !== undefined) return fail(notFound("block", `slot ${into.into} is not in iteration ${source.n}`));
    const marks = liveMarks(input.marks, shapes);
    const instruction = input.instruction?.trim() || null;
    const plan = confirmPlan(shapes, marks);
    const grafting = plan !== null && plan.grafts.length > 0;
    if (plan === null && instruction === null) return fail(invalid("say what the branch should try, or mark what it keeps"));
    return ok({ parent, source, blocks, marks, plan, instruction, grafting });
  }

  /**
   * Why the branch can't be made now, or null. Its request goes to the thread every branch shares, so the same gate
   * holds as for any request. A branch that asks the agent nothing passes.
   */
  #gate({ parent, grafting, instruction }: BranchStart): Failure | null {
    if (!grafting && instruction === null) return null;
    const { store, trees } = this.#deps;
    const busy = trees.openElsewhere(parent.id) ?? store.openRequest(parent.id);
    if (busy !== null) return { code: "request_open", message: `request ${busy.n} is still open on this brainstorm's thread; let it finish or withdraw it first`, n: busy.n };
    const attachment = store.attachment(parent.id);
    if (attachment.lostAt !== null) return { code: "thread_lost", message: `thread ${attachment.threadId} is gone; start a fresh thread first`, thread: attachment.threadId };
    return null;
  }

  /**
   * The branch's first iteration: the variants it keeps, with Rob's settings on them baked into their defaults and
   * checked again, or a refusal naming the kept variant his settings break.
   */
  async #bake({ parent, source, blocks, plan, grafting }: BranchStart): Promise<Result<BakedBranch>> {
    const { store, load } = this.#deps;
    const kept = grafting || plan === null ? blocks : blocks.filter((b) => !plan.drop.includes(b.id));
    const { applicable } = classifyOverrides(new Map(blocks.map((b) => [b.id, load(b).draft.props])), store.overrides(parent.id));
    const settings = applicable.flatMap((o) => {
      const stored = kept.find((b) => b.id === o.blockId);
      const spec = stored === undefined ? undefined : appearanceProp(load(stored).draft.props, o.prop);
      return spec === undefined || spec.default === o.value ? [] : [{ blockId: o.blockId, prop: o.prop, value: o.value }];
    });
    const baked: { id: BlockId; title: string; hash: ContentHash; draft: BlockDraft | null }[] = [];
    for (const stored of kept) {
      const mine = settings.filter((s) => s.blockId === stored.id);
      const title = load(stored).draft.title;
      if (mine.length === 0) {
        baked.push({ id: stored.id, title, hash: stored.hash, draft: null });
        continue;
      }
      const files = load(stored).content.files;
      const draft = readStoredBlock({ id: stored.id, files: { ...files, json: bakeDefaults(files.json, mine) } });
      if (draft === null) return fail(invalid(`${title} doesn't read with your settings as its defaults. Reset its settings, or keep another variant.`));
      baked.push({ id: stored.id, title, hash: draft.hash, draft });
    }
    const system = store.sessionSystem(parent.id);
    // A branch narrowed by the app carries only the proposed components its kept variants use, as a confirm does.
    const proposed = kept === blocks ? store.iterationProposed(parent.id, source.n) : this.#deps.proposedUsedBy(parent.id, source.n, kept);
    const proposedDrafts = proposed.flatMap((p) => {
      const draft = readStoredProposed(p.name, store.proposedContent(p.hash).files);
      return draft === null ? [] : [draft];
    });
    const { issues, contents } = await this.#deps.check(
      baked.flatMap((b) => (b.draft === null ? [] : [b.draft])),
      [],
      // Unbaked blocks are as the parent committed them, against the same kit, so only the baked ones are checked.
      { system, proposed: [], rawProposed: Object.fromEntries(proposedDrafts.map((p) => [`proposed/${p.name}`, p.files.tsx])), previous: [] },
    );
    const broken = issues.find(isError);
    if (broken !== undefined) {
      const title = baked.find((b) => broken.file?.startsWith(`slots/${b.id}/`))?.title ?? "A kept variant";
      return fail(invalid(`${title} doesn't render with your settings as its defaults (${broken.message}). Reset the setting that breaks it, or keep another variant.`));
    }
    return ok({ kept, settings, blocks: baked.map((b) => ({ id: b.id, hash: b.hash })), contents: [...contents.values()], system, proposed });
  }

  /** Writes branch `id` with its first iteration, carried pins and request 1 in one transaction, and returns its thread. */
  #write(id: SessionId, start: BranchStart, baked: BakedBranch): Result<ThreadId> {
    const { store, trees } = this.#deps;
    const { parent, source, marks, instruction, grafting } = start;
    const at = this.#deps.now();
    const keptIds = new Set(baked.kept.map((b) => b.id));
    const pins = this.#deps.feedback(parent.id).filter((f) => f.status.state === "open" && keptIds.has(f.pin.blockId));
    const { body, answered } = branchRequest(start);
    const asked = new Set(body === null ? [] : requestFeedback(pins, body.scope).map((f) => f.id));
    return store.tx((): Result<ThreadId> => {
      // The check awaited the worker, so another branch may have opened a request on the thread meanwhile.
      const late = this.#gate(start);
      if (late !== null) return fail(late);
      // The tree's thread as it is: a branch made while it is lost is lost too, so it never reads as healthy.
      const shared = store.attachment(parent.id);
      const thread = shared.threadId;
      store.createBranch(
        {
          // Numbered in its tree: the branch line and the strip already say where it left from.
          session: { id, projectId: parent.projectId, title: instruction === null ? `Branch ${trees.walk(parent.id).members.length}` : branchTitle(instruction), brief: parent.brief, createdAt: at },
          link: { parent: parent.id, from: source.n, baked: baked.settings, createdAt: at },
          // A branch continues its source's numbers, so a trail reads 1, 2, 3, 4 whichever branch it ends on.
          // Made on the thread the tree shares now, as an iteration the app writes for a confirm is.
          iteration: { n: (source.n + 1) as IterationN, threadId: thread, note: null, slots: source.slots, createdAt: at },
          blocks: baked.blocks,
          contents: baked.contents,
          proposed: baked.proposed,
          feedback: pins.map((f) => ({ pin: f.pin, text: f.text, asked: asked.has(f.id) })),
          system: baked.system,
          theme: store.sessionTheme(parent.id),
          request: body === null ? null : { body, at, answered },
        },
        shared,
      );
      // While the agent merges, the branch shows the marks it was confirmed with.
      if (grafting) {
        for (const [slot, variant] of Object.entries(marks.mains)) store.setMain(id, slot as SlotId, variant!);
        for (const g of marks.grafts) store.addGraft(id, g, at);
        for (const b of marks.trashed) store.setTrashed(id, b, true);
      }
      return ok(thread);
    });
  }
}

/** What a branch starts from: the parent, the iteration it leaves from, and Rob's marks on it as a plan. */
type BranchStart = {
  readonly parent: SessionSummary;
  readonly source: StoredIteration;
  readonly blocks: readonly IterationBlock[];
  readonly marks: Marks;
  readonly plan: ConfirmScope | null;
  readonly instruction: string | null;
  /** With grafts the narrowing waits for the agent, so the first iteration keeps every variant. */
  readonly grafting: boolean;
};

/** A branch's first iteration, baked and checked: the blocks it keeps, the settings baked into them, and their content. */
type BakedBranch = {
  readonly kept: readonly IterationBlock[];
  readonly settings: readonly BakedSetting[];
  readonly blocks: readonly IterationBlock[];
  readonly contents: readonly StoredContent[];
  readonly system: SessionSystem | null;
  readonly proposed: readonly IterationProposed[];
};

/**
 * A branch's request 1: the confirm, unless only an instruction goes to the agent. With no grafts and no instruction
 * the first iteration already carries the confirm out, so it fulfils the request (`answered`).
 */
function branchRequest({ plan, grafting, instruction }: BranchStart): { readonly body: RequestBody | null; readonly answered: boolean } {
  const body: RequestBody | null =
    plan !== null && (grafting || instruction === null)
      ? { scope: plan, freetext: instruction }
      : instruction !== null
        ? { scope: { kind: "all" }, freetext: instruction }
        : null;
  return { body, answered: !grafting && instruction === null };
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: Failure): { ok: false; error: Failure } => ({ ok: false, error });
const invalid = (message: string): Failure => ({ code: "invalid_action", message });
const notFound = (entity: Extract<Failure, { code: "not_found" }>["entity"], message: string): Failure => ({ code: "not_found", entity, message });

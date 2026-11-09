import { foldFeedback } from "./machines";
import type { FeedbackRecord, IterationBlock, Store, StoredContent } from "./store";
import type { Trees } from "./tree";
import { blockIdOf, splitBlockId, type BlockDraft, type BlockId, type ContentHash, type Feedback, type IterationN, type Pin, type PropsSchema, type SessionId } from "./types";
import { readStoredBlock } from "./workingCopy";

/** The part of a parsed block that depends only on its content, so it can be shared by every block with that hash. */
export type Loaded = { readonly draft: Pick<BlockDraft, "title" | "props" | "controls">; readonly content: StoredContent };

/**
 * The reads the service, its commits, confirms and branches share: stored blocks parsed through one content cache,
 * a session's live pins, and which variants a vary made.
 */
export class Reads {
  readonly #store: Store;
  readonly #trees: Trees;
  readonly #loaded = new Map<ContentHash, Loaded>();

  constructor(store: Store, trees: Trees) {
    this.#store = store;
    this.#trees = trees;
  }

  /** Stored content never changes, so its row and its parse are read once per hash for the life of the service. */
  load(block: IterationBlock): Loaded {
    const cached = this.#loaded.get(block.hash);
    if (cached !== undefined) return cached;
    const content = this.#store.content(block.hash);
    const draft = readStoredBlock({ id: block.id, files: content.files });
    if (draft === null) throw new Error(`stored block ${block.id} (${block.hash}) no longer parses`);
    const loaded: Loaded = { draft: { title: draft.title, props: draft.props, controls: draft.controls }, content };
    this.#loaded.set(block.hash, loaded);
    return loaded;
  }

  schemas(blocks: readonly IterationBlock[]): Map<BlockId, PropsSchema> {
    return new Map(blocks.map((b) => [b.id, this.load(b).draft.props]));
  }

  /** The session's pins Rob hasn't deleted, each with its status folded from its history. */
  feedback(id: SessionId): Feedback[] {
    return this.#store
      .feedback(id)
      .filter((f) => f.deletedAt === null)
      .map(({ deletedAt: _deleted, ...f }: FeedbackRecord) => ({ ...f, status: foldFeedback(f.history) }));
  }

  /**
   * Which variants of the session's iteration `through` a vary made, and from what: the block it copied and the element
   * it varied. Only iterations up to `through` count, so a past iteration keeps the provenance it had even after a later
   * one drops the option. A branch inherits its ancestors' variants, so their varies count up to where its trail left
   * them. A vary option stops being one once an iteration on the trail goes without it, so a later variant that reuses
   * its key starts as itself.
   */
  variedFrom(id: SessionId, through: IterationN): Map<BlockId, Pin> {
    const out = new Map<BlockId, Pin>();
    for (const { session, upTo } of this.#trees.walk(id).trail) {
      const cutoff = upTo ?? through;
      const varies = new Map(
        this.#store.requests(session).flatMap((r) => (r.scope.kind === "vary" && r.state.state === "fulfilled" ? [[r.state.iteration, r.scope] as const] : [])),
      );
      for (const iteration of this.#store.iterations(session)) {
        if (iteration.n > cutoff) break;
        const present = new Set(this.#store.iterationBlocks(session, iteration.n).map((b) => b.id));
        for (const b of out.keys()) if (!present.has(b)) out.delete(b);
        const vary = varies.get(iteration.n);
        if (vary === undefined) continue;
        const { slot } = splitBlockId(vary.target.blockId);
        for (const v of vary.variants) {
          const b = blockIdOf(slot, v.key);
          if (present.has(b)) out.set(b, vary.target);
        }
      }
    }
    return out;
  }
}

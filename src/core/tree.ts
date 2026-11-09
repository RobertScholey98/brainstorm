import type { Store } from "./store";
import type { HistoryEntry, IterationN, Request, SessionId, SessionView, ThreadId, TrailBranch } from "./types";

/** Each branch's parent and the iteration it left from, as the store keeps them. */
type ParentLinks = ReadonlyMap<SessionId, { readonly parent: SessionId; readonly from: IterationN }>;

/**
 * A brainstorm as seen from one of its branches. `trail` runs from the root to the branch, each ancestor up to the
 * iteration the next one left it from; `members` is every session in the tree, root first.
 */
export type TreeWalk = {
  readonly trail: readonly { readonly session: SessionId; readonly upTo: IterationN | null }[];
  readonly members: readonly SessionId[];
};

/** The one walk of a brainstorm's parent links, up to the root and back down to every branch. */
export function walkTree(links: ParentLinks, id: SessionId): TreeWalk {
  const trail: { session: SessionId; upTo: IterationN | null }[] = [{ session: id, upTo: null }];
  for (let link = links.get(id); link !== undefined; link = links.get(link.parent)) {
    const { parent, from } = link;
    if (trail.some((t) => t.session === parent)) break;
    trail.unshift({ session: parent, upTo: from });
  }
  const members = [trail[0]!.session];
  for (let i = 0; i < members.length; i += 1) {
    for (const [child, link] of links) if (link.parent === members[i] && !members.includes(child)) members.push(child);
  }
  return { trail, members };
}

/** A brainstorm's tree of branches (ADR 009), read from the store: its root, its primary, its trails and its thread. */
export class Trees {
  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
  }

  walk(id: SessionId): TreeWalk {
    return walkTree(this.#store.forkLinks(), id);
  }

  /** The brainstorm a branch belongs to, by its root: the session with no parent. */
  rootOf(id: SessionId): SessionId {
    return this.walk(id).trail[0]!.session;
  }

  /** Every live branch of `id`'s brainstorm, root first. */
  membersOf(id: SessionId): SessionId[] {
    return this.walk(id).members.filter((m) => this.#store.session(m) !== null);
  }

  primaryOf(root: SessionId): SessionId {
    const chosen = this.#store.primaryOf(root);
    return chosen !== null && this.#store.session(chosen) !== null ? chosen : root;
  }

  /** Another branch's open request. A brainstorm has one open at a time, so a new request waits for it. */
  openElsewhere(id: SessionId): Request | null {
    return this.holdingElsewhere(id, () => true);
  }

  /**
   * Another branch's open request that `holds` says holds the thread they share, so a Retry or Resend waits for it.
   * Migration 11 and a fresh thread can leave several requests waiting as send failed; none of those holds the
   * thread, so the first retried goes and the others then wait for it.
   */
  holdingElsewhere(id: SessionId, holds: (open: Request, session: SessionId) => boolean): Request | null {
    for (const other of this.membersOf(id)) {
      if (other === id) continue;
      const open = this.#store.openRequest(other);
      if (open !== null && holds(open, other)) return open;
    }
    return null;
  }

  /** Moves every branch of the brainstorm to `thread`, and returns them. Attaching, and a fresh thread, both land here. */
  move(id: SessionId, thread: ThreadId, at: string): SessionId[] {
    const members = this.membersOf(id);
    this.#store.tx(() => {
      for (const member of members) {
        const current = this.#store.attachment(member);
        if (current.threadId !== thread) this.#store.reattach(member, thread, at);
        else if (current.lostAt !== null) this.#store.setLost(member, null);
      }
    });
    return members;
  }

  /**
   * A branch's trail (ADR 009): its ancestors' iterations up to each branch point, then its own. Every other branch
   * hangs off the trail iteration it left from, and so does an ancestor's own continuation past the point this trail
   * left it, so the old primary still shows once another branch is made primary. `history` is one session's own
   * iterations.
   */
  trail(id: SessionId, history: (session: SessionId) => HistoryEntry[]): SessionView["history"] {
    const chain = this.walk(id).trail;
    const iterations: HistoryEntry[] = [];
    const branches: TrailBranch[] = [];
    chain.forEach(({ session, upTo }, i) => {
      if (this.#store.sessionName(session) === null) return;
      const own = history(session).filter((e) => upTo === null || e.n <= upTo);
      iterations.push(...own);
      const next = chain[i + 1]?.session;
      for (const b of this.#store.forksOf(session)) {
        if (b.id !== next && (upTo === null || b.from <= upTo)) branches.push({ id: b.id, title: b.title, parent: session, from: b.from });
      }
      const latest = this.#store.latestIteration(session);
      if (upTo !== null && latest !== null && latest.n > upTo) {
        branches.push({ id: session, title: this.#store.sessionName(session)?.title ?? session, parent: session, from: upTo });
      }
    });
    return { iterations, branches };
  }
}

import type { AppearanceValue, BlockId, PropName, Props, RobAction, SessionView } from "../core/types";

const SAVE_DELAY_MS = 250;

type Edit = { readonly value: AppearanceValue; readonly saving: boolean };

/**
 * Rob's control changes that the server hasn't confirmed yet. The canvas and the panel show server values with these
 * on top, so a drag repaints at once while `set_override` goes out debounced. An edit is dropped once a view from the
 * server agrees with it, or when the server refuses it.
 */
export class PendingOverrides {
  readonly #edits = new Map<BlockId, Map<PropName, Edit>>();
  readonly #timers = new Map<string, { readonly timer: ReturnType<typeof setTimeout>; readonly save: () => void }>();
  readonly #listeners = new Set<() => void>();
  readonly #send: (action: RobAction) => Promise<SessionView | null>;
  #version = 0;

  constructor(send: (action: RobAction) => Promise<SessionView | null>) {
    this.#send = send;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly version = (): number => this.#version;

  #changed(): void {
    this.#version += 1;
    for (const l of this.#listeners) l();
  }

  effective(blockId: BlockId, server: Props): Props {
    const edits = this.#edits.get(blockId);
    if (edits === undefined || edits.size === 0) return server;
    return { ...server, ...Object.fromEntries([...edits].map(([prop, e]) => [prop, e.value])) };
  }

  set(blockId: BlockId, prop: PropName, value: AppearanceValue): void {
    const edits = this.#edits.get(blockId) ?? new Map<PropName, Edit>();
    this.#edits.set(blockId, edits);
    edits.set(prop, { value, saving: false });
    const key = `${blockId}\0${prop}`;
    clearTimeout(this.#timers.get(key)?.timer);
    const save = () => {
      this.#timers.delete(key);
      edits.set(prop, { value, saving: true });
      void this.#send({ kind: "set_override", blockId, prop, value }).then((view) => {
        if (view === null && edits.get(prop)?.value === value) edits.delete(prop);
        if (view !== null) this.settle(view);
        this.#changed();
      });
    };
    this.#timers.set(key, { timer: setTimeout(save, SAVE_DELAY_MS), save });
    this.#changed();
  }

  reset(blockId: BlockId, prop: PropName): void {
    const key = `${blockId}\0${prop}`;
    clearTimeout(this.#timers.get(key)?.timer);
    this.#timers.delete(key);
    this.#edits.get(blockId)?.delete(prop);
    this.#changed();
    void this.#send({ kind: "clear_override", blockId, prop });
  }

  settle(view: SessionView): void {
    for (const block of view.iteration?.blocks ?? []) {
      const edits = this.#edits.get(block.id);
      for (const [prop, edit] of edits ?? []) {
        if (edit.saving && block.effectiveProps[prop] === edit.value) edits?.delete(prop);
      }
    }
  }

  /** Saves every edit still waiting out its delay, so leaving a brainstorm mid-drag keeps the last value. */
  flush(): void {
    for (const { timer, save } of [...this.#timers.values()]) {
      clearTimeout(timer);
      save();
    }
  }
}

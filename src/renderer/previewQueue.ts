import type { SessionPreview } from "../core/types";

/** How many preview frames run at once. Each is a sandboxed page with its own copy of React. */
export const PREVIEW_FRAMES = 3;

/**
 * Turns for preview frames: at most `limit` run at once, and the rest wait in the order they asked. A card takes a
 * turn when it scrolls into view and gives it back once its still is taken, or when it leaves.
 */
export class PreviewTurns {
  readonly #limit: number;
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.#limit = limit;
  }

  get running(): number {
    return this.#running;
  }

  /** `start` runs once the turn comes. The returned function gives the turn back, or leaves the line; a second call does nothing. */
  take(start: () => void): () => void {
    let state: "waiting" | "running" | "done" = "waiting";
    const run = () => {
      state = "running";
      this.#running++;
      start();
    };
    if (this.#running < this.#limit) run();
    else this.#waiting.push(run);
    return () => {
      if (state === "waiting") this.#waiting.splice(this.#waiting.indexOf(run), 1);
      if (state === "running") {
        this.#running--;
        this.#next();
      }
      state = "done";
    };
  }

  #next(): void {
    while (this.#running < this.#limit) {
      const run = this.#waiting.shift();
      if (run === undefined) return;
      run();
    }
  }
}

/** Stills by what they show, so a card that scrolls back, or another with the same block, needs no frame. */
export class StillCache<T> {
  readonly #limit: number;
  readonly #images = new Map<string, T>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  get(key: string): T | undefined {
    const image = this.#images.get(key);
    if (image !== undefined) {
      this.#images.delete(key);
      this.#images.set(key, image);
    }
    return image;
  }

  set(key: string, image: T): void {
    this.#images.delete(key);
    this.#images.set(key, image);
    for (const oldest of this.#images.keys()) {
      if (this.#images.size <= this.#limit) break;
      this.#images.delete(oldest);
    }
  }
}

/**
 * What a still is kept under: the block's content, Rob's settings, its frame width, the theme, the design system's
 * version and session theme, and whether it is a
 * strip thumbnail or a card, since a still is drawn at its box's size and a thumbnail blown up to a card is a blur.
 */
export function stillKey(preview: SessionPreview, { dark, compact }: { readonly dark: boolean; readonly compact: boolean }): string {
  const system = preview.system === null ? "" : `:${preview.system.id}@${preview.system.n}:${JSON.stringify(preview.system.theme)}:${preview.system.proposed.map((p) => p.hash).join(",")}`;
  return `${compact ? "thumb" : "card"}:${dark ? "dark" : "light"}:${preview.module.hash}:${preview.frame.frame.width}:${JSON.stringify(preview.props)}${system}`;
}

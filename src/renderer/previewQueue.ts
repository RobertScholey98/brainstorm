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
export class StillCache {
  readonly #limit: number;
  readonly #images = new Map<string, string>();

  constructor(limit: number) {
    this.#limit = limit;
  }

  get(key: string): string | undefined {
    const image = this.#images.get(key);
    if (image !== undefined) {
      this.#images.delete(key);
      this.#images.set(key, image);
    }
    return image;
  }

  set(key: string, image: string): void {
    this.#images.delete(key);
    this.#images.set(key, image);
    for (const oldest of this.#images.keys()) {
      if (this.#images.size <= this.#limit) break;
      this.#images.delete(oldest);
    }
  }
}

import { expect, test } from "vitest";
import { PREVIEW_FRAMES, PreviewTurns, StillCache } from "../src/renderer/previewQueue";

test("home runs at most three preview frames at once", () => {
  expect(PREVIEW_FRAMES).toBe(3);
});

test("turns run up to the limit, then in the order asked, and a turn given back starts the next", () => {
  const turns = new PreviewTurns(2);
  const started: string[] = [];
  const give = Object.fromEntries(["a", "b", "c", "d"].map((k) => [k, turns.take(() => started.push(k))]));
  expect([started, turns.running]).toEqual([["a", "b"], 2]);
  give.c?.();
  give.a?.();
  expect([started, turns.running], "a card that left the line never runs").toEqual([["a", "b", "d"], 2]);
  give.a?.();
  give.b?.();
  give.d?.();
  expect(turns.running, "giving a turn back twice counts once").toBe(0);
});

test("the still cache keeps the most recently used", () => {
  const cache = new StillCache(2);
  cache.set("a", "A");
  cache.set("b", "B");
  cache.get("a");
  cache.set("c", "C");
  expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual(["A", undefined, "C"]);
});

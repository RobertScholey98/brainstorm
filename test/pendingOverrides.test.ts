import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BlockId, PropName, RobAction, SessionView } from "../src/core/types";
import { PendingOverrides } from "../src/renderer/overrides";

const NEON = "wheel/neon" as BlockId;
const SPIN = "spinSeconds" as PropName;

const viewWith = (spinSeconds: number) =>
  ({ iteration: { blocks: [{ id: NEON, effectiveProps: { spinSeconds, accent: "#ff2bd6" } }] } }) as unknown as SessionView;

describe("PendingOverrides", () => {
  let sent: RobAction[];
  let answer: (action: RobAction) => SessionView | null;
  let pending: PendingOverrides;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    answer = (a) => (a.kind === "set_override" ? viewWith(a.value as number) : null);
    pending = new PendingOverrides(async (a) => {
      sent.push(a);
      return answer(a);
    });
  });
  afterEach(() => vi.useRealTimers());

  test("shows a drag at once and saves only its last value, 250 ms after it stops", async () => {
    pending.set(NEON, SPIN, 2.5);
    pending.set(NEON, SPIN, 2.6);
    expect(pending.effective(NEON, { spinSeconds: 2.4, accent: "#ff2bd6" })).toEqual({ spinSeconds: 2.6, accent: "#ff2bd6" });
    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([{ kind: "set_override", blockId: NEON, prop: SPIN, value: 2.6 }]);
  });

  test("drops an edit once the server's view shows it, so later server values win", async () => {
    pending.set(NEON, SPIN, 3);
    await vi.advanceTimersByTimeAsync(250);
    expect(pending.effective(NEON, { spinSeconds: 4 })).toEqual({ spinSeconds: 4 });
  });

  test("keeps an edit made while the previous one was saving", async () => {
    answer = () => viewWith(3);
    pending.set(NEON, SPIN, 3);
    vi.advanceTimersByTime(250);
    pending.set(NEON, SPIN, 3.1);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.effective(NEON, { spinSeconds: 3 })).toEqual({ spinSeconds: 3.1 });
  });

  test("drops an edit the server refused, falling back to the server's value", async () => {
    answer = () => null;
    pending.set(NEON, SPIN, 99);
    await vi.advanceTimersByTimeAsync(250);
    expect(pending.effective(NEON, { spinSeconds: 2.4 })).toEqual({ spinSeconds: 2.4 });
  });

  test("reset cancels a pending save and clears the override", async () => {
    pending.set(NEON, SPIN, 3);
    pending.reset(NEON, SPIN);
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([{ kind: "clear_override", blockId: NEON, prop: SPIN }]);
    expect(pending.effective(NEON, { spinSeconds: 2.4 })).toEqual({ spinSeconds: 2.4 });
  });
});

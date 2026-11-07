import { describe, expect, it, vi } from "vitest";
import { age, clock, elapsed } from "../src/renderer/time";

const now = Date.parse("2026-11-05T12:00:00.000Z");
const before = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;

describe("age", () => {
  it("counts minutes, hours and days, then gives the date", () => {
    expect(
      [0, 59_999, MIN, 59 * MIN, 60 * MIN, 23 * 60 * MIN + 59 * MIN, 24 * 60 * MIN, 48 * 60 * MIN, 6 * 24 * 60 * MIN].map((ms) => age(before(ms), now)),
    ).toEqual(["now", "now", "1m", "59m", "1h", "23h", "1d", "2d", "6d"]);
    expect(age("2026-10-20T12:00:00.000Z", now)).toBe("20 Oct");
    expect(age("2025-10-20T12:00:00.000Z", now)).toBe("20 Oct 2025");
  });

  it("abbreviates every month to three letters, September too", () => {
    const months = Array.from({ length: 12 }, (_, m) => age(new Date(2025, m, 15, 12).toISOString(), now).split(" ")[1]);
    expect(months).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  it("reads a time slightly in the future as now", () => {
    expect(age(new Date(now + 5_000).toISOString(), now)).toBe("now");
  });
});

describe("elapsed", () => {
  it("counts seconds, then minutes, then hours and minutes", () => {
    expect([0, 12_000, 59_999, MIN, 59 * MIN, 65 * MIN, 125 * MIN].map((ms) => elapsed(before(ms), now))).toEqual(["0s", "12s", "59s", "1m", "59m", "1h 5m", "2h 5m"]);
  });
});

describe("the clock every age reads", () => {
  it("gives a reader that starts late the time the first one has, so a row and its card never show one brainstorm at two ages", () => {
    vi.useFakeTimers({ now });
    const read = { row: 0, card: 0 };
    const stopRow = clock.subscribe(() => void (read.row = clock.now()), MIN);
    vi.advanceTimersByTime(25_000);
    const stopCard = clock.subscribe(() => void (read.card = clock.now()), MIN);
    const active = before(-30_000);
    const shown: string[][] = [];
    for (let s = 0; s < 120; s++) {
      vi.advanceTimersByTime(1_000);
      shown.push([age(active, read.row), age(active, read.card)]);
    }
    stopRow();
    stopCard();
    vi.useRealTimers();
    expect(shown.filter(([row, card]) => row !== card)).toEqual([]);
    expect([shown[0], shown.at(-1)]).toEqual([["now", "now"], ["1m", "1m"]]);
  });

  it("ticks every second for every reader while one needs seconds, and drops back to the minute after", () => {
    vi.useFakeTimers({ now });
    let reads = 0;
    const stopAge = clock.subscribe(() => void (reads += 1), MIN);
    const stopLive = clock.subscribe(() => undefined, 1_000);
    reads = 0;
    vi.advanceTimersByTime(3_000);
    const live = reads;
    stopLive();
    reads = 0;
    vi.advanceTimersByTime(59_000);
    const after = reads;
    stopAge();
    vi.useRealTimers();
    expect([live, after]).toEqual([3, 0]);
  });
});

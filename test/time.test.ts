import { describe, expect, it } from "vitest";
import { age, elapsed } from "../src/renderer/time";

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

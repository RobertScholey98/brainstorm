import { describe, expect, it } from "vitest";
import { age, ago } from "../src/renderer/time";

const now = Date.parse("2026-11-05T12:00:00.000Z");
const before = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;

describe("ago", () => {
  it("counts minutes, hours and days, then gives the date", () => {
    expect(
      [0, 59_999, MIN, 59 * MIN, 60 * MIN, 23 * 60 * MIN + 59 * MIN, 24 * 60 * MIN, 47 * 60 * MIN, 48 * 60 * MIN, 6 * 24 * 60 * MIN].map((ms) => ago(before(ms), now)),
    ).toEqual(["just now", "just now", "1 min ago", "59 min ago", "1 h ago", "23 h ago", "yesterday", "yesterday", "2 days ago", "6 days ago"]);
    expect(ago("2026-10-20T12:00:00.000Z", now)).toBe("20 Oct");
    expect(ago("2025-10-20T12:00:00.000Z", now)).toBe("20 Oct 2025");
  });

  it("reads a time slightly in the future as just now", () => {
    expect(ago(new Date(now + 5_000).toISOString(), now)).toBe("just now");
  });
});

describe("age", () => {
  it("says the same as ago in the few characters a list row has room for", () => {
    expect(
      [0, 59_999, MIN, 59 * MIN, 60 * MIN, 23 * 60 * MIN + 59 * MIN, 24 * 60 * MIN, 48 * 60 * MIN, 6 * 24 * 60 * MIN].map((ms) => age(before(ms), now)),
    ).toEqual(["now", "now", "1m", "59m", "1h", "23h", "1d", "2d", "6d"]);
    expect(age("2026-10-20T12:00:00.000Z", now)).toBe("20 Oct");
    expect(age("2025-10-20T12:00:00.000Z", now)).toBe("20 Oct 2025");
  });
});

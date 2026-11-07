import { describe, expect, test } from "vitest";
import { nextVersion } from "../scripts/next-version";

describe("nextVersion", () => {
  test("the first release takes package.json's version, ignoring tags that aren't X.Y.Z", () => {
    expect(nextVersion([], "0.1.0", "patch")).toBe("0.1.0");
    expect(nextVersion(["v0.1", "vnext"], "0.1.0", "minor")).toBe("0.1.0");
  });

  test("bumps the highest tag by number, not by string order", () => {
    const tags = ["v0.1", "v0.1.0", "v0.9.0", "v0.10.2", "v0.2.7"];
    expect(nextVersion(tags, "0.1.0", "patch")).toBe("0.10.3");
    expect(nextVersion(tags, "0.1.0", "minor")).toBe("0.11.0");
    expect(nextVersion(tags, "0.1.0", "major")).toBe("1.0.0");
  });

  test("refuses an unknown bump", () => {
    expect(() => nextVersion([], "0.1.0", "huge")).toThrow("bump must be one of patch, minor, major, got huge");
  });
});

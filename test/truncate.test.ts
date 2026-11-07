import { describe, expect, it } from "vitest";
import { cutText } from "../src/renderer/components/ui/cut-text";

/** One unit a character, the ellipsis included, so a room of n shows n characters. */
const room = (n: number) => (shown: string) => Array.from(shown).length <= n;

describe("cutText", () => {
  it("cuts after the last letter that fits, with the ellipsis right after it", () => {
    expect(cutText("Chore roulette", room(10))).toBe("Chore rou…");
  });

  it("never leaves a stub of one or two letters of a word, backing up to the word before", () => {
    expect(cutText("Onboarding a new flatmate into the rota", room(32))).toBe("Onboarding a new flatmate into…");
    expect(cutText("right now it reads like a list", room(21))).toBe("right now it reads…");
    expect(cutText("Chore roulette", room(9))).toBe("Chore…");
  });

  it("keeps a stub when the word is the first, since backing up would leave nothing", () => {
    expect(cutText("Wheel", room(3))).toBe("Wh…");
  });

  it("never leaves the ellipsis after a space", () => {
    expect(cutText("Chore roulette", room(7))).toBe("Chore…");
  });

  it("never leaves the ellipsis after a comma and its space, or a middle dot", () => {
    expect(cutText("spinning, slowly", room(11))).toBe("spinning…");
    expect(cutText("Forked from Chore roulette · iteration 2", room(29))).toBe("Forked from Chore roulette…");
  });

  it("shows only the ellipsis when no letter fits", () => {
    expect(cutText("Wheel", room(1))).toBe("…");
  });

  it("paints nothing when even the ellipsis doesn't fit, rather than a fleck of it", () => {
    expect(cutText("Wheel", room(0))).toBe("");
  });

  it("cuts before a middle dot rather than leave a stub of two letters or fewer after it", () => {
    expect(cutText("Vary Spin button ×3 · bolder", room(24))).toBe("Vary Spin button ×3…");
    expect(cutText("Vary Spin button ×3 · bolder", room(25))).toBe("Vary Spin button ×3…");
    expect(cutText("Vary Spin button ×3 · bolder", room(26))).toBe("Vary Spin button ×3 · bol…");
  });

  it("never cuts a count from its noun", () => {
    expect(cutText("Vary Spin button ×3 · bolder", room(18))).toBe("Vary Spin button…");
    expect(cutText("Vary Spin button ×12 · bolder", room(19))).toBe("Vary Spin button…");
    expect(cutText("Vary Spin button ×3 · bolder", room(20))).toBe("Vary Spin button ×3…");
  });

  it("never splits a character made of two code units", () => {
    expect(cutText("Spin 🎡 wheel", room(7))).toBe("Spin 🎡…");
  });
});

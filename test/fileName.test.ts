import { describe, expect, test } from "vitest";
import { exportFileName } from "../src/core/fileName";
import type { IterationN, SessionId } from "../src/core/types";

const at = new Date(2026, 10, 6, 22, 59, 26);
const name = (title: string) => exportFileName(title, "s_pi2dp6u1" as SessionId, 2 as IterationN, at);

describe("exportFileName", () => {
  test("names the file by the brainstorm's title, then the iteration and the local time", () => {
    expect(name("Chore roulette")).toBe("Chore roulette-i2-20261106-225926.html");
  });

  test("drops every character Windows forbids and keeps one space between words", () => {
    expect(name('Rota: kitchen / bins <v2>? "final" *really*|now')).toBe("Rota kitchen bins v2 final reallynow-i2-20261106-225926.html");
    expect(name("  Spin\tthe\n\nwheel  ")).toBe("Spin the wheel-i2-20261106-225926.html");
    expect(name("bell\u0007 and tab")).toBe("bell and tab-i2-20261106-225926.html");
  });

  test("never starts or ends the title on a dot or a space", () => {
    expect(name("...hidden plan.")).toBe("hidden plan-i2-20261106-225926.html");
  });

  test("cuts the title at 60 characters, with no space or dot left at the cut", () => {
    expect(name(`${"a".repeat(59)} tail`)).toBe(`${"a".repeat(59)}-i2-20261106-225926.html`);
    expect(name("é".repeat(80))).toBe(`${"é".repeat(60)}-i2-20261106-225926.html`);
  });

  test("moves a title off a name Windows keeps for a device", () => {
    expect([name("CON"), name("nul"), name("Com1"), name("lpt9.notes"), name("aux .x")]).toEqual([
      "CON_-i2-20261106-225926.html",
      "nul_-i2-20261106-225926.html",
      "Com1_-i2-20261106-225926.html",
      "lpt9_.notes-i2-20261106-225926.html",
      "aux_ .x-i2-20261106-225926.html",
    ]);
    expect([name("Console"), name("con notes"), name("COM0")]).toEqual([
      "Console-i2-20261106-225926.html",
      "con notes-i2-20261106-225926.html",
      "COM0-i2-20261106-225926.html",
    ]);
  });

  test("falls back to the brainstorm's id when the title has nothing left", () => {
    expect([name(""), name("   "), name('<>:"/\\|?*'), name(". . .")]).toEqual([
      "s_pi2dp6u1-i2-20261106-225926.html",
      "s_pi2dp6u1-i2-20261106-225926.html",
      "s_pi2dp6u1-i2-20261106-225926.html",
      "s_pi2dp6u1-i2-20261106-225926.html",
    ]);
  });
});

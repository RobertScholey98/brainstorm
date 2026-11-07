import { describe, expect, it } from "vitest";
import { phaseMessage } from "../src/core/machines";
import { PHASE } from "../src/renderer/status";

describe("a phase's two names", () => {
  it("the header's words for a request on its way start with the name a row gives it, so the two never read as two phases", () => {
    const words = (["sending", "starting", "queued", "working", "asking", "previous_thread"] as const).map((phase) => [
      PHASE[phase].short,
      phaseMessage({ phase, actions: [] }, { title: "Chore roulette", changed: [] }),
    ]);
    expect(words).toEqual([
      ["Sending", "Sending to T3…"],
      ["Starting", "Starting a T3 thread…"],
      ["Queued", "Queued in T3"],
      ["Agent working", "Agent working"],
      ["Agent asking", "Agent asking in T3"],
      ["Sent to the previous thread", "Sent to the previous thread"],
    ]);
    expect(words.filter(([short, long]) => !long!.startsWith(short!))).toEqual([]);
  });
});

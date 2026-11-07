import { describe, expect, it } from "vitest";
import { phaseMessage } from "../src/core/machines";
import { PHASE } from "../src/renderer/status";

describe("a phase's two names", () => {
  it("the header's words for a request on its way hold the name a row gives it, so the two never read as two phases", () => {
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
      ["Previous thread", "Sent to the previous thread"],
    ]);
    expect(words.filter(([short, long]) => !long!.toLowerCase().includes(short!.toLowerCase()))).toEqual([]);
  });

  it("gives the accent only to the phase where the agent is running, so sending and starting spin muted, as Export does", () => {
    expect(Object.entries(PHASE).filter(([, p]) => p.tone === "accent").map(([phase]) => phase)).toEqual(["working"]);
    expect([PHASE.sending, PHASE.starting].map((p) => [p.tone, p.live])).toEqual([["muted", true], ["muted", true]]);
  });

  it("counts how long a phase has run only while it runs, so a failure never reads as a long run", () => {
    expect(Object.entries(PHASE).filter(([, p]) => p.ended !== true).map(([phase]) => phase)).toEqual(["sending", "starting", "queued", "working", "asking", "previous_thread"]);
  });
});

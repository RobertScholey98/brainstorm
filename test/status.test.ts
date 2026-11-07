import { describe, expect, it } from "vitest";
import { phaseMessage } from "../src/core/machines";
import type { OpenPhase, SessionListing } from "../src/core/types";
import { echoTone, loudestPhase, PHASE } from "../src/renderer/status";

describe("a phase's two names", () => {
  it("the header's words for a request on its way hold the name a row gives it, so the two never read as two phases", () => {
    const words = (["sending", "starting", "queued", "working", "asking", "previous_thread"] as const).map((phase) => [
      PHASE[phase].short,
      phaseMessage({ phase, actions: [] }, { title: "Chore roulette", changed: [] }),
    ]);
    expect(words).toEqual([
      ["Sending", "Sending to T3"],
      ["Starting", "Starting a T3 thread"],
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

describe("a folded group's head", () => {
  const row = (request: OpenPhase | null, lost = false) => ({ request, lost }) as SessionListing;

  it("shows the phase that most needs Rob, then the agent at work, so folding a group never hides a live brainstorm", () => {
    expect(loudestPhase([row(null), row("queued"), row("working")])).toBe("working");
    expect(loudestPhase([row("working"), row("asking")])).toBe("asking");
    expect(loudestPhase([row("asking"), row(null, true)])).toBe("thread_lost");
    expect(loudestPhase([row("send_failed"), row(null, true)])).toBe("send_failed");
    expect(loudestPhase([row(null), row(null)])).toBe(null);
  });
});

describe("a phase's echo beside the header", () => {
  it("keeps a running phase's hue, so asking never shares a queue's grey, and mutes one whose strip already carries it", () => {
    const echoes = (["queued", "working", "asking", "previous_thread", "no_change", "run_failed"] as const).map((phase) => [phase, echoTone(phase)]);
    expect(echoes).toEqual([
      ["queued", "muted"],
      ["working", "accent"],
      ["asking", "info"],
      ["previous_thread", "muted"],
      ["no_change", "muted"],
      ["run_failed", "muted"],
    ]);
  });
});

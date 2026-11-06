import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPOSER, composerPlace, POPOVER_WIDTH } from "../src/renderer/placement";

const bounds = { width: 1000, height: 700 };

describe("composerPlace", () => {
  it("places each overlay at the popover width it renders at", () => {
    const styles = readFileSync("src/renderer/styles.css", "utf8");
    const step = (size: string) => Number(new RegExp(`--spacing-popover-${size}:\\s*(\\d+)px`).exec(styles)?.[1]);
    expect([POPOVER_WIDTH.sm, POPOVER_WIDTH.md, COMPOSER.width]).toEqual([step("sm"), step("md"), step("sm")]);
    expect(readFileSync("src/renderer/Feedback.tsx", "utf8")).toContain("POPOVER_WIDTH.sm");
    expect(readFileSync("src/renderer/Vary.tsx", "utf8")).toMatch(/POPOVER_WIDTH\.md[\s\S]*size="md"/);
  });

  it("places a taller overlay above its element by its own height, so it never comes down over the element", () => {
    expect(composerPlace({ x: 120, y: 610 }, { x: 100, y: 600, width: 80, height: 20 }, bounds, { width: 380, height: 240 })).toEqual({ left: 100, top: 348 });
  });

  it("puts the composer 12 px under the picked element, left-aligned with it", () => {
    expect(composerPlace({ x: 120, y: 110 }, { x: 100, y: 100, width: 80, height: 20 }, bounds)).toEqual({ left: 100, top: 132 });
  });

  it("flips above the element when there's no room below", () => {
    expect(composerPlace({ x: 120, y: 610 }, { x: 100, y: 600, width: 80, height: 20 }, bounds)).toEqual({ left: 100, top: 408 });
  });

  it("falls back to beside the click when the element fills the canvas", () => {
    expect(composerPlace({ x: 400, y: 300 }, { x: 0, y: 0, width: 1000, height: 700 }, bounds)).toEqual({ left: 412, top: 312 });
  });

  it("keeps a 12 px margin from the canvas edges", () => {
    expect(composerPlace({ x: 990, y: 20 }, { x: 960, y: 10, width: 30, height: 20 }, bounds)).toEqual({ left: 668, top: 42 });
    expect(composerPlace({ x: 5, y: 20 }, { x: -40, y: 10, width: 60, height: 20 }, bounds).left).toBe(12);
  });
});

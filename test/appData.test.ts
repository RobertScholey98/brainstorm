import { describe, expect, test } from "vitest";
import { brainstormHome } from "../src/server/appData";

describe("brainstormHome", () => {
  test("BRAINSTORM_HOME wins on every platform", () => {
    expect(brainstormHome({ BRAINSTORM_HOME: "/tmp/bs", APPDATA: "C:\\Users\\rob\\AppData\\Roaming" }, "win32")).toBe("/tmp/bs");
    expect(brainstormHome({ BRAINSTORM_HOME: "/tmp/bs", HOME: "/Users/rob" }, "darwin")).toBe("/tmp/bs");
  });

  test("falls back to the per-user app data folder of each platform", () => {
    expect(brainstormHome({ APPDATA: "C:\\Users\\rob\\AppData\\Roaming" }, "win32")).toBe("C:\\Users\\rob\\AppData\\Roaming\\brainstorm");
    expect(brainstormHome({ HOME: "/Users/rob" }, "darwin")).toBe("/Users/rob/Library/Application Support/brainstorm");
    expect(brainstormHome({ HOME: "/home/rob" }, "linux")).toBe("/home/rob/.config/brainstorm");
    expect(brainstormHome({ HOME: "/home/rob", XDG_CONFIG_HOME: "/home/rob/.cfg" }, "linux")).toBe("/home/rob/.cfg/brainstorm");
  });
});

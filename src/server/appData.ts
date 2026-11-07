import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { z } from "zod";
import { packageRoot } from "../core/packageRoot";

/** What the CLI needs to reach a running server. The UI token is never written to disk. */
export type ApiInfo = {
  readonly port: number;
  readonly agentToken: string;
  readonly pid: number;
  readonly version: string;
  readonly startedAt: string;
};

const apiShape = z.object({
  port: z.number().int().min(1).max(65535),
  agentToken: z.string().min(1),
  pid: z.number().int(),
  version: z.string(),
  startedAt: z.string(),
});

/** BRAINSTORM_HOME, else the per-user app data folder Electron itself would pick on this platform. */
export function brainstormHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.BRAINSTORM_HOME) return env.BRAINSTORM_HOME;
  if (platform === "win32") return win32.join(env.APPDATA ?? win32.join(homedir(), "AppData", "Roaming"), "brainstorm");
  const home = env.HOME ?? homedir();
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "brainstorm");
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), "brainstorm");
}

export const apiFile = (home: string): string => join(home, "api.json");

export const exportsDir = (home: string): string => join(home, "exports");

/** Null when the file is missing or isn't one the server wrote. */
export function readApi(home: string): ApiInfo | null {
  try {
    const parsed = apiShape.safeParse(JSON.parse(readFileSync(apiFile(home), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Temp file then rename, so a reader never sees half a file. */
export function writeApi(home: string, info: ApiInfo): void {
  const file = apiFile(home);
  writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(info, null, 2));
  renameSync(`${file}.${process.pid}.tmp`, file);
}

export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("package.json", packageRoot()), "utf8")) as { version?: unknown };
  return String(pkg.version ?? "0.0.0");
}

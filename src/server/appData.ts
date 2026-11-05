import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

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

export function brainstormHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAINSTORM_HOME || join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "brainstorm");
}

export const apiFile = (home: string): string => join(home, "api.json");

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

/** The package version, found from the package root so it resolves from src/ and from dist/. */
export function packageVersion(): string {
  for (let dir = new URL(".", import.meta.url); ; dir = new URL("..", dir)) {
    const file = new URL("package.json", dir);
    if (existsSync(file)) return String((JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version ?? "0.0.0");
    if (dir.pathname === new URL("..", dir).pathname) return "0.0.0";
  }
}

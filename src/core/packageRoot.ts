import { existsSync } from "node:fs";

/** The directory holding package.json, found by walking up so it resolves from src/ under vitest and from any dist/ bundle. */
export function packageRoot(): URL {
  for (let dir = new URL(".", import.meta.url); ; dir = new URL("..", dir)) {
    if (existsSync(new URL("package.json", dir))) return dir;
    if (dir.pathname === new URL("..", dir).pathname) throw new Error("no package.json above the brainstorm modules");
  }
}

export function builtFile(path: string): URL {
  const file = new URL(`dist/${path}`, packageRoot());
  if (!existsSync(file)) throw new Error(`${file.pathname} is missing; run npm run build`);
  return file;
}

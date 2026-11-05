/** What block.tsx may import. sucrase's automatic runtime adds react/jsx-runtime itself. */
export const ALLOWED_IMPORTS: readonly string[] = ["react", "react/jsx-runtime"];

/** Per block, covering compile, module evaluation and every render probe. */
export const CHECK_TIMEOUT_MS = 3000;

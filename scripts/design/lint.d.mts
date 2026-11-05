export type Problem = { rule: "arbitrary-value" | "raw-colour" | "off-scale"; line: number; text: string; message: string };
export type Design = { readonly __design: unique symbol };
export const SIZING_ONLY: ReadonlySet<string>;
export function loadDesign(styles?: string): Promise<Design>;
export function lintSource(design: Design, source: string, options?: { kit?: boolean }): Problem[];
export function lintRenderer(): Promise<(Problem & { file: string })[]>;

import { z } from "zod";
import { issue, type Issue, type IssueCode } from "./types";

export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((key) => "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1")).join("");
}

const errorMap = (iss: { input?: unknown; path?: PropertyKey[]; code?: string }): string | undefined => {
  if (iss.code === "invalid_type" && iss.input === undefined) {
    const key = iss.path?.at(-1);
    return key === undefined ? "missing value" : `missing "${String(key)}"`;
  }
  return undefined;
};

/** A zod schema that mints a brand through its parser, so the parser stays the only place the brand is made. */
export function zBranded<I, T>(base: z.ZodType<I>, parse: (raw: I) => T | null, what: string) {
  return base.transform((raw, ctx): T => {
    const value = parse(raw);
    if (value === null) ctx.addIssue({ code: "custom", message: `${JSON.stringify(raw)} is not a ${what}` });
    return value as T;
  });
}

export function parseWith<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: IssueCode,
  where: { file: string | null; pointerPrefix?: string },
): { ok: true; data: T } | { ok: false; issues: Issue[] } {
  const result = schema.safeParse(value, { error: errorMap });
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((zi) =>
      issue(code, zi.message, { file: where.file, pointer: (where.pointerPrefix ?? "") + toPointer(zi.path) }),
    ),
  };
}

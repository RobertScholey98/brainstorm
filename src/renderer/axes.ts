import type { ThemeAxis } from "../core/system/css";

const capital = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());

/** A theme axis in Rob's words, the one name the Inspector, the gallery and the Theme tab all give it. */
export const axisLabel = (attribute: string): string =>
  attribute === "class" || attribute === "data-theme" ? "Mode" : capital(attribute.replace(/^data-/, ""));

/** An axis's values as a switch offers them: the library's default first, under `defaultValue`, then the rest. */
export const axisOptions = (axis: ThemeAxis, defaultValue: string): { value: string; label: string }[] => [
  { value: defaultValue, label: capital(axis.default ?? "Default") },
  ...axis.values.filter((v) => v !== axis.default).map((v) => ({ value: v, label: capital(v) })),
];

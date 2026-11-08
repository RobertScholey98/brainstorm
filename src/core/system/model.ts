/**
 * The data a design system version holds (ADR 007). Types only, so the window can import them through core/types.
 */
import type { CssDecl, Family, ThemeAxis, Token } from "./css";

export type { CssDecl, Family, ThemeAxis, Token, TokenKind } from "./css";

export type KitExportInfo = { readonly name: string; readonly type: "component" | "function" | "value" };

export type StoryInfo = {
  /** `<file>#<export>`. */
  readonly id: string;
  readonly file: string;
  readonly exportName: string;
  readonly title: string;
  readonly name: string;
  readonly component: string | null;
  readonly args: unknown;
  /** Why the story didn't render in the check, or null when it did. */
  readonly error: string | null;
};

/** A component as the catalog lists it: one per story title, or per export that has no story. */
export type CatalogEntry = {
  readonly name: string;
  /** Exports that belong to it by name, such as CardHeader for Card. */
  readonly parts: readonly string[];
  readonly stories: readonly string[];
  /** Added by Brainstorm because the library has no primitive by that name. */
  readonly generated: boolean;
};

export type SystemStyles = {
  readonly axes: readonly ThemeAxis[];
  readonly tokens: readonly Token[];
  readonly classes: readonly string[];
  readonly measured: Readonly<Record<Family, readonly string[]>>;
  readonly surface: readonly CssDecl[];
};

export type SystemManifest = {
  readonly exports: readonly KitExportInfo[];
  readonly generated: readonly string[];
  readonly frame: string | null;
  readonly catalog: readonly CatalogEntry[];
  readonly stories: readonly StoryInfo[];
  /** Story sources by path relative to the library root, for the agent's working copy. */
  readonly storyFiles: Readonly<Record<string, string>>;
  readonly styles: SystemStyles;
};

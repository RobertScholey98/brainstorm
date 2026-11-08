/** What copying the bundled skill did: nothing, since an identical copy was there, or an install, with the backup of a changed copy. */
export type SkillInstall =
  | { readonly kind: "current"; readonly target: string }
  | { readonly kind: "installed"; readonly target: string; readonly backup: string | null };

/** Where the installed app keeps the agent skill, and how to copy the bundled one there again. */
export type SkillHost = {
  /** ~/.claude/skills/use-brainstorm */
  readonly target: string;
  /** ~/.claude/skill-backups, where a copy Rob changed goes before an install replaces it. */
  readonly backups: string;
  install(): SkillInstall;
};

/** What Settings shows about this install: its version, where it keeps things, and the skill when the app manages one. */
export type AppAbout = {
  readonly version: string;
  /** process.platform, for the shortcuts' modifier names. */
  readonly platform: string;
  /** BRAINSTORM_HOME, or the per-user app data folder. */
  readonly home: string;
  readonly exports: string;
  /** Null for the headless server and an app on another home, which leave the user's skills alone. */
  readonly skill: { readonly target: string; readonly backups: string } | null;
};

/** The folders Settings opens. The main process maps each name to its path, so a link can't name any other folder. */
export const OPENABLE = ["home", "exports", "skill", "skill-backups"] as const;
export type Openable = (typeof OPENABLE)[number];
export const openFolderPath = (folder: Openable) => `/open-folder/${folder}`;

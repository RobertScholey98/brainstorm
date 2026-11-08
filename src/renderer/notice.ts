import type { BlockView, RobAction } from "../core/types";

/** A failure notice: what Rob tried, then why it didn't happen. */
export type Notice = { readonly title: string; readonly detail: string };

/** The step that failed, named as Rob took it, so a notice that came while he looked elsewhere still says what was lost. */
export function failedTitle(action: RobAction | "export" | "list" | "load" | "settle" | "unsettle" | "discard" | "fork" | "history" | "update", blocks: readonly BlockView[] = []): string {
  if (typeof action === "string") {
    if (action === "update") return "Couldn't restart into the update";
    if (action === "export") return "Couldn't export the brainstorm";
    if (action === "list") return "Couldn't refresh the brainstorms";
    if (action === "settle") return "Couldn't settle the brainstorm";
    if (action === "unsettle") return "Couldn't bring the brainstorm back";
    if (action === "discard") return "Couldn't discard the fork";
    if (action === "fork") return "Couldn't fork the brainstorm";
    if (action === "history") return "Couldn't open that iteration";
    return "Couldn't load the brainstorm";
  }
  const setting = (blockId: string, prop: string) =>
    blocks.find((b) => b.id === blockId)?.props.appearance.find((p) => p.name === prop)?.label ?? "the setting";
  switch (action.kind) {
    case "set_override":
      return `Couldn't save ${setting(action.blockId, action.prop)}`;
    case "clear_override":
      return `Couldn't reset ${setting(action.blockId, action.prop)}`;
    case "dismiss_inapplicable":
      return "Couldn't dismiss the old setting";
    case "select_variant":
      return "Couldn't switch the variant";
    case "add_feedback":
      return "Couldn't pin the comment";
    case "edit_feedback":
      return `Couldn't save comment ${action.id}`;
    case "delete_feedback":
      return `Couldn't delete comment ${action.id}`;
    case "confirm_feedback":
      return `Couldn't confirm comment ${action.id}`;
    case "reopen_feedback":
      return `Couldn't reopen comment ${action.id}`;
    case "regenerate":
      return "Couldn't send the request";
    case "vary":
      return "Couldn't send the vary request";
    case "mark_seen":
      return "Couldn't mark the variants seen";
    case "retry_request":
      return "Couldn't send the request again";
    case "withdraw_request":
      return "Couldn't withdraw the request";
    case "check_thread":
      return "Couldn't check the thread";
    case "set_theme_axis":
    case "set_theme_token":
    case "clear_theme_token":
    case "reset_theme":
      return "Couldn't change the theme";
    case "apply_theme":
      return `Couldn't apply the theme "${action.name}"`;
    case "save_theme":
      return `Couldn't save the theme "${action.name}"`;
    case "upgrade_system":
      return "Couldn't upgrade the design system";
    case "promote":
      return `Couldn't promote ${action.name}`;
  }
}

import type { NotifyChoice } from "../core/prefs";
import type { SessionId } from "../core/types";
import type { Alert } from "./notify";

/**
 * Raises each alert as a system notification while the window is in the background, as T3 Code does, and opens the
 * brainstorm when Rob clicks it. The main process brings the window forward on /main-window/focus.
 */
export function raise(alerts: readonly Alert[], choice: NotifyChoice, onOpen: (id: SessionId) => void): void {
  if (choice === "off" || alerts.length === 0 || document.hasFocus() || typeof Notification === "undefined") return;
  for (const alert of alerts) {
    try {
      // The tag replaces an older alert for the same brainstorm rather than stacking a second.
      const n = new Notification(alert.title, { body: alert.body, silent: choice === "silent", tag: alert.session });
      n.onclick = () => {
        window.open("/main-window/focus", "_blank");
        onOpen(alert.session);
        n.close();
      };
    } catch {
      // A notification the OS refuses is no reason to interrupt Rob.
    }
  }
}

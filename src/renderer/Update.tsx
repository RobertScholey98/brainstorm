import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarFooter } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { installable, type AppUpdateState } from "../core/appUpdate";

/**
 * The sidebar's foot, as T3 Code puts its update pill: empty until a newer Brainstorm is on its way, then its progress,
 * then one button that restarts into it. A failed check says nothing, since the next poll tries again by itself.
 */
export function UpdateFooter({ state, onInstall }: { state: AppUpdateState | null; onInstall: () => void }) {
  if (state === null) return null;
  if (state.kind === "downloading") {
    return (
      <SidebarFooter data-update="downloading">
        <p className="flex items-center gap-2 px-2 text-xs text-fg-muted">
          <Spinner className="size-3.5" aria-hidden />
          Downloading Brainstorm {state.version} · {state.percent}%
        </p>
      </SidebarFooter>
    );
  }
  const version = state.kind === "installing" ? state.version : installable(state);
  if (version === null) return null;
  return (
    <SidebarFooter data-update={state.kind}>
      {state.kind === "failed" && <p className="px-2 text-xs text-danger">The update didn't install: {state.message}</p>}
      <Hint label={`Installs Brainstorm ${version} and opens it again. Quitting installs it too.`} side="right">
        <Button variant="accent" disabled={state.kind === "installing"} onClick={onInstall} data-update-install>
          {state.kind === "installing" ? <Spinner data-icon="inline-start" aria-hidden /> : <RotateCw data-icon="inline-start" aria-hidden />}
          {state.kind === "installing" ? "Restarting…" : "Restart to update"}
        </Button>
      </Hint>
    </SidebarFooter>
  );
}

import { ArrowDownToLine, RefreshCw, RotateCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarFooter, SidebarMenuButton } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { canCheck, installable, type AppUpdateState } from "../core/appUpdate";
import { age, useNow } from "./time";

/** What Rob can do about the update now, which the sidebar's update button and Settings both offer. */
export type UpdateMove = "check" | "download" | "install" | null;

export function updateMove(state: AppUpdateState | null): UpdateMove {
  if (state === null) return null;
  if (installable(state) !== null) return "install";
  if (state.kind === "available") return "download";
  return canCheck(state) ? "check" : null;
}

/** When Brainstorm last looked, as Settings and the update hint say it. */
export function checkedText(checkedAt: string | null, now: number): string {
  if (checkedAt === null) return "Not checked yet";
  const ago = age(checkedAt, now);
  return ago === "now" ? "Checked now" : /^\d+[mhd]$/.test(ago) ? `Checked ${ago} ago` : `Checked on ${ago}`;
}

/** One line on where updating stands, in Settings' Updates row and the update button's hint. */
export function updateStatus(state: AppUpdateState | null, now: number): string {
  if (state === null) return "Looking for the updater…";
  switch (state.kind) {
    case "off":
      return state.reason;
    case "idle":
      return `Up to date. ${checkedText(state.checkedAt, now)}.`;
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Brainstorm ${state.version} is out. Download it when you're ready.`;
    case "downloading":
      return `Downloading Brainstorm ${state.version} · ${state.percent}%`;
    case "ready":
      return `Brainstorm ${state.version} is downloaded. Restart to install it; quitting installs it too.`;
    case "installing":
      return `Restarting into Brainstorm ${state.version}…`;
    case "failed":
      return state.version === null ? `The last check failed: ${state.message}` : `Brainstorm ${state.version} didn't install: ${state.message}`;
  }
}

const MOVE_LABEL: Record<NonNullable<UpdateMove>, string> = { check: "Check for updates", download: "Download update", install: "Restart to update" };

/**
 * The sidebar's foot, as T3 Code has it: Settings, with the update button beside it. The button checks for an update;
 * it spins while a check, a download or a restart runs, and shows an accent dot once there's one to download or
 * install, when a press does that instead. A downloaded update also brings back the full-width Restart to update above,
 * which says what it does in words.
 */
export function SidebarFoot({
  state,
  onSettings,
  onCheck,
  onDownload,
  onInstall,
}: {
  state: AppUpdateState | null;
  onSettings: () => void;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const version = state?.kind === "installing" ? state.version : state === null ? null : installable(state);
  return (
    <SidebarFooter data-update={state?.kind}>
      {version !== null && state !== null && (
        <>
          {state.kind === "failed" && <p className="px-2 text-xs text-danger">The update didn't install: {state.message}</p>}
          <Hint label={`Installs Brainstorm ${version} and opens it again. Quitting installs it too.`} side="right">
            <Button variant="accent" disabled={state.kind === "installing"} onClick={onInstall} data-update-install>
              {state.kind === "installing" ? <Spinner data-icon="inline-start" aria-hidden /> : <RotateCw data-icon="inline-start" aria-hidden />}
              {state.kind === "installing" ? "Restarting…" : "Restart to update"}
            </Button>
          </Hint>
        </>
      )}
      <div className="flex items-center gap-1">
        <SidebarMenuButton tone="quiet" className="min-w-0 flex-1" onClick={onSettings} data-settings-open>
          <Settings aria-hidden />
          <span>Settings</span>
        </SidebarMenuButton>
        <UpdateButton state={state} onCheck={onCheck} onDownload={onDownload} onInstall={onInstall} />
      </div>
    </SidebarFooter>
  );
}

function UpdateButton({ state, onCheck, onDownload, onInstall }: { state: AppUpdateState | null; onCheck: () => void; onDownload: () => void; onInstall: () => void }) {
  const now = useNow();
  const move = updateMove(state);
  const busy = state?.kind === "checking" || state?.kind === "downloading" || state?.kind === "installing";
  const icon = busy ? <Spinner aria-hidden /> : move === "download" ? <ArrowDownToLine aria-hidden /> : <RefreshCw aria-hidden />;
  const status = updateStatus(state, now);
  if (move === null) {
    return (
      <BlockedHint label={status} side="right" data-update-button={state?.kind ?? "loading"}>
        <Button variant="ghost" size="icon" disabled aria-label={status}>
          {icon}
        </Button>
      </BlockedHint>
    );
  }
  const press = move === "check" ? onCheck : move === "download" ? onDownload : onInstall;
  // An idle button's hint is its action with when it last looked; one with news leads with the news.
  const label = state?.kind === "idle" ? checkedText(state.checkedAt, now) : status;
  return (
    <Hint name={MOVE_LABEL[move]} label={label} side="right">
      <span className="relative flex">
        <Button variant="ghost" size="icon" onClick={press} aria-label={MOVE_LABEL[move]} data-update-button={state?.kind}>
          {icon}
        </Button>
        {move !== "check" && <span aria-hidden className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-accent" data-update-dot />}
      </span>
    </Hint>
  );
}

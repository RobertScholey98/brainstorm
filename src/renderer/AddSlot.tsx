import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitKey } from "@/components/ui/kbd";
import { FieldLabel } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * Add slot, from the sidebar's slot picker (ADR 009): a prompt for a new slot, which goes to the agent as a request.
 * The dialog stays small, a prompt and its send, over the window.
 */
export function AddSlotDialog({
  open,
  blocked,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  /** Why a request can't be sent now, or null. */
  blocked: string | null;
  onOpenChange: (open: boolean) => void;
  /** Sends; false keeps the dialog open, since the failure already shows. */
  onSend: (prompt: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const prompt = text.trim();
  const ready = prompt !== "" && blocked === null && !sending;
  const send = async () => {
    if (!ready) return;
    setSending(true);
    const ok = await onSend(prompt);
    setSending(false);
    if (ok) {
      setText("");
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-auto w-popover-md" data-add-slot-dialog>
        <DialogHeader heading="Add slot" />
        <div className="grid gap-3 p-4">
          <label className="grid gap-1.5">
            <FieldLabel>What should the new slot show?</FieldLabel>
            <Textarea
              rows={4}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void send()}
              placeholder="The empty state, when there's nothing to spin yet"
              className="resize-none"
              data-add-slot-prompt
            />
          </label>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs text-fg-muted" data-add-slot-hint>
              {blocked ?? "The agent adds it, in this thread"}
            </span>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitKey disabled={!ready}>
              <Button variant="accent" disabled={!ready} onClick={() => void send()} data-add-slot-send>
                {sending && <Spinner data-icon="inline-start" />}
                {sending ? "Sending…" : "Send"}
              </Button>
            </SubmitKey>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

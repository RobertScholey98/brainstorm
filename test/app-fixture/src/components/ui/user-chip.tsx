import { session } from "@/store";

export function UserChip() {
  return <span className="rounded-md border border-border px-2 py-1 text-xs">{session.user}</span>;
}

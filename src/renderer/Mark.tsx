import { Brain } from "lucide-react";

/** The brand mark: Lucide's brain in the accent, the same shape as the app icon (packaging/icon.svg). */
export function Mark({ size }: { size: 16 | 20 }) {
  return <Brain size={size} className="text-accent" aria-hidden data-mark />;
}

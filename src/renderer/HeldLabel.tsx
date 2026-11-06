/**
 * A button label that swaps with its state, both labels in one cell and the idle one hidden, so the button keeps the
 * wider one's width and nothing beside it moves: "Pin comment" and "Picking…".
 */
export function HeldLabel({ active, idle, busy }: { active: boolean; idle: string; busy: string }) {
  return (
    <span className="grid *:col-start-1 *:row-start-1">
      <span className={active ? "invisible" : undefined}>{idle}</span>
      <span className={active ? undefined : "invisible"}>{busy}</span>
    </span>
  );
}

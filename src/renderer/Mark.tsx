import { MARK } from "../core/design";

export function Mark({ size }: { size: 16 | 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden data-mark>
      <path className="fill-accent" d={MARK.tile} />
      <circle className="fill-accent-fg" {...MARK.dot} />
    </svg>
  );
}

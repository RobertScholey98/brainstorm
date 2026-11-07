import { useCallback, useSyncExternalStore } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Three letters each, where en-GB's Intl gives September four, so a column of dates keeps one shape. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * How long ago `iso` was, in the one format every surface uses: now, 5m, 3h, 2d, then the date past a week, with
 * the year only when it is not this one.
 */
export function age(iso: string, now: number): string {
  const then = Date.parse(iso);
  const ms = Math.max(0, now - then);
  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  const date = new Date(then);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date(now).getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** How long something has been running since `iso`, as T3 Code counts a working turn: 12s, 3m, then 1h 5m. */
function count(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MINUTE) return `${Math.floor(ms / 1000)}s`;
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  return `${Math.floor(ms / HOUR)}h ${Math.floor((ms % HOUR) / MINUTE)}m`;
}

/** The count since `iso`, empty in its first second, since "0s" reads as a count that has stuck. */
export const elapsed = (iso: string, now: number): string => (now - Date.parse(iso) < 1000 ? "" : count(iso, now));

/** The widest form of the count's unit, "00s", "00m" or "00h 00m", the room it keeps until its unit changes. */
export const elapsedSlot = (iso: string, now: number): string => count(iso, now).replace(/\d+/g, "00");

/** Each reader of the clock, by how often it needs a fresh time. */
const readers = new Map<() => void, number>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
let rate = 0;

function tick() {
  current = Date.now();
  for (const read of readers.keys()) read();
}

function retime() {
  const next = readers.size === 0 ? 0 : Math.min(...readers.values());
  if (next === rate) return;
  clearInterval(timer);
  rate = next;
  timer = next === 0 ? undefined : setInterval(tick, next);
}

/**
 * The one clock every age reads. It ticks as often as its most frequent reader needs, and a new reader brings every
 * reader up to date, so a sidebar row and a card never show one brainstorm at two ages.
 */
export const clock = {
  now: () => current,
  subscribe(read: () => void, every: number): () => void {
    readers.set(read, every);
    retime();
    tick();
    return () => {
      readers.delete(read);
      retime();
    };
  },
};

/** The current time, fresh at least every `every` ms (a minute by default) so ages stay true while the window is open. */
export function useNow(every = MINUTE): number {
  const subscribe = useCallback((read: () => void) => clock.subscribe(read, every), [every]);
  return useSyncExternalStore(subscribe, clock.now);
}

import type { KitPayload, Result, SystemId, SystemVersionN } from "../core/types";

/**
 * Design system kits, fetched once per version for the window: a version never changes, and the session canvas, every
 * home preview and the system page share it.
 */
let fetchKit: ((id: SystemId, n: SystemVersionN) => Promise<Result<KitPayload>>) | null = null;
const kits = new Map<string, Promise<KitPayload | null>>();

export function setKitSource(source: (id: SystemId, n: SystemVersionN) => Promise<Result<KitPayload>>): void {
  fetchKit = source;
}

/** The kit, or null when it couldn't be fetched; a failed fetch is tried again next time. */
export function kitFor(id: SystemId, n: SystemVersionN): Promise<KitPayload | null> {
  const key = `${id}@${n}`;
  const cached = kits.get(key);
  if (cached !== undefined) return cached;
  if (fetchKit === null) return Promise.resolve(null);
  const loading = fetchKit(id, n).then((r) => {
    if (!r.ok) kits.delete(key);
    return r.ok ? r.data : null;
  });
  kits.set(key, loading);
  return loading;
}

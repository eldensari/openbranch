/* localStorage wrapper */

const STORAGE_PREFIX = "ob:";

export type StorageList = { keys: string[] };
export type StorageValue = { value: string | null };

export class QuotaExceededError extends Error {
  code = "QUOTA_EXCEEDED" as const;
  constructor(msg = "Browser storage is full.") {
    super(msg);
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: number };
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014
  );
}

export function list(prefix: string): StorageList {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX + prefix)) {
      keys.push(k.slice(STORAGE_PREFIX.length));
    }
  }
  return { keys };
}

export function get(key: string): StorageValue {
  const v = localStorage.getItem(STORAGE_PREFIX + key);
  return { value: v };
}

export function set(key: string, value: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
  } catch (e) {
    if (isQuotaError(e)) throw new QuotaExceededError();
    throw e;
  }
}

export function del(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

export default { list, get, set, del };

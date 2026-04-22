/* ═══════ localStorage wrapper ═══════ */

const STORAGE_PREFIX = "ob:"; // openbranch namespace

export type StorageList = { keys: string[] };
export type StorageValue = { value: string | null };

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
  localStorage.setItem(STORAGE_PREFIX + key, value);
}

export function del(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

export default { list, get, set, del };

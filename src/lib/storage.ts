/* ═══════ localStorage wrapper ═══════
 * bucklebury Electron의 window.storage API와 동일한 인터페이스.
 * list/get/set/delete — 모두 localStorage 기반.
 */

const STORAGE_PREFIX = "ob:"; // openbranch namespace

export function list(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(STORAGE_PREFIX + prefix)) {
      keys.push(k.slice(STORAGE_PREFIX.length));
    }
  }
  return { keys };
}

export function get(key) {
  const v = localStorage.getItem(STORAGE_PREFIX + key);
  return { value: v };
}

export function set(key, value) {
  localStorage.setItem(STORAGE_PREFIX + key, value);
}

export function del(key) {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

export default { list, get, set, del };

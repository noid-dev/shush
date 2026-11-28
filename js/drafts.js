const PREFIX = 'shush:draft:';
const LAST_ISSUED_KEY = 'shush:last-id';
const VISITED_KEY = 'shush:visited';
const ID_LENGTH = 4;
const ID_COUNT = 36 ** ID_LENGTH;
const COUNTER_ID = /^[0-9a-z]{4}$/;
export const MAX_FOLDERS = 2;
export const DEFAULT_NAME = 'Draft';
const UNSAFE_IN_FILE_NAMES = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
export const draftKey = (id) => PREFIX + id;
export const sameName = (a, b) => naturalOrder(a, b) === 0;
export const isIn = (folders, path) => path.every((name, i) => folders[i] != null && sameName(folders[i], name));
export const sameFolder = (a, b) => a.length === b.length && isIn(a, b);
export const pathLabel = (folders, name = '') => [...folders, name].join('/');

export const isValidName = (name) => !!name
  && !UNSAFE_IN_FILE_NAMES.test(name)
  && !RESERVED_ON_WINDOWS.test(name)
  && !name.startsWith('.')
  && !name.endsWith('.');

export function pathOf(typed) {
  const parts = typed.split('/').map((part) => part.trim());
  const name = parts.pop();
  return parts.every(Boolean) ? { folders: parts, name } : null;
}

export let openId = null;
export let openPath = [];
export let openName = DEFAULT_NAME;

let cachedDrafts = null;
addEventListener('storage', () => { cachedDrafts = null; });

export function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id))); } catch { return null; }
}

export function isKept(id) {
  try { return draftKey(id) in localStorage; } catch { return false; }
}

export const isTaken = (path, name, id = null) => listDrafts()
  .some((d) => d.id !== id && sameFolder(d.path, path) && sameName(d.name, name));

export function availableName(path, name, id = null) {
  let candidate = name;
  for (let n = 2; isTaken(path, candidate, id); n++) candidate = `${name} ${n}`;
  return candidate;
}

export const spelledAsExisting = (path) => path.map((name, i) => listDrafts()
  .find((d) => isIn(d.path, path.slice(0, i + 1)))?.path[i] ?? name);

export function writeDraft(id, { path, name, text, marks }) {
  if (!text.trim()) {
    removeDraft(id);
    return null;
  }
  const spelled = spelledAsExisting(path);
  const draft = { path: spelled, name: availableName(spelled, name, id), text, marks };
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(draft));
    cachedDrafts = cachedDrafts?.filter((d) => d.id !== id);
    cachedDrafts?.push({ id, ...draft });
    return draft.name;
  } catch {
    cachedDrafts = null;
    return null;
  }
}

export function removeDraft(id) {
  cachedDrafts = cachedDrafts?.filter((d) => d.id !== id);
  try { localStorage.removeItem(draftKey(id)); } catch { cachedDrafts = null; }
}

export function listDrafts() {
  if (cachedDrafts) return [...cachedDrafts];
  const drafts = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const id = key.slice(PREFIX.length);
      const draft = readDraft(id);
      if (draft) drafts.push({ id, ...draft });
    }
  } catch {}
  cachedDrafts = drafts;
  return [...drafts];
}

export function asId(text) {
  const id = text.toLowerCase();
  return COUNTER_ID.test(id) ? id : null;
}

const nextCount = (count) => (count % (ID_COUNT - 1)) + 1;
const idOf = (count) => count.toString(36).padStart(ID_LENGTH, '0');

export function newDraftId() {
  let count = 0;
  try { count = parseInt(localStorage.getItem(LAST_ISSUED_KEY) ?? '', 36) || 0; } catch {}
  do count = nextCount(count);
  while (isKept(idOf(count)));
  try { localStorage.setItem(LAST_ISSUED_KEY, idOf(count)); } catch {}
  return idOf(count);
}

export function rememberVisit(id) {
  if (!isKept(id)) return;
  try { localStorage.setItem(VISITED_KEY, id); } catch {}
}

export function lastVisitedId() {
  let id = null;
  try { id = localStorage.getItem(VISITED_KEY); } catch {}
  return id && isKept(id) ? id : null;
}

export function setOpenDraft(id, { path, name }) {
  openId = id;
  openPath = path;
  openName = name;
}

export function placeInFolder() {
  if (!openPath.length) return null;
  const neighbours = listDrafts().filter((d) => d.id !== openId && sameFolder(d.path, openPath));
  return { position: neighbours.filter((d) => naturalOrder(d.name, openName) < 0).length + 1, total: neighbours.length + 1 };
}

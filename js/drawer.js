import { textarea, isReading, characterWidth } from './layout.js';
import { showWriting } from './pages.js';
import { placeCaret } from './paper.js';
import { openDraft, startNewDraft, saveNow, reloadOpenDraft } from './note.js';
import { openId, openPath, listDrafts, readDraft, writeDraft, removeDraft, newDraftId, isIn, sameFolder, sameName, naturalOrder, pathLabel, pathOf, isValidName, isTaken, availableName, spelledAsExisting, MAX_FOLDERS, DEFAULT_NAME } from './drafts.js';

const DOUBLE_SHIFT = 300;
const SNIPPET_LEAD = 8;
const SNIPPET_LENGTH = 60;

const drawer = document.querySelector('.drawer');
const input = drawer.querySelector('input');
const list = drawer.querySelector('ol');
const caret = document.querySelector('.caret');
const placeLabel = drawer.querySelector('.place');
const placeholder = input.placeholder;
const ariaLabel = input.getAttribute('aria-label');

let place = [];
let entries = [];
let selected = -1;
let marked = null;
let navigated = false;

const wordsOf = (query) => query.split(/\s+/).filter(Boolean);
const escaped = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternOf = (word) => new RegExp(escaped(word), 'iu');
const anyOf = (words) => new RegExp([...words].sort((a, b) => b.length - a.length).map(escaped).join('|'), 'giu');
const termOf = (word) => ({
  own: patternOf(word.split('/').filter(Boolean).at(-1) ?? word),
  whole: patternOf(word.replace(/^\/+/, '')),
});
const ownNameMatches = (name, path, terms) => terms.some((t) => t.own.test(name)) && terms.every((t) => t.whole.test(path));
const describe = (draft) => ({ ...draft, label: pathLabel(draft.path, draft.name) });

function foldersBelow(drafts, path) {
  const folders = [];
  for (const draft of drafts) {
    if (draft.path.length <= path.length || !isIn(draft.path, path)) continue;
    const name = draft.path[path.length];
    const known = folders.find((f) => sameName(f.name, name));
    if (known) known.count++;
    else folders.push({ path: [...path, name], name, count: 1 });
  }
  return folders.sort((a, b) => naturalOrder(a.name, b.name));
}

const draftEntry = (draft, withPath = true) => ({
  id: draft.id,
  lead: withPath ? pathLabel(draft.path) : '',
  label: draft.name,
  choose: draft.id === openId ? () => {} : () => openDraft(draft.id),
});
const folderEntry = (folder, from) => ({
  path: folder.path,
  lead: from ? '' : pathLabel(folder.path.slice(0, -1)),
  label: from ? pathLabel(folder.path.slice(from.length)) : `${folder.name}/`,
  aside: `(${folder.count.toLocaleString()}) ›`,
  stays: true,
  choose: () => { place = folder.path; input.value = ''; show(); },
});

function textEntry({ draft, at }) {
  const snippet = draft.text.slice(Math.max(0, at - SNIPPET_LEAD), at + SNIPPET_LENGTH).replace(/\s+/g, ' ');
  return { ...draftEntry(draft), trail: ` …${snippet}`, foundInText: true, choose: () => openDraft(draft.id, { at }) };
}

function boldMatches(text, found) {
  const pieces = [];
  let end = 0;
  for (const { 0: word, index } of text.matchAll(found)) {
    const bold = document.createElement('b');
    bold.textContent = word;
    pieces.push(text.slice(end, index), bold);
    end = index + word.length;
  }
  pieces.push(text.slice(end));
  return pieces;
}

function labelPart(text, found, className = '') {
  if (!text) return '';
  const part = document.createElement('span');
  part.className = className;
  part.append(...(found ? boldMatches(text, found) : [text]));
  return part;
}

function typedPath(query) {
  const typed = query.trim();
  const fromTop = typed.startsWith('/');
  const parsed = pathOf(fromTop ? typed.slice(1) : typed);
  if (!parsed) return { problem: 'invalid path' };
  const folders = spelledAsExisting([...(fromTop ? [] : place), ...parsed.folders]);
  if (folders.length > MAX_FOLDERS) return { problem: `max ${MAX_FOLDERS} folders` };
  if (![...parsed.folders, parsed.name].filter(Boolean).every(isValidName)) return { problem: 'invalid name' };
  if (parsed.name && isTaken(folders, parsed.name)) return { problem: 'name taken' };
  return { folders, name: parsed.name };
}

function newDraftRow(drafts, query = '') {
  const source = marked && drafts.find((d) => d.id === marked);
  const verb = source ? '+ Copy' : '+ New draft';
  const typed = typedPath(query);
  if (typed.problem) return { label: `${verb} (${typed.problem})`, action: true, disabled: true };
  const name = typed.name || (source ? availableName(typed.folders, source.name) : DEFAULT_NAME);
  const named = (typed.name || source) ? ` "${name}"` : '';
  const where = query.trim() && typed.folders.length ? ` in ${pathLabel(typed.folders)}` : '';
  const target = { path: typed.folders, name };
  return {
    label: source ? `${verb} as${named}${where}` : `${verb}${named}${where}`,
    action: true,
    target,
    choose: () => startNewDraft(target),
  };
}

function browse(drafts) {
  const here = drafts.filter((d) => sameFolder(d.path, place)).sort((a, b) => naturalOrder(a.name, b.name));
  return [newDraftRow(drafts), ...foldersBelow(drafts, place).map((f) => folderEntry(f, place)), ...here.map((d) => draftEntry(d, false))];
}

function textMatch(draft, terms) {
  if (!terms.every((t) => t.whole.test(draft.text))) return null;
  return { draft, at: draft.text.search(terms[0].whole) };
}

function search(drafts, query) {
  const words = wordsOf(query);
  const terms = words.map(termOf);
  const inPlace = (folders) => isIn(folders, place);
  const topFolders = foldersBelow(drafts, []);
  const folders = [...topFolders, ...topFolders.flatMap((f) => foldersBelow(drafts, f.path))]
    .filter((f) => ownNameMatches(f.name, pathLabel(f.path), terms));
  const named = drafts.filter((d) => ownNameMatches(d.name, d.label, terms));
  const inText = drafts
    .filter((d) => !named.includes(d))
    .map((draft) => textMatch(draft, terms))
    .filter(Boolean);
  const names = (here) => [
    ...folders.filter((f) => inPlace(f.path) === here).map((f) => folderEntry(f)),
    ...named.filter((d) => inPlace(d.path) === here).map((d) => draftEntry(d)),
  ];
  const texts = (here) => inText.filter(({ draft }) => inPlace(draft.path) === here).map(textEntry);
  const found = anyOf(words);
  const matches = [...names(true), ...names(false), ...texts(true), ...texts(false)].map((entry) => ({ ...entry, found }));
  return [newDraftRow(drafts, query), ...matches];
}

function find(query) {
  const drafts = listDrafts().map(describe).sort((a, b) => naturalOrder(a.label, b.label));
  return query.trim() ? search(drafts, query) : browse(drafts);
}

function markHiddenLines() {
  list.classList.toggle('more-above', list.scrollTop > 0);
  list.classList.toggle('more-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
}

function markSelected() {
  [...list.children].forEach((item, i) => {
    item.setAttribute('aria-selected', i === selected);
    if (i !== selected) return;
    const row = item.offsetHeight;
    const top = item.offsetTop - list.offsetTop;
    if (list.scrollTop > top - row) list.scrollTop = Math.max(0, top - row);
    else if (list.scrollTop < top + 2 * row - list.clientHeight) list.scrollTop = top + 2 * row - list.clientHeight;
  });
  markHiddenLines();
  if (selected >= 0) input.setAttribute('aria-activedescendant', `drawer-${selected}`);
  else input.removeAttribute('aria-activedescendant');
}

function markRows() {
  drawer.classList.toggle('marking', !!marked);
  [...list.children].forEach((item, i) => item.classList.toggle('dim', !!marked && entries[i].id === marked));
}

function show() {
  const browsing = !input.value.trim() && place.length;
  placeLabel.textContent = browsing ? `${pathLabel(place)} ` : '';
  input.placeholder = place.length ? '' : placeholder;
  input.setAttribute('aria-label', browsing ? `${ariaLabel} in ${pathLabel(place)}` : ariaLabel);
  entries = find(input.value);
  if (entries.length > 1) selected = 1;
  else selected = input.value.trim() ? -1 : 0;
  list.replaceChildren(...entries.map((entry, i) => {
    const item = document.createElement('li');
    item.id = `drawer-${i}`;
    item.setAttribute('role', 'option');
    item.classList.toggle('action', !!entry.action);
    item.classList.toggle('disabled', !!entry.disabled);
    item.toggleAttribute('data-draft', !!entry.id);
    const inName = !entry.foundInText && entry.found;
    const label = document.createElement('span');
    label.append(
      labelPart(entry.lead, inName),
      labelPart(entry.label, inName, 'name'),
      labelPart(entry.trail, entry.foundInText && entry.found),
    );
    item.append(label);
    if (entry.aside) {
      const aside = document.createElement('span');
      aside.className = 'aside';
      aside.textContent = entry.aside;
      item.append(aside);
    }
    item.addEventListener('pointerdown', (event) => event.preventDefault());
    item.addEventListener('click', () => choose(i));
    return item;
  }));
  markRows();
  markSelected();
  placeCardCaret();
}

function refresh() {
  const at = selected;
  show();
  selected = Math.min(at, entries.length - 1);
  markSelected();
}

function stepOut() {
  if (!place.length) return;
  const path = place;
  place = place.slice(0, -1);
  show();
  const left = entries.findIndex((entry) => entry.path && sameFolder(entry.path, path));
  if (left >= 0) {
    selected = left;
    markSelected();
  }
}

function toggleMark() {
  const { id } = entries[selected] ?? {};
  if (!id) return;
  marked = marked === id ? null : id;
  refresh();
}

function blankThePage() {
  openDraft(newDraftId(), { focus: false });
  caretWas = { ...caretWas, style: undefined, deciding: false };
}

function removeMarked() {
  removeDraft(marked);
  if (marked === openId) blankThePage();
  marked = null;
  refresh();
}

function copyMarkedTo({ path, name }) {
  saveNow();
  const source = readDraft(marked);
  if (!source) return;
  writeDraft(newDraftId(), { path, name, text: source.text, marks: source.marks });
  marked = null;
  place = path;
  input.value = '';
  show();
}

function replaceWithMarked(id) {
  if (id === marked) return;
  saveNow();
  const source = readDraft(marked);
  const target = readDraft(id);
  if (!source || !target) return;
  writeDraft(id, { ...target, text: source.text, marks: source.marks });
  if (id === openId) reloadOpenDraft();
  marked = null;
  refresh();
}

function move(step) {
  if (!entries.length) return;
  selected = Math.min(entries.length - 1, Math.max(0, selected + step));
  markSelected();
}

function placeCardCaret() {
  caret.hidden = input.selectionStart !== input.selectionEnd;
  if (caret.hidden) return;
  const thickness = parseFloat(caret.style.getPropertyValue('--thickness')) || 1.75;
  const { left } = input.getBoundingClientRect();
  caret.style.width = `${thickness}px`;
  caret.style.left = `${left + input.selectionStart * characterWidth - input.scrollLeft - thickness / 2}px`;
}

let caretWas = null;

function openDrawer() {
  saveNow();
  caretWas = { insert: caret.hasAttribute('data-insert'), style: caret.dataset.style, deciding: caret.hasAttribute('data-deciding') };
  caret.toggleAttribute('data-insert', true);
  caret.toggleAttribute('data-deciding', false);
  delete caret.dataset.style;
  document.body.classList.add('finding');
  drawer.hidden = false;
  place = [...openPath];
  navigated = false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  show();
  if (input.value.trim()) return;
  const current = entries.findIndex((entry) => entry.id === openId);
  if (current >= 0) {
    selected = current;
    markSelected();
  }
}

function closeDrawer() {
  marked = null;
  drawer.hidden = true;
  document.body.classList.remove('finding');
  caret.toggleAttribute('data-insert', caretWas.insert);
  caret.toggleAttribute('data-deciding', caretWas.deciding);
  if (caretWas.style) caret.dataset.style = caretWas.style;
  if (!isReading()) textarea.focus({ preventScroll: true });
  placeCaret();
}

function choose(i) {
  const entry = entries[i];
  if (marked && entry?.id) return replaceWithMarked(entry.id);
  if (marked && entry?.target) return copyMarkedTo(entry.target);
  if (!entry?.choose) return;
  if (entry.stays) return entry.choose();
  input.value = '';
  closeDrawer();
  if (isReading()) showWriting();
  entry.choose();
}

input.addEventListener('input', () => {
  navigated = false;
  show();
});
input.addEventListener('pointerup', placeCardCaret);
list.addEventListener('scroll', markHiddenLines);
input.addEventListener('blur', () => { if (!drawer.hidden) closeDrawer(); });
input.addEventListener('keydown', (event) => {
  event.stopPropagation();
  if (event.isComposing) return;
  const command = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDrawer();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (selected >= 0) choose(selected);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigated = true;
    if (entries[selected]?.stays) choose(selected);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigated = true;
    if (!input.value) stepOut();
  } else if (event.key === ' ' && !command && !event.altKey && !event.shiftKey && (!input.value || navigated)) {
    event.preventDefault();
    toggleMark();
  } else if (marked && (event.key === 'Delete' || (event.metaKey && event.key === 'Backspace'))) {
    event.preventDefault();
    removeMarked();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    navigated = true;
    move(event.key === 'ArrowDown' ? 1 : -1);
  } else {
    requestAnimationFrame(placeCardCaret);
  }
});

let shiftAlone = false;
let shiftTappedAt = -Infinity;

addEventListener('keydown', (event) => {
  if (event.key === 'Shift' && !event.isComposing) {
    if (!event.repeat) shiftAlone = true;
  } else {
    shiftAlone = false;
    shiftTappedAt = -Infinity;
  }
}, true);

addEventListener('keyup', (event) => {
  if (event.key !== 'Shift' || !shiftAlone) return;
  shiftAlone = false;
  if (event.timeStamp - shiftTappedAt > DOUBLE_SHIFT) {
    shiftTappedAt = event.timeStamp;
    return;
  }
  shiftTappedAt = -Infinity;
  if (drawer.hidden) openDrawer();
}, true);

addEventListener('pointerdown', () => {
  shiftAlone = false;
  shiftTappedAt = -Infinity;
}, true);

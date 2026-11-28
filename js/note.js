import { ZERO_WIDTH_SPACE, textarea, mirror, lineStartBefore, lineEndAfter, codePointCount, lineBreaksBefore, charactersPerRow, rowOf, ROWS_PER_PAGE } from './layout.js';
import { scheduleUpdate, placeCaret, countTotals } from './paper.js';
import { openId, openPath, openName, DEFAULT_NAME, draftKey, readDraft, writeDraft, setOpenDraft, lastVisitedId, newDraftId, isKept, asId, rememberVisit } from './drafts.js';

const [BOLD, UNDERLINE, STRIKE, RED, HIGHLIGHT, PENDING] = [1, 2, 4, 8, 16, 32];
const STYLES = BOLD | UNDERLINE | STRIKE | RED | HIGHLIGHT;
const MARK_TAGS = [[BOLD, 'b'], [UNDERLINE, 'u'], [STRIKE, 's'], [RED, 'span', 'red'], [HIGHLIGHT, 'mark'], [PENDING, 'span', 'pending']];
const STYLE_KEYS = { '*': BOLD, _: UNDERLINE, '~': STRIKE, '!': RED, '@': HIGHLIGHT };
const STYLE_NAMES = { [BOLD]: 'bold', [UNDERLINE]: 'underline', [STRIKE]: 'strike', [RED]: 'red', [HIGHLIGHT]: 'highlight' };
const MARK_HISTORY_SIZE = 20;
const SAVE_INTERVAL = 100;
const WHITESPACE_CLASS = { ' ': 'space', '\t': 'tab', '\n': 'break' };

const mirrorEnd = mirror.appendChild(document.createTextNode(ZERO_WIDTH_SPACE));
let mirroredLines = [];

function whitespaceMark(char) {
  const mark = document.createElement('i');
  mark.className = WHITESPACE_CLASS[char];
  mark.textContent = char;
  return mark;
}

let marks = new Uint8Array();
let markedText = '';

function setMarks(runs) {
  markedText = textarea.value;
  marks = new Uint8Array(markedText.length);
  try { for (const [from, to, mark] of runs) marks.fill(mark & STYLES, from, to); } catch {}
}

const NOT_HERE = 'Not in this drawer.';
const SKIP_WAIT = 300;
const placeholder = textarea.placeholder;

function showDraft(id, { path = [], name = DEFAULT_NAME } = {}) {
  const draft = readDraft(id);
  setOpenDraft(id, draft ?? { path, name });
  textarea.readOnly = false;
  textarea.placeholder = placeholder;
  textarea.value = draft?.text ?? '';
  setMarks(draft?.marks ?? []);
}

function markNotHere() {
  textarea.readOnly = true;
  textarea.placeholder = NOT_HERE;
}

const addressOf = (id) => (isKept(id) ? `#${id}` : location.pathname + location.search);
const askedAddress = () => location.hash.slice(1);

function draftAtAddress() {
  const id = asId(askedAddress());
  return id && isKept(id) ? id : null;
}

let step = 0;
let skipping = 0;

export function loadDraft() {
  step = history.state?.step ?? 0;
  const id = draftAtAddress();
  if (askedAddress() && !id) {
    showDraft(null);
    markNotHere();
    history.replaceState({ step }, '');
    return;
  }
  const opening = id ?? lastVisitedId() ?? newDraftId();
  showDraft(opening);
  rememberVisit(opening);
  history.replaceState({ id: opening, step }, '', addressOf(opening));
}

const caretWhereLeft = new Map();

function feed(id, { at = 0, focus = true, path, name } = {}) {
  caretWhereLeft.set(openId, textarea.selectionStart);
  pendingStyle = null;
  stopStyling();
  markHistory.length = 0;
  deletedAt = -1;
  showDraft(id, { path, name });
  rememberVisit(id);
  if (focus) textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(at, at);
  redrawMirror();
  countTotals();
  scheduleUpdate('follow', true);
}

export function openDraft(id, options) {
  saveNow();
  feed(id, options);
  step += 1;
  history.pushState({ id, step }, '', addressOf(id));
}

function showGone() {
  feed(null);
  markNotHere();
}

function skipPast(direction) {
  if (direction < 0 && step === 0) return showGone();
  skipping = setTimeout(showGone, SKIP_WAIT);
  history.go(direction);
}

export function returnTo(state) {
  clearTimeout(skipping);
  saveNow();
  const direction = Math.sign((state?.step ?? step) - step);
  step = state?.step ?? step;
  const id = draftAtAddress() ?? (askedAddress() ? null : state?.id);
  if (id) {
    feed(id, { at: caretWhereLeft.get(id) });
    history.replaceState({ id, step }, '', addressOf(id));
  } else if (askedAddress() && direction) {
    skipPast(direction);
  } else if (askedAddress()) {
    showGone();
    history.replaceState({ step }, '');
  } else {
    history.replaceState({ id: openId, step }, '', addressOf(openId));
  }
}

export function startNewDraft(filing) {
  openDraft(newDraftId(), filing);
}

function markRuns() {
  const runs = [];
  marks.forEach((marked, i) => {
    const mark = marked & STYLES;
    if (!mark) return;
    const last = runs.at(-1);
    if (last?.[1] === i && last[2] === mark) last[1]++;
    else runs.push([i, i + 1, mark]);
  });
  return runs;
}

const markHistory = [];
let deletedAt = -1;

export function rememberMarksBeforeDeleting() {
  const text = textarea.value;
  const from = lineStartBefore(text, textarea.selectionStart);
  const to = lineEndAfter(text, textarea.selectionEnd) + 1;
  if (!marks.subarray(from, to).some(Boolean)) return;
  markHistory.push({ text, runs: markRuns() });
  if (markHistory.length > MARK_HISTORY_SIZE) markHistory.shift();
}

let pendingSave = 0;

function saveSoon() {
  pendingSave ||= setTimeout(saveNote, SAVE_INTERVAL);
}

export function saveNow() {
  if (pendingSave) saveNote();
}

function saveNote() {
  clearTimeout(pendingSave);
  pendingSave = 0;
  const saved = writeDraft(openId, { path: openPath, name: openName, text: textarea.value, marks: markRuns() });
  if (saved) setOpenDraft(openId, { path: openPath, name: saved });
  const addressed = location.hash === `#${openId}`;
  if (!!saved === addressed) return;
  history.replaceState(history.state, '', addressOf(openId));
  if (saved) rememberVisit(openId);
}

function shiftMarksWithText() {
  const text = textarea.value;
  const untouchedAfterCursor = Math.min(markedText.length, text.length - textarea.selectionEnd);
  let sameAtEnd = 0;
  while (sameAtEnd < untouchedAfterCursor && markedText.at(-1 - sameAtEnd) === text.at(-1 - sameAtEnd)) sameAtEnd++;
  let same = 0;
  while (same < markedText.length - sameAtEnd && same < text.length - sameAtEnd && markedText[same] === text[same]) same++;
  const shifted = new Uint8Array(text.length);
  shifted.set(marks.subarray(0, same));
  shifted.set(marks.subarray(markedText.length - sameAtEnd), text.length - sameAtEnd);
  marks = shifted;
  markedText = text;
}

function marked(node, mark) {
  return MARK_TAGS.reduce((inner, [bit, tag, className]) => {
    if (!(mark & bit)) return inner;
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.append(inner);
    return element;
  }, node);
}

const LINE_PIECES = /-+|={3,}|[+|]/g;

function dashesFormRule(text, from, to) {
  while (text[from - 1] === '-') from--;
  while (text[to] === '-') to++;
  return to - from >= 3 || text[from - 1] === '+' || text[to] === '+';
}

function characterInColumn(text, lineStart, column) {
  return lineStart + column < lineEndAfter(text, lineStart) ? text[lineStart + column] : '';
}

function jointArms(text, i) {
  const lineStart = lineStartBefore(text, i);
  const column = i - lineStart;
  const left = i > lineStart && text[i - 1] === '-';
  const right = text[i + 1] === '-';
  if (!left && !right) return '';
  const nextLineStart = lineEndAfter(text, i) + 1;
  const above = lineStart ? characterInColumn(text, lineStartBefore(text, lineStart - 1), column) : '';
  const below = nextLineStart <= text.length ? characterInColumn(text, nextLineStart, column) : '';
  const joins = (neighbour) => neighbour === '+' || neighbour === '|';
  return ['joint', left && 'left', right && 'right', joins(above) && 'up', joins(below) && 'down'].filter(Boolean).join(' ');
}

function lineClassOf(text, piece, at) {
  if (piece[0] === '=') return 'double-rule';
  if (piece[0] === '-') return dashesFormRule(text, at, at + piece.length) ? 'rule' : '';
  if (piece === '|') return 'joint up down';
  return jointArms(text, at);
}

function withLines(text, offset) {
  if (!/[-=+|]/.test(text)) return text;
  const pieces = document.createDocumentFragment();
  let end = 0;
  for (const { 0: piece, index } of text.matchAll(LINE_PIECES)) {
    const className = lineClassOf(textarea.value, piece, offset + index);
    if (!className) continue;
    const line = document.createElement('span');
    line.className = className;
    line.textContent = piece;
    pieces.append(text.slice(end, index), line);
    end = index + piece.length;
  }
  pieces.append(text.slice(end));
  return pieces;
}

export function withMarks(text, offset) {
  const pieces = [];
  for (let i = 0, j; i < text.length; i = j) {
    const at = offset + i;
    for (j = i + 1; j < text.length && marks[offset + j] === marks[at]; j++);
    pieces.push(marked(withLines(text.slice(i, j), at), marks[at]));
  }
  return pieces;
}

function mirrorLine(line, offset, isLast) {
  const span = document.createElement('span');
  for (const part of line.split(/([ \t])/)) {
    if (part) span.append(...(WHITESPACE_CLASS[part] ? [marked(whitespaceMark(part), marks[offset])] : withMarks(part, offset)));
    offset += part.length;
  }
  if (!isLast) span.append(whitespaceMark('\n'));
  return span;
}

export function updateMirror() {
  const lines = textarea.value.split('\n');
  let same = 0;
  while (same < lines.length && same < mirroredLines.length && lines[same] === mirroredLines[same]) same++;
  const start = Math.max(0, same - 1); // the line before a change gains or loses its line break, and box joints look at both neighbours
  let sameAtEnd = 0;
  while (sameAtEnd < lines.length - start && sameAtEnd < mirroredLines.length - start
    && lines[lines.length - 1 - sameAtEnd] === mirroredLines[mirroredLines.length - 1 - sameAtEnd]) sameAtEnd++;
  sameAtEnd = Math.max(0, sameAtEnd - 1);
  for (let i = start; i < mirroredLines.length - sameAtEnd; i++) mirror.children[start].remove();
  let offset = lines.slice(0, start).reduce((length, line) => length + line.length + 1, 0);
  const fresh = lines.slice(start, lines.length - sameAtEnd).map((line, i) => {
    const span = mirrorLine(line, offset, start + i === lines.length - 1);
    offset += line.length + 1;
    return span;
  });
  (mirror.children[start] ?? mirrorEnd).before(...fresh);
  mirroredLines = lines;
}

function redrawMirror() {
  mirroredLines = [];
  mirror.replaceChildren(mirrorEnd);
  updateMirror();
}

function applyMark(from, to, mark, adding) {
  const text = textarea.value;
  for (let i = from; i < to; i++) marks[i] = adding ? marks[i] | mark : marks[i] & ~mark;
  for (let line = lineBreaksBefore(text, from), last = lineBreaksBefore(text, to); line <= last; line++) mirroredLines[line] = null;
  updateMirror();
  saveSoon();
}

function clearStyles() {
  const text = textarea.value;
  const { selectionStart: from, selectionEnd } = textarea;
  if (from !== selectionEnd) return applyMark(from, selectionEnd, STYLES, false);
  if (from >= text.length || text[from] === '\n') return;
  const to = from + String.fromCodePoint(text.codePointAt(from)).length;
  applyMark(from, to, STYLES, false);
  textarea.setSelectionRange(to, to);
  scheduleUpdate('follow');
}

function isLineCentred() {
  const text = textarea.value;
  const cursor = textarea.selectionEnd;
  const start = lineStartBefore(text, cursor);
  const line = text.slice(start, lineEndAfter(text, cursor));
  const indent = line.length - line.replace(/^ +/, '').length;
  const length = codePointCount(line.slice(indent).trimEnd());
  return length > 0 && cursor <= start + indent && length + indent <= charactersPerRow
    && indent === Math.floor((charactersPerRow - length) / 2);
}

function lineReachesMargin() {
  const text = textarea.value;
  const cursor = textarea.selectionEnd;
  const lineEnd = lineEndAfter(text, cursor);
  const line = text.slice(lineStartBefore(text, cursor), lineEnd);
  return !line.includes('\t') && codePointCount(line.trimEnd()) === charactersPerRow && (!overtype || cursor === lineEnd);
}

function reachedPageTop(inputType) {
  if (inputType !== 'insertLineBreak' && inputType !== 'deleteContentBackward') return false;
  const cursor = textarea.selectionStart;
  if (textarea.value[cursor - 1] !== '\n') return false;
  const row = rowOf(cursor);
  return row > 0 && row % ROWS_PER_PAGE === 0;
}

const AFTER_SENTENCE = /[.!?…]['"”’)\]]*\s+$/u;
const SENTENCE_ENDING = /[.!?…]['"”’)\]]*\s*$/u;

function reachedSentenceOrParagraph(inputType, textBefore) {
  const text = textarea.value;
  const cursor = textarea.selectionStart;
  if (inputType === 'deleteWordBackward' || inputType === 'deleteContentBackward') {
    return cursor === 0 || text[cursor - 1] === '\n' || AFTER_SENTENCE.test(text.slice(lineStartBefore(text, cursor), cursor));
  }
  if (inputType === 'deleteWordForward' || inputType === 'deleteContentForward') {
    const deleted = textBefore.slice(cursor, cursor + textBefore.length - text.length);
    return cursor === text.length || text[cursor] === '\n' || SENTENCE_ENDING.test(deleted);
  }
  return false;
}

let streak = null;
let pendingStyle = null;
let stylingWith = null;
let overtype = false;
const caret = document.querySelector('.caret');
caret.toggleAttribute('data-insert', !overtype);
const MOVES = /^(Arrow|Home|End|Page|Tab)/;

export function toggleOvertype() {
  overtype = !overtype;
  caret.toggleAttribute('data-insert', !overtype);
  placeCaret();
}

// Overtype: the letter under the caret is selected just before the key types, so typing replaces it.
export function selectLetterToOvertype(key) {
  const text = textarea.value;
  const { selectionStart: cursor, selectionEnd } = textarea;
  if (!overtype || STYLE_KEYS[key] || cursor !== selectionEnd || cursor >= text.length || text[cursor] === '\n') return;
  textarea.setSelectionRange(cursor, cursor + String.fromCodePoint(text.codePointAt(cursor)).length);
  textarea.toggleAttribute('data-overtyping', true);
}

textarea.addEventListener('keyup', () => textarea.removeAttribute('data-overtyping'));

function showStyle(mark, deciding = false) {
  if (mark) caret.dataset.style = STYLE_NAMES[mark];
  else delete caret.dataset.style;
  caret.toggleAttribute('data-deciding', deciding);
  placeCaret();
}

function letterFollows(cursor) {
  return /\S/.test(textarea.value[cursor] ?? '');
}

function styleLetter(mark) {
  const { selectionStart: cursor, selectionEnd } = textarea;
  const text = textarea.value;
  const letter = String.fromCodePoint(text.codePointAt(cursor) ?? 10);
  if (cursor !== selectionEnd || cursor >= text.length || letter === '\n') return;
  const continued = streak?.end === cursor && streak.mark === mark ? streak : null;
  const adding = continued ? continued.adding : !(marks[cursor] & mark);
  streak = { mark, end: cursor + letter.length, adding };
  applyMark(cursor, streak.end, mark, adding);
  textarea.setSelectionRange(streak.end, streak.end);
  scheduleUpdate('follow');
}

function stopStyling() {
  stylingWith = null;
  streak = null;
  showStyle(null);
}

function keepPendingAsText() {
  const { at } = pendingStyle;
  pendingStyle = null;
  applyMark(at, at + 1, PENDING, false);
  showStyle(null);
}

function confirmPendingStyle(letters, keepStyling) {
  const { mark, at } = pendingStyle;
  pendingStyle = null;
  textarea.setSelectionRange(at, at + 1);
  document.execCommand('delete');
  stoppedAt = 0;
  for (let n = 0; n < letters; n++) styleLetter(mark);
  stylingWith = keepStyling ? mark : null;
  showStyle(stylingWith);
}

textarea.addEventListener('beforeinput', (event) => {
  const { selectionStart: cursor, selectionEnd } = textarea;
  const startsDeleting = event.inputType.startsWith('delete') && cursor !== deletedAt;
  if (startsDeleting || (cursor !== selectionEnd && !event.inputType.startsWith('history'))) rememberMarksBeforeDeleting();
  const typed = event.inputType === 'insertText' && cursor === selectionEnd ? event.data : null;
  const mark = STYLE_KEYS[typed];
  if (stylingWith) {
    if (mark) {
      event.preventDefault();
      stylingWith = mark;
      showStyle(mark);
      styleLetter(mark);
      return;
    }
    stopStyling();
  }
  if (pendingStyle) {
    if (mark === pendingStyle.mark && cursor === pendingStyle.at + 1) {
      event.preventDefault();
      queueMicrotask(() => confirmPendingStyle(1, true));
      return;
    }
    keepPendingAsText();
  }
  streak = null;
  if (mark && letterFollows(cursor)) pendingStyle = { mark, at: cursor };
});

textarea.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape' && (pendingStyle || stylingWith)) {
    event.preventDefault();
    event.stopPropagation();
    if (pendingStyle) confirmPendingStyle(0, false);
    else stopStyling();
  } else if (pendingStyle && MOVES.test(event.key)) {
    keepPendingAsText();
  } else if (event.key === ' ' && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    if (pendingStyle) keepPendingAsText();
    stopStyling();
    clearStyles();
  }
});

textarea.addEventListener('pointerdown', () => {
  if (pendingStyle) keepPendingAsText();
  if (stylingWith) stopStyling();
});

export let stoppedAt = 0;
let copied = null;
let pastedMarks = null;

function rememberCopiedMarks() {
  const { selectionStart: from, selectionEnd: to } = textarea;
  copied = { text: textarea.value.slice(from, to), marks: marks.slice(from, to).map((mark) => mark & STYLES) };
}

textarea.addEventListener('dragstart', (event) => event.preventDefault());
textarea.addEventListener('copy', rememberCopiedMarks);
textarea.addEventListener('cut', rememberCopiedMarks);
textarea.addEventListener('paste', (event) => {
  pastedMarks = copied?.text === event.clipboardData.getData('text/plain') ? copied.marks : null;
});

textarea.addEventListener('input', (event) => {
  textarea.removeAttribute('data-overtyping');
  const textBefore = markedText;
  const restored = event.inputType.startsWith('history') && markHistory.findLast(({ text }) => text === textarea.value);
  if (restored) {
    setMarks(restored.runs);
    redrawMirror();
  } else {
    shiftMarksWithText();
    if (event.inputType === 'insertFromPaste' && pastedMarks) {
      marks.set(pastedMarks, textarea.selectionEnd - pastedMarks.length);
      redrawMirror();
    } else {
      updateMirror();
    }
  }
  pastedMarks = null;
  if (pendingStyle && !(marks[pendingStyle.at] & PENDING)) {
    applyMark(pendingStyle.at, pendingStyle.at + 1, PENDING, true);
    showStyle(pendingStyle.mark, true);
  }
  deletedAt = event.inputType.startsWith('delete') ? textarea.selectionStart : -1;
  stoppedAt = isLineCentred() || lineReachesMargin() || reachedPageTop(event.inputType) || reachedSentenceOrParagraph(event.inputType, textBefore) ? event.timeStamp : 0;
  saveSoon();
  scheduleUpdate('follow', true);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && pendingSave) saveNote();
});

export function reloadOpenDraft() {
  pendingStyle = null;
  stopStyling();
  const { selectionStart, selectionEnd } = textarea;
  showDraft(openId);
  textarea.setSelectionRange(selectionStart, selectionEnd);
  redrawMirror();
  scheduleUpdate(null, true);
}

addEventListener('storage', (event) => {
  if (event.key !== draftKey(openId)) return;
  if (event.newValue === null) showGone();
  else reloadOpenDraft();
});

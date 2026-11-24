import { textarea, isReading, lineHeightOf, cursorPosition, lineStartBefore, lineEndAfter, measureCharactersPerRow, rowOf, rowStart } from './layout.js';
import { scheduleUpdate, tabToNextStop, countTotals, showCounts } from './paper.js';
import { loadNote, updateMirror, stoppedAt, toggleOvertype, selectLetterToOvertype } from './note.js';
import { sheetSpacing, showReading, showWriting } from './pages.js';
import { saveAsTextFile, openTextFile } from './files.js';

const CURSOR_KEYS = /^(Arrow|Home|End)/;
const STOP_PAUSE = 1000;
const STOP_KEYS = ['Backspace', 'Delete', 'Enter'];

function moveCursorTo(position, extendSelection = false) {
  const anchor = textarea.selectionDirection === 'backward' ? textarea.selectionEnd : textarea.selectionStart;
  if (extendSelection) {
    textarea.setSelectionRange(Math.min(anchor, position), Math.max(anchor, position), position < anchor ? 'backward' : 'forward');
  } else {
    textarea.setSelectionRange(position, position);
  }
}

function paragraphStart(forward) {
  const text = textarea.value;
  const cursor = cursorPosition();
  if (forward) return Math.min(lineEndAfter(text, cursor) + 1, text.length);
  return lineStartBefore(text, lineStartBefore(text, cursor) === cursor ? cursor - 1 : cursor);
}

const SPACE_WITHIN_LINE = /[^\S\n]/;

function wordStart(forward) {
  const text = textarea.value;
  let i = cursorPosition();
  if (forward) {
    if (text[i] === '\n') return i + 1;
    while (i < text.length && /\S/.test(text[i])) i++;
    while (i < text.length && SPACE_WITHIN_LINE.test(text[i])) i++;
  } else {
    if (text[i - 1] === '\n') return i - 1;
    while (i > 0 && SPACE_WITHIN_LINE.test(text[i - 1])) i--;
    while (i > 0 && /\S/.test(text[i - 1])) i--;
  }
  return i;
}

// A row that wraps at a space ends on that space: right after it is the same position as the next row's start.
function endOfWrappedRow() {
  const text = textarea.value;
  const cursor = cursorPosition();
  const nextRowStart = rowStart(rowOf(cursor) + 1);
  const wrapsAtSpace = nextRowStart > cursor && nextRowStart < lineEndAfter(text, cursor) && text[nextRowStart - 1] === ' ';
  return wrapsAtSpace ? nextRowStart - 1 : -1;
}

const CTRL_JUMPS = {
  ArrowLeft: () => wordStart(false),
  ArrowRight: () => wordStart(true),
  ArrowUp: () => paragraphStart(false),
  ArrowDown: () => paragraphStart(true),
};

loadNote();
history.scrollRestoration = 'manual';
textarea.setSelectionRange(0, 0);
measureCharactersPerRow();
updateMirror();
countTotals();
showCounts();

let cursorKeyPressed = false;
document.addEventListener('selectionchange', () => {
  if (isReading()) return;
  scheduleUpdate(cursorKeyPressed ? 'follow' : null);
});
addEventListener('keyup', () => { cursorKeyPressed = false; });

addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveAsTextFile();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openTextFile();
  } else if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault();
    const lineHeight = lineHeightOf(textarea);
    const page = isReading() ? sheetSpacing().pitch : Math.floor(innerHeight / lineHeight) * lineHeight;
    scrollBy(0, event.key === 'PageDown' ? page : -page);
  } else if (CTRL_JUMPS[event.key] && event.ctrlKey && !event.altKey && !event.metaKey && !isReading()) {
    event.preventDefault();
    cursorKeyPressed = true;
    moveCursorTo(CTRL_JUMPS[event.key](), event.shiftKey);
  } else if (event.key === 'End' && !event.ctrlKey && !event.altKey && !event.metaKey && !isReading()) {
    const rowEnd = endOfWrappedRow();
    cursorKeyPressed = true;
    if (rowEnd < 0) return;
    event.preventDefault();
    moveCursorTo(rowEnd, event.shiftKey);
  } else if (event.key === 'Escape' && isReading() && !getSelection().isCollapsed) {
    getSelection().removeAllRanges();
  } else if (event.key === 'Escape' && !isReading() && textarea.selectionStart !== textarea.selectionEnd) {
    const cursor = cursorPosition();
    textarea.setSelectionRange(cursor, cursor);
    scheduleUpdate('settle');
  } else if (isReading()) {
    if (event.key === 'Escape') showWriting();
  } else if (event.key === 'Escape') {
    showReading();
  } else if (event.key === 'Insert' && plain) {
    event.preventDefault();
    toggleOvertype();
  } else if (event.repeat && ((event.key.length === 1 && !event.ctrlKey && !event.metaKey) || STOP_KEYS.includes(event.key))
    && event.timeStamp - stoppedAt < STOP_PAUSE) {
    event.preventDefault();
  } else if (event.key === 'Tab' && plain) {
    event.preventDefault();
    tabToNextStop();
  } else {
    cursorKeyPressed = CURSOR_KEYS.test(event.key);
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) selectLetterToOvertype(event.key);
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

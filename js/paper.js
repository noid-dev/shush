import { textarea, paper, isReading, lineHeightOf, cursorPosition, lineStartBefore, codePointCount, countMatches, lineBreaksBefore, characterWidth, charactersPerRow, measureCharactersPerRow, measureStrokes, rowOf, rowStart, offsetInRow, rowLeft } from './layout.js';

const CARET_THICKNESS = 1.75;
const PAPER_FEED = { duration: 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const CARRIAGE_RETURN = { duration: 160, easing: 'cubic-bezier(0.3, 0, 0.1, 1)' };
const MAX_FED_ROWS = 2;
const SWIPE_PAUSE = 150;
const TAB_STOPS = [5, 10, 15, 20, 25, 31, 35, 40, 45, 50, 55, 60];
const WORD = /\S*[\p{L}\p{N}]\S*/gu;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const caret = document.querySelector('.caret');
const counts = document.querySelector('footer');
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

let caretLeft = 0;
let carriageX = 0;

export function placeCaret(carriageMoves = false) {
  caret.hidden = textarea.selectionStart !== textarea.selectionEnd && !textarea.hasAttribute('data-overtyping');
  if (caret.hidden) return;
  const pixel = 1 / devicePixelRatio;
  const thickness = Math.max(1, Math.round(CARET_THICKNESS / pixel)) * pixel;
  const strikePoint = textarea.selectionStart - (caret.hasAttribute('data-deciding') ? 1 : 0);
  const between = caret.hasAttribute('data-insert') && !caret.dataset.style;
  carriageX = rowLeft() + offsetInRow(strikePoint);
  const left = Math.round((between ? carriageX - thickness / 2 : carriageX) / pixel) * pixel;
  caret.style.width = `${between ? thickness : Math.round(characterWidth / pixel) * pixel}px`;
  caret.style.setProperty('--thickness', `${thickness}px`);
  caret.style.left = `${left}px`;
  if (carriageMoves && left !== caretLeft && !reducedMotion.matches) {
    caret.animate([{ translate: `${caretLeft - left}px 0` }, { translate: '0 0' }], CARRIAGE_RETURN);
  }
  caretLeft = left;
}

const TABLE_GAP = / {2}\S/;

function columnsOfLineAbove(text, lineStart) {
  if (!lineStart) return [];
  const above = text.slice(lineStartBefore(text, lineStart - 1), lineStart - 1);
  if (above.includes('\t') || codePointCount(above) > charactersPerRow || !TABLE_GAP.test(above)) return [];
  const columns = [];
  let column = 0;
  let gap = 0;
  for (const char of above) {
    if (char === ' ') {
      gap++;
    } else {
      if (gap >= 2 || (gap && TAB_STOPS.includes(column))) columns.push(column);
      gap = 0;
    }
    column++;
  }
  return columns;
}

export function tabToNextStop() {
  const text = textarea.value;
  const cursor = textarea.selectionStart;
  const lineStart = lineStartBefore(text, cursor);
  const column = Math.round(offsetInRow(cursor) / characterWidth);
  const onFirstRow = column === codePointCount(text.slice(lineStart, cursor));
  const stop = (onFirstRow && columnsOfLineAbove(text, lineStart).find((start) => start > column))
    || TAB_STOPS.find((stop) => stop > column) || charactersPerRow;
  const spaces = Math.max(1, stop - column);
  let over = 0;
  while (over < spaces && text[cursor + over] === ' ') over++;
  textarea.setSelectionRange(cursor + over, cursor + over);
  if (spaces > over) document.execCommand('insertText', false, ' '.repeat(spaces - over));
  else scheduleUpdate('follow');
}

const typingLine = () => parseFloat(getComputedStyle(paper).getPropertyValue('--typing-line'));

const paperShift = () => parseFloat(getComputedStyle(paper).translate.split(' ')[1]) || 0;
export const paperTextTop = () => textarea.getBoundingClientRect().top - paperShift();

let paperFeed = null;
let ownScrollY = null;

export function rememberOwnScroll() {
  ownScrollY = scrollY;
}

function feedPaper(from, lineHeight) {
  paperFeed?.cancel();
  if (Math.abs(from) > MAX_FED_ROWS * lineHeight || reducedMotion.matches) return;
  paperFeed = paper.animate([{ translate: `0 ${from}px` }, { translate: '0 0' }], PAPER_FEED);
}

function pinCursorToTypingLine() {
  const lineHeight = lineHeightOf(textarea);
  const row = rowOf(cursorPosition());
  const shift = paperShift();
  const offset = textarea.getBoundingClientRect().top - shift + row * lineHeight - typingLine();
  if (!offset) return row;
  scrollBy(0, offset);
  rememberOwnScroll();
  feedPaper(shift + offset, lineHeight);
  return row;
}

const carriage = { x: 0, at: -1 };

function rollCursorToTypingLine() {
  if (textarea.selectionStart !== textarea.selectionEnd) return;
  const cursor = cursorPosition();
  const lineHeight = lineHeightOf(textarea);
  const { top, bottom } = textarea.getBoundingClientRect();
  const y = Math.min(Math.max(typingLine() + paperShift(), top), bottom - lineHeight) + lineHeight / 2;
  const row = Math.floor((y - top) / lineHeight);
  if (row === rowOf(cursor)) return;
  if (carriage.at !== cursor) carriage.x = carriageX + characterWidth / 4;
  const point = document.caretPositionFromPoint?.(carriage.x, y);
  if (point?.offsetNode !== textarea) return;
  const pointRow = rowOf(point.offset);
  carriage.at = pointRow > row ? point.offset - 1 : pointRow < row ? rowStart(row) : point.offset;
  textarea.setSelectionRange(carriage.at, carriage.at);
}

let totals = { characters: 0, words: 0 };

export function countTotals() {
  const text = textarea.value;
  totals = { characters: codePointCount(text), words: countMatches(WORD, text) };
}

export function showCounts() {
  const text = textarea.value;
  const cursor = cursorPosition();
  const characters = plural(totals.characters, 'char');
  const words = plural(totals.words, 'word');
  const selection = text.slice(textarea.selectionStart, textarea.selectionEnd);
  const selected = codePointCount(selection);
  const column = codePointCount(text.slice(lineStartBefore(text, cursor), cursor)) + 1;
  counts.dataset.counts = [
    `Ln ${lineBreaksBefore(text, cursor) + 1}, Col ${column}`,
    selected ? `${selected.toLocaleString()} of ${characters}` : characters,
    selected ? `${countMatches(WORD, selection).toLocaleString()} of ${words}` : words,
  ].join('\n');
}

const PAPER_MOTIONS = ['knob', 'settle', 'follow'];
let pendingFrame = 0;
let textChanged = false;
let paperMotion = null;
let typingRow = 0;

function updateAfterChanges() {
  const [typed, motion] = [textChanged, paperMotion];
  pendingFrame = 0;
  textChanged = false;
  paperMotion = null;
  if (typed) countTotals();
  if (isReading()) return;
  if (motion === 'knob' || motion === 'settle') rollCursorToTypingLine();
  let carriageMoves = false;
  if (motion === 'follow' || motion === 'settle') {
    const row = pinCursorToTypingLine();
    carriageMoves = typed && Math.abs(row - typingRow) === 1;
    typingRow = row;
  }
  placeCaret(carriageMoves);
  showCounts();
}

export function scheduleUpdate(motion, typed = false) {
  textChanged ||= typed;
  if (PAPER_MOTIONS.indexOf(motion) > PAPER_MOTIONS.indexOf(paperMotion)) paperMotion = motion;
  pendingFrame ||= requestAnimationFrame(updateAfterChanges);
}

function remeasure() {
  measureCharactersPerRow();
  measureStrokes();
  scheduleUpdate('follow');
}

document.fonts.ready.then(remeasure);
addEventListener('resize', remeasure);

const showsRolling = 'onscrollend' in window;

addEventListener('scroll', () => {
  if (isReading() || scrollY === ownScrollY) return;
  document.body.classList.toggle('rolling', showsRolling);
  scheduleUpdate('knob');
});

addEventListener('scrollend', () => {
  if (!document.body.classList.contains('rolling')) return;
  document.body.classList.remove('rolling');
  if (textarea.selectionStart === textarea.selectionEnd) scheduleUpdate('settle');
});

let swipe = { at: -Infinity };
let sliding = 0;

addEventListener('wheel', (event) => {
  if (isReading() || textarea.selectionStart !== textarea.selectionEnd) return;
  if (event.timeStamp - swipe.at > SWIPE_PAUSE) swipe = { sideways: Math.abs(event.deltaX) > Math.abs(event.deltaY), travel: 0 };
  swipe.at = event.timeStamp;
  if (!swipe.sideways) return;
  event.preventDefault();
  document.body.classList.add('sliding');
  clearTimeout(sliding);
  sliding = setTimeout(() => document.body.classList.remove('sliding'), SWIPE_PAUSE);
  swipe.travel += event.deltaMode ? event.deltaX * characterWidth : event.deltaX;
  const columns = Math.trunc(swipe.travel / characterWidth);
  if (!columns) return;
  swipe.travel -= columns * characterWidth;
  const position = Math.min(Math.max(0, textarea.selectionStart + columns), textarea.value.length);
  textarea.setSelectionRange(position, position);
  scheduleUpdate('follow');
}, { passive: false });

addEventListener('mousedown', (event) => {
  if (!isReading() && event.target !== textarea) event.preventDefault();
});

textarea.addEventListener('pointerup', () => {
  if (textarea.selectionStart === textarea.selectionEnd) scheduleUpdate('follow');
});

// Firefox scrolls the textarea itself to show the cursor; the text must stay fixed to the paper.
textarea.addEventListener('scroll', () => { textarea.scrollTop = 0; });

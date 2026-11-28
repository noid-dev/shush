import { textarea, isReading, lineHeightOf, rowLocator, ROWS_PER_PAGE } from './layout.js';
import { paperTextTop, rememberOwnScroll, scheduleUpdate } from './paper.js';
import { withMarks } from './note.js';

const sheets = document.querySelector('article');

function splitIntoPages(text) {
  const startOfRow = rowLocator();
  const pages = [];
  for (let start = 0, row = ROWS_PER_PAGE; start < text.length || !pages.length; row += ROWS_PER_PAGE) {
    const end = Math.max(startOfRow(row), start + 1);
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}

export function sheetSpacing() {
  const [first, second] = sheets.children;
  const { top, height } = first.getBoundingClientRect();
  const pitch = second ? second.getBoundingClientRect().top - top : height;
  return { pitch, overhead: pitch - ROWS_PER_PAGE * lineHeightOf(first) };
}

function sheetTextTop() {
  const first = sheets.firstElementChild;
  return first.getBoundingClientRect().top + parseFloat(getComputedStyle(first).paddingTop);
}

let lastSwitch = null;

function cutSheets() {
  let offset = 0;
  sheets.replaceChildren(...splitIntoPages(textarea.value).map((page) => {
    const sheet = document.createElement('section');
    sheet.append(...withMarks(page, offset));
    offset += page.length;
    return sheet;
  }));
}

export function recutSheets() {
  const reading = scrollY;
  document.body.classList.remove('reading');
  cutSheets();
  document.body.classList.add('reading');
  scrollTo(0, reading);
}

export function showReading() {
  const lineHeight = lineHeightOf(textarea);
  const textTop = paperTextTop();
  const topPage = Math.floor(Math.max(0, -textTop / lineHeight) / ROWS_PER_PAGE);
  cutSheets();
  const writingScroll = scrollY;
  document.body.classList.add('reading');
  scrollBy(0, sheetTextTop() - textTop + topPage * sheetSpacing().overhead);
  lastSwitch = { readingScroll: scrollY, writingScroll };
}

export function showWriting() {
  const { pitch, overhead } = sheetSpacing();
  const topPage = Math.max(0, Math.floor(-sheets.getBoundingClientRect().top / pitch));
  const readingTextTop = sheetTextTop();
  const returning = lastSwitch?.readingScroll === scrollY;
  document.body.classList.remove('reading');
  textarea.focus({ preventScroll: true });
  if (returning) scrollTo(0, lastSwitch.writingScroll);
  else scrollBy(0, paperTextTop() - readingTextTop - topPage * overhead);
  rememberOwnScroll();
  scheduleUpdate('settle');
}

function copyWithoutSheetBreaks(event) {
  if (!isReading() || !getSelection().rangeCount) return;
  const selected = getSelection().getRangeAt(0).cloneRange();
  const allSheets = document.createRange();
  allSheets.selectNodeContents(sheets);
  if (selected.compareBoundaryPoints(Range.START_TO_START, allSheets) < 0) selected.setStart(allSheets.startContainer, allSheets.startOffset);
  if (selected.compareBoundaryPoints(Range.END_TO_END, allSheets) > 0) selected.setEnd(allSheets.endContainer, allSheets.endOffset);
  event.clipboardData.setData('text/plain', selected.toString());
  event.preventDefault();
}

document.addEventListener('copy', copyWithoutSheetBreaks);

let printedFromWriting = false;
addEventListener('beforeprint', () => {
  printedFromWriting = !isReading();
  if (printedFromWriting) showReading();
});
addEventListener('afterprint', () => {
  if (printedFromWriting) showWriting();
});

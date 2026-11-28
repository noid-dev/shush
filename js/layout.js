const REST_OF_WORD = /(\S*)[ \t]?/y;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
// Ends measured text: it keeps a final empty line without taking any room.
export const ZERO_WIDTH_SPACE = '\u200B';

export const textarea = document.querySelector('textarea');
export const paper = textarea.parentElement;
export const mirror = document.querySelector('.mirror');
const ruler = document.querySelector('.ruler');

export const ROWS_PER_PAGE = Number(getComputedStyle(document.documentElement).getPropertyValue('--sheet-rows'));
export const isReading = () => document.body.classList.contains('reading');
export const isFinding = () => document.body.classList.contains('finding');
export const lineHeightOf = (element) => parseFloat(getComputedStyle(element).lineHeight);
export const cursorPosition = () => (textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd);
export const lineStartBefore = (text, i) => (i ? text.lastIndexOf('\n', i - 1) + 1 : 0);
export const lineEndAfter = (text, i) => (text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i));
export const rowLeft = () => ruler.getBoundingClientRect().left;

export function countMatches(pattern, text) {
  let n = 0;
  for (pattern.lastIndex = 0; pattern.test(text);) n++;
  return n;
}

export const codePointCount = (text) => text.length - countMatches(SURROGATE_PAIR, text);

export function lineBreaksBefore(text, i) {
  let n = 0;
  for (let at = text.indexOf('\n'); at >= 0 && at < i; at = text.indexOf('\n', at + 1)) n++;
  return n;
}

function measuredHeight(text) {
  ruler.textContent = text;
  return ruler.offsetHeight;
}

const CHARACTER_SAMPLE = '0'.repeat(10);
export let charactersPerRow = 62;
export let characterWidth = 0;

export function measureCharactersPerRow() {
  ruler.textContent = CHARACTER_SAMPLE;
  const sample = document.createRange();
  sample.selectNodeContents(ruler);
  const width = sample.getBoundingClientRect().width / CHARACTER_SAMPLE.length;
  if (!width) return;
  characterWidth = width;
  charactersPerRow = Math.floor(ruler.getBoundingClientRect().width / characterWidth);
}

const SAMPLE_SIZE = 100;

// Strokes are whole device pixels, so every line on the sheet looks equally thick wherever it falls.
function strokesOf(weight) {
  const { fontFamily, fontSize } = getComputedStyle(textarea);
  const context = document.createElement('canvas').getContext('2d');
  context.font = `${weight} ${SAMPLE_SIZE}px ${fontFamily}`;
  const em = (pixels) => `${pixels / SAMPLE_SIZE}em`;
  const stroke = (pixels) => {
    const devicePixels = Math.max(1, Math.round((pixels / SAMPLE_SIZE) * parseFloat(fontSize) * devicePixelRatio));
    return `${devicePixels / devicePixelRatio / parseFloat(fontSize)}em`;
  };
  const dash = context.measureText('-');
  const equals = context.measureText('=');
  const bar = context.measureText('|');
  return {
    'dash-top': em(dash.fontBoundingBoxAscent - dash.actualBoundingBoxAscent),
    'dash-thickness': stroke(dash.actualBoundingBoxAscent + dash.actualBoundingBoxDescent),
    'equals-top': em(equals.fontBoundingBoxAscent - equals.actualBoundingBoxAscent),
    'equals-height': stroke(equals.actualBoundingBoxAscent + equals.actualBoundingBoxDescent),
    'bar-width': stroke(bar.actualBoundingBoxLeft + bar.actualBoundingBoxRight),
  };
}

export function measureStrokes() {
  for (const [weight, prefix] of [['normal', ''], ['bold', 'bold-']]) {
    for (const [name, size] of Object.entries(strokesOf(weight))) document.documentElement.style.setProperty(`--${prefix}${name}`, size);
  }
}

// A word wraps as a whole, so measuring up to a point inside or before a word needs the rest of it.
// A word longer than a row breaks anywhere instead, so its rest doesn't matter.
function restOfWord(text, i) {
  REST_OF_WORD.lastIndex = i;
  const [rest, word] = REST_OF_WORD.exec(text);
  return word.length < charactersPerRow - 2 ? rest : '';
}

function firstRowOfLine(line, textTop, lineHeight) {
  if (!line) return 0;
  const previousBreak = mirror.children[line - 1].lastChild;
  return Math.round((previousBreak.getBoundingClientRect().top - textTop) / lineHeight) + 1;
}

const rowWithinLine = (text, start, i, lineHeight) =>
  Math.round(measuredHeight(text.slice(start, i) + restOfWord(text, i) + ZERO_WIDTH_SPACE) / lineHeight) - 1;

export function rowOf(i) {
  const text = textarea.value;
  const lineHeight = lineHeightOf(textarea);
  const start = lineStartBefore(text, i);
  const firstRow = firstRowOfLine(lineBreaksBefore(text, start), textarea.getBoundingClientRect().top, lineHeight);
  return firstRow + rowWithinLine(text, start, i, lineHeight);
}

export function rowStart(row) {
  const text = textarea.value;
  const lineHeight = lineHeightOf(textarea);
  const textTop = textarea.getBoundingClientRect().top;
  let line = 0;
  for (let low = 1, high = mirror.children.length - 1; low <= high;) {
    const middle = (low + high) >> 1;
    if (firstRowOfLine(middle, textTop, lineHeight) <= row) [line, low] = [middle, middle + 1];
    else high = middle - 1;
  }
  const rowInLine = row - firstRowOfLine(line, textTop, lineHeight);
  let start = 0;
  for (let n = 0; n < line; n++) start = text.indexOf('\n', start) + 1;
  let low = start, high = lineEndAfter(text, start);
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rowWithinLine(text, start, middle, lineHeight) < rowInLine) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Reads row starts off the laid-out mirror instead of measuring in the ruler, so the page lays out once.
export function rowLocator() {
  const text = textarea.value;
  const lineHeight = lineHeightOf(textarea);
  const textTop = textarea.getBoundingClientRect().top;
  const nodes = [];
  const starts = [];
  const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(), at = 0; node; node = walker.nextNode()) {
    nodes.push(node);
    starts.push(at);
    at += node.length;
  }
  const range = document.createRange();
  const rowAt = (i) => {
    let n = 0;
    for (let low = 0, high = nodes.length - 1; low <= high;) {
      const middle = (low + high) >> 1;
      if (starts[middle] <= i) [n, low] = [middle, middle + 1];
      else high = middle - 1;
    }
    const mark = nodes[n].parentElement;
    let box;
    if (mark.localName === 'i') {
      box = mark.getBoundingClientRect();
    } else {
      const offset = i - starts[n];
      range.setStart(nodes[n], offset);
      range.setEnd(nodes[n], Math.min(offset + 1, nodes[n].length));
      box = range.getBoundingClientRect();
    }
    return Math.floor((box.top - textTop) / lineHeight + 0.25);
  };
  return (row) => {
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rowAt(middle) < row) low = middle + 1;
      else high = middle;
    }
    const code = text.charCodeAt(low);
    return code >= 0xdc00 && code <= 0xdfff ? low - 1 : low;
  };
}

const caretProbe = document.createElement('span');

export function offsetInRow(cursor) {
  const text = textarea.value;
  const start = lineStartBefore(text, cursor);
  const [next = '\n'] = [...text.slice(cursor, cursor + 2)];
  const atLineEnd = next === '\n';
  caretProbe.textContent = atLineEnd ? ZERO_WIDTH_SPACE : next;
  ruler.replaceChildren(text.slice(start, cursor), caretProbe, atLineEnd ? '' : restOfWord(text, cursor + next.length));
  return caretProbe.getBoundingClientRect().left - ruler.getBoundingClientRect().left;
}

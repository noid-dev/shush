import { textarea, isReading } from './layout.js';
import { showWriting } from './pages.js';
import { rememberMarksBeforeDeleting } from './note.js';

const MAX_FILE_SIZE = 2 ** 20;

function fileTimestamp(time) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(time.getFullYear() % 100)}${pad(time.getMonth() + 1)}${pad(time.getDate())}-${pad(time.getHours())}${pad(time.getMinutes())}`;
}

export function saveAsTextFile() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([textarea.value], { type: 'text/plain;charset=utf-8' }));
  link.download = `shush-${fileTimestamp(new Date())}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}

// Replaces the note with a dropped text file's contents, typed the browser's way so Ctrl+Z undoes it.
async function restoreFromFile(file) {
  if ((file.type && !file.type.startsWith('text/')) || file.size > MAX_FILE_SIZE) return;
  const text = await file.text();
  if (isReading()) showWriting();
  textarea.focus();
  textarea.select();
  rememberMarksBeforeDeleting();
  document.execCommand('insertText', false, text);
}

export function openTextFile() {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.txt,.md,text/plain';
  picker.addEventListener('change', () => restoreFromFile(picker.files[0]));
  picker.click();
}

addEventListener('dragover', (event) => event.preventDefault());
addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  event.preventDefault();
  restoreFromFile(file);
});

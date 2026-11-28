import { textarea, isReading } from './layout.js';
import { showWriting } from './pages.js';
import { startNewDraft } from './note.js';
import { openPath, openName, DEFAULT_NAME } from './drafts.js';

const MAX_FILE_SIZE = 2 ** 20;
const MAX_NAME_LENGTH = 80;

function fileName() {
  const name = [...openPath, openName].join(' - ')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[. ]+$/, '');
  return `${name || DEFAULT_NAME}.txt`;
}

export function saveAsTextFile() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([textarea.value], { type: 'text/plain;charset=utf-8' }));
  link.download = fileName();
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}

// Typed the browser's way so Ctrl+Z undoes it.
async function openAsNewDraft(file) {
  if ((file.type && !file.type.startsWith('text/')) || file.size > MAX_FILE_SIZE) return;
  const text = await file.text();
  if (isReading()) showWriting();
  startNewDraft({ name: file.name.replace(/\.[^.]*$/, '') || DEFAULT_NAME });
  document.execCommand('insertText', false, text);
}

export function openTextFile() {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.txt,.md,text/plain';
  picker.addEventListener('change', () => openAsNewDraft(picker.files[0]));
  picker.click();
}

addEventListener('dragover', (event) => event.preventDefault());
addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  event.preventDefault();
  openAsNewDraft(file);
});

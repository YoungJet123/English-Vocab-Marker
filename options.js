/* options.js — 设置页交互 */

import { parseFile } from './parsers.js';

const THEMES = [
  { id: 'highlight',        name: '整块高亮' },
  { id: 'underline',        name: '细下划线' },
  { id: 'nativeUnderline',  name: '原生下划线' },
  { id: 'nativeDashed',     name: '虚线下划线' },
  { id: 'nativeDotted',     name: '点状下划线' },
  { id: 'wavy',             name: '波浪线' },
  { id: 'thinDashed',       name: '细虚线底' },
  { id: 'dotted',           name: '点状底' },
  { id: 'dashed',           name: '粗虚线底' },
  { id: 'marker',           name: '荧光笔' },
  { id: 'marker2',          name: '马克笔' },
  { id: 'solidBorder',      name: '实线方框' },
  { id: 'dashedBorder',     name: '虚线方框' },
  { id: 'bold',             name: '加粗变色' }
];

const PRESET_COLORS = ['#ffe066', '#e5f9f3', '#ff8b94'];

const DEFAULT_SHORTCUTS = {
  mastered: { alt: true, shift: false, ctrl: false, meta: false, key: 'click' },
  wordbook: { alt: true, shift: false, ctrl: false, meta: false, key: 'n' }
};

const DEFAULTS = {
  enabled: true,
  theme: 'highlight',
  color: '#ffe066',
  activeVocab: 'cet6',
  shortcuts: DEFAULT_SHORTCUTS
};

const $ = (id) => document.getElementById(id);

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function applyPreview(theme, color) {
  document.documentElement.style.setProperty('--ielts-mark-color', color);
  const rgb = hexToRgb(color);
  if (rgb) {
    document.documentElement.style.setProperty('--ielts-mark-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }
  $('preview').querySelectorAll('.ielts-mark').forEach(el => {
    [...el.classList].forEach(c => {
      if (c.startsWith('ielts-mark-theme-')) el.classList.remove(c);
    });
    el.classList.add('ielts-mark-theme-' + theme);
  });
}

function showSaved() {
  const el = $('saveStatus');
  el.classList.add('show');
  clearTimeout(showSaved._t);
  showSaved._t = setTimeout(() => el.classList.remove('show'), 1200);
}

async function save(patch) {
  await chrome.storage.sync.set(patch);
  showSaved();
}

/* ---------------- themes ---------------- */

function renderThemeList(current) {
  const el = $('themeList');
  el.innerHTML = '';
  for (const t of THEMES) {
    const label = document.createElement('label');
    label.className = 'row';
    label.innerHTML = `
      <input type="radio" name="theme" value="${t.id}" ${t.id === current ? 'checked' : ''} />
      <span class="preview-text">
        <span class="ielts-mark ielts-mark-theme-${t.id}">${t.name}</span>
      </span>
    `;
    el.appendChild(label);
  }
}

/* ---------------- color presets ---------------- */

function renderSwatches(current) {
  const wrap = $('swatches');
  wrap.innerHTML = '';
  for (const c of PRESET_COLORS) {
    const s = document.createElement('span');
    s.className = 'swatch' + (c.toLowerCase() === (current || '').toLowerCase() ? ' active' : '');
    s.style.background = c;
    s.title = c;
    s.dataset.color = c;
    s.addEventListener('click', () => {
      $('color').value = c;
      $('colorText').textContent = c;
      applyPreview(currentTheme(), c);
      save({ color: c });
      renderSwatches(c);
    });
    wrap.appendChild(s);
  }
}

function currentTheme() {
  const r = document.querySelector('input[name="theme"]:checked');
  return r ? r.value : DEFAULTS.theme;
}

/* ---------------- vocab management ---------------- */

async function getVocabIndex() {
  const { vocabIndex = [] } = await chrome.storage.local.get('vocabIndex');
  return vocabIndex;
}

async function setVocabIndex(list) {
  await chrome.storage.local.set({ vocabIndex: list });
}

async function renderVocabList() {
  const list = await getVocabIndex();
  const { activeVocab = DEFAULTS.activeVocab } = await chrome.storage.sync.get('activeVocab');
  const container = $('vocabList');
  container.innerHTML = '';
  if (list.length === 0) {
    container.innerHTML = '<div class="mastered-stat">暂无词表，导入一个吧。</div>';
    return;
  }
  for (const meta of list) {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    const checked = meta.id === activeVocab ? 'checked' : '';
    const badge = meta.builtin ? '<span class="badge">内置</span>' : '';
    row.innerHTML = `
      <input type="radio" name="vocabRadio" value="${meta.id}" ${checked} />
      <span class="name">${escapeHTML(meta.name)} ${badge}</span>
      <span class="count">${meta.count} 词</span>
      <button data-action="export" data-id="${meta.id}">导出</button>
      ${meta.builtin ? '' : `<button data-action="delete" data-id="${meta.id}" class="danger">删除</button>`}
    `;
    container.appendChild(row);
  }
  container.querySelectorAll('input[name="vocabRadio"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) save({ activeVocab: r.value });
    });
  });
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'export') exportVocab(id);
      if (action === 'delete') deleteVocab(id);
    });
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function exportVocab(id) {
  const key = 'vocab:' + id;
  const got = await chrome.storage.local.get(key);
  const data = got[key] || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function deleteVocab(id) {
  const list = await getVocabIndex();
  const meta = list.find(v => v.id === id);
  if (!meta || meta.builtin) return;
  if (!confirm(`删除词表「${meta.name}」？此操作不可撤销。`)) return;
  const next = list.filter(v => v.id !== id);
  await chrome.storage.local.remove('vocab:' + id);
  await setVocabIndex(next);
  const { activeVocab } = await chrome.storage.sync.get('activeVocab');
  if (activeVocab === id && next.length > 0) {
    await save({ activeVocab: next[0].id });
  }
  await renderVocabList();
}

/* ---------------- import ---------------- */

function slugify(name) {
  return (name || 'custom').toLowerCase()
    .replace(/[^\w一-鿿]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom';
}

async function uniqueId(base) {
  const list = await getVocabIndex();
  const ids = new Set(list.map(v => v.id));
  let id = 'u_' + base;
  let n = 1;
  while (ids.has(id)) { id = 'u_' + base + '_' + (++n); }
  return id;
}

async function importFile(file) {
  const status = $('importStatus');
  status.textContent = `正在解析 ${file.name}…`;
  status.style.color = '#666';
  try {
    const data = await parseFile(file);
    const count = Object.keys(data).length;
    if (count === 0) {
      status.textContent = '解析结果为空，请检查文件格式。';
      status.style.color = '#c00';
      return;
    }
    const defaultName = file.name.replace(/\.[^.]+$/, '');
    const name = prompt(`解析到 ${count} 个单词。请为该词表命名：`, defaultName);
    if (!name) { status.textContent = '已取消。'; return; }
    const id = await uniqueId(slugify(defaultName));
    const list = await getVocabIndex();
    list.push({ id, name: name.trim(), count, builtin: false });
    await chrome.storage.local.set({ ['vocab:' + id]: data, vocabIndex: list });
    status.textContent = `导入成功：${name}（${count} 词）。`;
    status.style.color = '#28a745';
    await renderVocabList();
  } catch (e) {
    console.error(e);
    status.textContent = '导入失败：' + (e.message || String(e));
    status.style.color = '#c00';
  }
}

/* ---------------- mastered ---------------- */

async function renderMastered() {
  const { mastered = {} } = await chrome.storage.local.get('mastered');
  $('masteredCount').textContent = String(Object.keys(mastered).length);
}

async function clearMastered() {
  const { mastered = {} } = await chrome.storage.local.get('mastered');
  const n = Object.keys(mastered).length;
  if (n === 0) return;
  if (!confirm(`确认清空 ${n} 个已掌握的单词？它们会重新在页面上被标注。`)) return;
  await chrome.storage.local.set({ mastered: {} });
  await renderMastered();
}

/* ---------------- wordbook ---------------- */

async function renderWordbook() {
  const { wordbook = [] } = await chrome.storage.local.get('wordbook');
  $('wordbookCount').textContent = String(wordbook.length);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

async function exportWordbook() {
  const { wordbook = [] } = await chrome.storage.local.get('wordbook');
  if (wordbook.length === 0) {
    alert('生词本为空。');
    return;
  }
  const sorted = [...wordbook].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  const lines = [
    `# 生词本（${today()} 导出，共 ${sorted.length} 个）`,
    ''
  ];
  for (const it of sorted) {
    const def = (it.def || '').trim() || '（无释义）';
    lines.push(`- **${it.word}** — ${def}`);
  }
  const md = lines.join('\n') + '\n';
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wordbook-${today()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearWordbook() {
  const { wordbook = [] } = await chrome.storage.local.get('wordbook');
  if (wordbook.length === 0) return;
  if (!confirm(`确认清空 ${wordbook.length} 个生词？此操作不可撤销。`)) return;
  await chrome.storage.local.set({ wordbook: [] });
  await renderWordbook();
}

/* ---------------- shortcuts ---------------- */

function renderShortcuts(shortcuts) {
  document.querySelectorAll('.shortcut-row').forEach(row => {
    const id = row.dataset.sc;
    const sc = shortcuts[id] || DEFAULT_SHORTCUTS[id];
    row.querySelectorAll('input[data-mod]').forEach(cb => {
      cb.checked = !!sc[cb.dataset.mod];
    });
    const sel = row.querySelector('select[data-key]');
    const input = row.querySelector('input[data-keyinput]');
    if (sel) {
      if (sc.key === 'click' && sel.querySelector('option[value="click"]')) {
        sel.value = 'click';
        input.value = '';
        input.disabled = true;
      } else {
        sel.value = '';
        input.disabled = false;
        input.value = sc.key === 'click' ? '' : (sc.key || '');
      }
    }
    updateShortcutPreview(row);
  });
}

function readShortcutFromRow(row) {
  const sc = { alt: false, shift: false, ctrl: false, meta: false, key: '' };
  row.querySelectorAll('input[data-mod]').forEach(cb => { sc[cb.dataset.mod] = cb.checked; });
  const sel = row.querySelector('select[data-key]');
  const input = row.querySelector('input[data-keyinput]');
  if (sel && sel.value === 'click') sc.key = 'click';
  else sc.key = (input.value || '').trim().toLowerCase().slice(0, 1);
  return sc;
}

function shortcutDisplay(sc) {
  const keys = [];
  if (sc.ctrl) keys.push('Ctrl');
  if (sc.alt) keys.push('Alt/Option');
  if (sc.shift) keys.push('Shift');
  if (sc.meta) keys.push('Cmd/Win');
  keys.push(sc.key === 'click' ? '点击' : (sc.key ? sc.key.toUpperCase() : '?'));
  return keys.join(' + ');
}

function updateShortcutPreview(row) {
  const sc = readShortcutFromRow(row);
  const p = row.querySelector('.preview');
  if (p) p.textContent = shortcutDisplay(sc);
}

async function saveShortcuts() {
  const shortcuts = {};
  document.querySelectorAll('.shortcut-row').forEach(row => {
    shortcuts[row.dataset.sc] = readShortcutFromRow(row);
  });
  // 校验：wordbook 的 key 必须存在且非 click
  if (!shortcuts.wordbook.key || shortcuts.wordbook.key === 'click') {
    return; // 不保存非法状态
  }
  await save({ shortcuts });
}

function bindShortcutEvents() {
  document.querySelectorAll('.shortcut-row').forEach(row => {
    row.querySelectorAll('input[data-mod]').forEach(cb => {
      cb.addEventListener('change', () => { updateShortcutPreview(row); saveShortcuts(); });
    });
    const sel = row.querySelector('select[data-key]');
    const input = row.querySelector('input[data-keyinput]');
    if (sel) {
      sel.addEventListener('change', () => {
        const useClick = sel.value === 'click';
        input.disabled = useClick;
        if (useClick) input.value = '';
        updateShortcutPreview(row);
        saveShortcuts();
      });
    }
    if (input) {
      input.addEventListener('input', () => {
        // 只保留 a-z 0-9
        input.value = (input.value.match(/[A-Za-z0-9]/) || [''])[0].toLowerCase();
        updateShortcutPreview(row);
        saveShortcuts();
      });
    }
  });
}

/* ---------------- init ---------------- */

async function init() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $('enabled').checked = !!s.enabled;
  $('color').value = s.color;
  $('colorText').textContent = s.color;
  renderThemeList(s.theme);
  renderSwatches(s.color);
  applyPreview(s.theme, s.color);
  renderShortcuts(s.shortcuts || DEFAULT_SHORTCUTS);
  bindShortcutEvents();
  await renderVocabList();
  await renderMastered();
  await renderWordbook();

  $('enabled').addEventListener('change', () => save({ enabled: $('enabled').checked }));

  $('color').addEventListener('input', () => {
    $('colorText').textContent = $('color').value;
    applyPreview(currentTheme(), $('color').value);
    renderSwatches($('color').value);
  });
  $('color').addEventListener('change', () => save({ color: $('color').value }));

  $('themeList').addEventListener('change', e => {
    if (e.target.name === 'theme') {
      applyPreview(e.target.value, $('color').value);
      save({ theme: e.target.value });
    }
  });

  const importArea = $('importArea');
  const importFileEl = $('importFile');
  importArea.addEventListener('click', () => importFileEl.click());
  importFileEl.addEventListener('change', () => {
    const f = importFileEl.files && importFileEl.files[0];
    if (f) importFile(f);
    importFileEl.value = '';
  });
  ['dragenter', 'dragover'].forEach(ev => {
    importArea.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      importArea.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    importArea.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      importArea.classList.remove('dragover');
    });
  });
  importArea.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  $('clearMastered').addEventListener('click', clearMastered);
  $('exportWordbook').addEventListener('click', exportWordbook);
  $('clearWordbook').addEventListener('click', clearWordbook);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.mastered) renderMastered();
      if (changes.wordbook) renderWordbook();
      if (changes.vocabIndex) renderVocabList();
    }
    if (area === 'sync' && changes.activeVocab) renderVocabList();
  });
}

init();

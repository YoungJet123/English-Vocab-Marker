/* 爱听写词汇标注 — background service worker */

const BUILTIN_VOCABS = [
  { id: 'cet6',        name: '大学英语六级',   file: 'vocab/cet6.json' },
  { id: 'cet4',        name: '大学英语四级',   file: 'vocab/cet4.json' },
  { id: 'highschool',  name: '高中词汇',       file: 'vocab/highschool.json' }
];

const DEFAULT_SETTINGS = {
  enabled: true,
  theme: 'highlight',
  color: '#ffe066',
  activeVocab: 'cet6',
  shortcuts: {
    mastered: { alt: true, shift: false, ctrl: false, meta: false, key: 'click' },
    wordbook: { alt: true, shift: false, ctrl: false, meta: false, key: 'n' }
  }
};

async function loadBuiltinVocab(file) {
  const url = chrome.runtime.getURL(file);
  const res = await fetch(url);
  return res.json();
}

async function ensureBuiltinVocabs() {
  const { vocabIndex = [] } = await chrome.storage.local.get('vocabIndex');
  const existingIds = new Set(vocabIndex.map(v => v.id));
  const toWrite = {};
  const newIndex = [...vocabIndex];

  for (const meta of BUILTIN_VOCABS) {
    if (existingIds.has(meta.id)) continue;
    try {
      const data = await loadBuiltinVocab(meta.file);
      const count = Object.keys(data).length;
      toWrite['vocab:' + meta.id] = data;
      newIndex.push({ id: meta.id, name: meta.name, count, builtin: true });
    } catch (e) {
      console.warn('[ielts-mark] failed to load builtin vocab', meta.id, e);
    }
  }

  toWrite.vocabIndex = newIndex;
  if (Object.keys(toWrite).length > 0) {
    await chrome.storage.local.set(toWrite);
  }
}

async function ensureSettings() {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (current[k] === undefined) toSet[k] = DEFAULT_SETTINGS[k];
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
}

/* ---------------- Youdao lookup ---------------- */
// 使用 suggest 接口（无需 key）。返回中文释义。同一词只查一次并缓存到 storage.local。

async function youdaoLookup(word) {
  const lower = word.toLowerCase();
  const cacheKey = 'trCache:' + lower;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];

  const url = 'https://dict.youdao.com/suggest?q='
    + encodeURIComponent(word) + '&num=1&doctype=json&le=eng';
  let def = '';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const entries = data && data.data && data.data.entries;
      if (entries && entries.length) {
        def = entries[0].explain || entries[0].title || '';
      }
    }
  } catch (e) {
    console.warn('[ielts-mark] youdao lookup failed', word, e);
  }

  // 若 suggest 没结果，退回到 dict 接口
  if (!def) {
    try {
      const url2 = 'https://dict.youdao.com/jsonapi?q=' + encodeURIComponent(word);
      const res2 = await fetch(url2, { cache: 'no-store' });
      if (res2.ok) {
        const j = await res2.json();
        const ec = j && j.ec && j.ec.word && j.ec.word[0];
        if (ec && ec.trs && ec.trs.length) {
          def = ec.trs.map(t => {
            if (typeof t === 'string') return t;
            if (t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i) {
              return t.tr[0].l.i.join(' ');
            }
            return '';
          }).filter(Boolean).join('；');
        }
      }
    } catch (e) {
      console.warn('[ielts-mark] youdao dict fallback failed', word, e);
    }
  }

  if (def) {
    await chrome.storage.local.set({ [cacheKey]: def });
  }
  return def;
}

/* ---------------- message router ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'LOOKUP') {
    youdaoLookup(msg.word).then(def => sendResponse({ def }));
    return true; // async
  }
  if (msg.type === 'ADD_TO_WORDBOOK') {
    addToWordbook(msg.word, msg.def).then(res => sendResponse(res));
    return true;
  }
});

async function addToWordbook(word, def) {
  const lower = (word || '').toLowerCase().trim();
  if (!lower) return { ok: false, reason: 'empty' };
  const { wordbook = [] } = await chrome.storage.local.get('wordbook');
  const exists = wordbook.find(w => w.word === lower);
  if (exists) {
    if (def && !exists.def) {
      exists.def = def;
      await chrome.storage.local.set({ wordbook });
    }
    return { ok: true, duplicate: true, total: wordbook.length };
  }
  wordbook.push({ word: lower, def: def || '', addedAt: Date.now() });
  await chrome.storage.local.set({ wordbook });
  return { ok: true, total: wordbook.length };
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSettings();
  await ensureBuiltinVocabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureBuiltinVocabs();
});

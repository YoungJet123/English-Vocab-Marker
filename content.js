/* ==========================================================================
   爱听写词汇标注 — content script
   ========================================================================== */

(() => {
  'use strict';

  const MARK_CLASS = 'ielts-mark';
  const THEME_PREFIX = 'ielts-mark-theme-';
  const DATA_WORD = 'data-ielts-word';
  const DATA_DEF = 'data-ielts-def';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'SVG',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'CODE', 'PRE',
    'OPTION', 'LABEL'
  ]);

  const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

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

  let settings = { ...DEFAULTS };
  let vocab = new Map();
  let mastered = new Set();
  let observer = null;
  let scheduled = false;
  let markCount = 0;

  /* ---------------- storage ---------------- */

  function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(DEFAULTS, res => {
        // shortcuts 兼容默认
        if (!res.shortcuts || typeof res.shortcuts !== 'object') {
          res.shortcuts = DEFAULT_SHORTCUTS;
        } else {
          res.shortcuts = { ...DEFAULT_SHORTCUTS, ...res.shortcuts };
        }
        resolve(res);
      });
    });
  }

  async function loadVocab() {
    const key = 'vocab:' + settings.activeVocab;
    const got = await chrome.storage.local.get(key);
    const data = got[key];
    vocab = new Map();
    if (data && typeof data === 'object') {
      for (const w of Object.keys(data)) vocab.set(w.toLowerCase(), data[w] || '');
    }
  }

  async function loadMastered() {
    const { mastered: m = {} } = await chrome.storage.local.get('mastered');
    mastered = new Set(Object.keys(m));
  }

  async function saveMastered() {
    const obj = {};
    for (const w of mastered) obj[w] = 1;
    await chrome.storage.local.set({ mastered: obj });
  }

  /* ---------------- lemmatizer ---------------- */

  function lookupLemma(lower) {
    if (vocab.has(lower)) return lower;
    const rules = [
      { suf: 'ies',  repl: 'y'  },
      { suf: 'ied',  repl: 'y'  },
      { suf: 'iest', repl: 'y'  },
      { suf: 'ier',  repl: 'y'  },
      { suf: 'sses', repl: 'ss' },
      { suf: 'ing',  repl: ''   },
      { suf: 'ed',   repl: ''   },
      { suf: 'es',   repl: ''   },
      { suf: 's',    repl: ''   }
    ];
    for (const { suf, repl } of rules) {
      if (lower.endsWith(suf) && lower.length > suf.length + 2) {
        const base = lower.slice(0, -suf.length) + repl;
        if (vocab.has(base)) return base;
        if ((suf === 'ing' || suf === 'ed') && base.length >= 3) {
          const last = base[base.length - 1];
          const prev = base[base.length - 2];
          if (last === prev) {
            const dedup = base.slice(0, -1);
            if (vocab.has(dedup)) return dedup;
          }
          const withE = base + 'e';
          if (vocab.has(withE)) return withE;
        }
      }
    }
    return null;
  }

  /* ---------------- DOM scanning ---------------- */

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(
      root, NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          let el = parent;
          while (el && el !== root) {
            if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
            if (el.classList && el.classList.contains(MARK_CLASS)) return NodeFilter.FILTER_REJECT;
            if (el.isContentEditable) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          if (!/[A-Za-z]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function shortcutDisplay(sc) {
    const keys = [];
    if (sc.ctrl) keys.push('Ctrl');
    if (sc.alt) keys.push('Alt/Option');
    if (sc.shift) keys.push('Shift');
    if (sc.meta) keys.push('Cmd/Win');
    keys.push(sc.key === 'click' ? '点击' : sc.key.toUpperCase());
    return keys.join(' + ');
  }

  function annotateTextNode(textNode) {
    const text = textNode.nodeValue;
    const matches = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text)) !== null) {
      const lower = m[0].toLowerCase();
      const lemma = lookupLemma(lower);
      if (lemma && !mastered.has(lemma)) {
        matches.push({ start: m.index, end: m.index + m[0].length, lemma });
      }
    }
    if (matches.length === 0) return 0;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    const themeClass = THEME_PREFIX + settings.theme;
    const scDisp = shortcutDisplay(settings.shortcuts.mastered);
    for (const hit of matches) {
      if (hit.start > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
      }
      const span = document.createElement('span');
      span.className = MARK_CLASS + ' ' + themeClass;
      span.setAttribute(DATA_WORD, hit.lemma);
      const def = vocab.get(hit.lemma) || '';
      if (def) {
        span.setAttribute(DATA_DEF, def);
        span.title = hit.lemma + ' — ' + def + '\n\n' + scDisp + ' 标记为已掌握';
      } else {
        span.title = hit.lemma + '\n\n' + scDisp + ' 标记为已掌握';
      }
      span.textContent = text.slice(hit.start, hit.end);
      frag.appendChild(span);
      cursor = hit.end;
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode.replaceChild(frag, textNode);
    return matches.length;
  }

  function annotateRoot(root) {
    if (!vocab || vocab.size === 0) return;
    if (!root || !root.isConnected) return;
    const textNodes = collectTextNodes(root);
    let added = 0;
    for (const tn of textNodes) {
      if (!tn.isConnected) continue;
      added += annotateTextNode(tn);
    }
    markCount += added;
    document.documentElement.setAttribute('data-ielts-mark-count', String(markCount));
  }

  function removeAllAnnotations() {
    document.querySelectorAll('.' + MARK_CLASS).forEach(node => {
      const text = document.createTextNode(node.textContent);
      node.parentNode.replaceChild(text, node);
    });
    markCount = 0;
    document.documentElement.setAttribute('data-ielts-mark-count', '0');
  }

  function unwrapByLemma(lemma) {
    const nodes = document.querySelectorAll(
      '.' + MARK_CLASS + '[' + DATA_WORD + '="' + lemma + '"]'
    );
    nodes.forEach(node => {
      const text = document.createTextNode(node.textContent);
      const parent = node.parentNode;
      parent.replaceChild(text, node);
      parent.normalize();
    });
    markCount = Math.max(0, markCount - nodes.length);
    document.documentElement.setAttribute('data-ielts-mark-count', String(markCount));
  }

  function applyThemeColor() {
    document.documentElement.style.setProperty('--ielts-mark-color', settings.color);
    const rgb = hexToRgb(settings.color);
    if (rgb) {
      document.documentElement.style.setProperty(
        '--ielts-mark-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`
      );
    }
  }

  function applyTheme() {
    const themeClass = THEME_PREFIX + settings.theme;
    document.querySelectorAll('.' + MARK_CLASS).forEach(el => {
      [...el.classList].forEach(c => {
        if (c.startsWith(THEME_PREFIX)) el.classList.remove(c);
      });
      el.classList.add(themeClass);
    });
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  /* ---------------- toast ---------------- */

  let toastEl = null;
  function showToast(text, type) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ielts-mark-toast';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.remove('info', 'success', 'warn', 'error');
    toastEl.classList.add(type || 'info', 'show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), 2000);
  }

  /* ---------------- shortcuts ---------------- */

  function modsMatch(e, sc) {
    return !!e.altKey === !!sc.alt
      && !!e.shiftKey === !!sc.shift
      && !!e.ctrlKey === !!sc.ctrl
      && !!e.metaKey === !!sc.meta;
  }

  async function toggleMastered(lemma) {
    if (!lemma) return;
    mastered.add(lemma);
    await saveMastered();
    unwrapByLemma(lemma);
    showToast(`已掌握：${lemma}`, 'success');
  }

  function getSelectedWord() {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(text)) return null;
    return text.toLowerCase();
  }

  // 记录最近一次鼠标位置，用于"悬停 + 快捷键"取词
  const lastMouse = { x: -1, y: -1 };
  document.addEventListener('mousemove', (e) => {
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
  }, { passive: true, capture: true });

  // 取鼠标光标处的英文单词。若光标不在文本上或不在英文词内则返回 null。
  function wordAtPoint(x, y) {
    if (x < 0 || y < 0) return null;
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.setEnd(pos.offsetNode, pos.offset);
      }
    }
    if (!range) return null;
    const node = range.startContainer;
    if (!node || node.nodeType !== 3) return null;
    const text = node.nodeValue || '';
    const offset = range.startOffset;
    const wordChar = /[A-Za-z'-]/;
    let s = offset;
    while (s > 0 && wordChar.test(text[s - 1])) s--;
    let e2 = offset;
    while (e2 < text.length && wordChar.test(text[e2])) e2++;
    if (e2 <= s) return null;
    const word = text.slice(s, e2).replace(/^[-']+|[-']+$/g, '');
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return null;
    return word.toLowerCase();
  }

  // 取当前目标词：优先选区，其次鼠标悬停位置
  function getTargetWord() {
    return getSelectedWord() || wordAtPoint(lastMouse.x, lastMouse.y);
  }

  // 把任意按键配置转成 KeyboardEvent.code 形式，跨平台可靠
  function keyToCode(key) {
    if (!key || key === 'click') return key;
    const k = String(key).toLowerCase();
    if (/^[a-z]$/.test(k)) return 'Key' + k.toUpperCase();
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    return k;
  }

  async function addWordToBook() {
    const word = getTargetWord();
    if (!word) {
      showToast('请将鼠标悬停在一个英文单词上，或先选中它', 'warn');
      return;
    }
    showToast(`查询中：${word}…`, 'info');
    const lemma = lookupLemma(word) || word;
    let def = vocab.get(lemma) || '';
    if (!def) {
      const resp = await chrome.runtime.sendMessage({ type: 'LOOKUP', word: lemma });
      def = (resp && resp.def) || '';
    }
    const r = await chrome.runtime.sendMessage({
      type: 'ADD_TO_WORDBOOK', word: lemma, def
    });
    if (r && r.ok) {
      if (r.duplicate) showToast(`已存在：${lemma}（共 ${r.total} 个）`, 'info');
      else showToast(`已加入生词本：${lemma}（共 ${r.total} 个）`, 'success');
    } else {
      showToast('加入失败', 'error');
    }
  }

  document.addEventListener('click', (e) => {
    const sc = settings.shortcuts.mastered;
    if (sc.key !== 'click') return;
    if (!modsMatch(e, sc)) return;
    const target = e.target.closest && e.target.closest('.' + MARK_CLASS);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    toggleMastered(target.getAttribute(DATA_WORD));
  }, true);

  document.addEventListener('keydown', (e) => {
    const scW = settings.shortcuts.wordbook;
    if (scW.key && scW.key !== 'click' && modsMatch(e, scW)) {
      const wanted = keyToCode(scW.key);
      if (e.code === wanted) {
        e.preventDefault();
        addWordToBook();
        return;
      }
    }
    const scM = settings.shortcuts.mastered;
    if (scM.key && scM.key !== 'click' && modsMatch(e, scM)) {
      const wanted = keyToCode(scM.key);
      if (e.code === wanted) {
        const w = getTargetWord();
        if (w) { e.preventDefault(); toggleMastered(lookupLemma(w) || w); }
      }
    }
  }, true);

  /* ---------------- observer ---------------- */

  function scheduleAnnotate(root) {
    if (scheduled) return;
    scheduled = true;
    const fn = () => { scheduled = false; annotateRoot(root); };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 500 });
    } else setTimeout(fn, 100);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      if (!settings.enabled) return;
      const targets = new Set();
      for (const mut of mutations) {
        if (mut.type !== 'childList') continue;
        mut.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            if (!n.closest('.' + MARK_CLASS)) targets.add(n);
          } else if (n.nodeType === 3 && n.parentElement) {
            if (!n.parentElement.closest('.' + MARK_CLASS)) targets.add(n.parentElement);
          }
        });
      }
      targets.forEach(t => scheduleAnnotate(t));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  /* ---------------- lifecycle ---------------- */

  async function refreshAll() {
    removeAllAnnotations();
    applyThemeColor();
    if (settings.enabled) {
      await loadVocab();
      await loadMastered();
      annotateRoot(document.body);
      startObserver();
    } else stopObserver();
  }

  async function init() {
    settings = await loadSettings();
    applyThemeColor();
    if (!settings.enabled) return;
    await loadVocab();
    await loadMastered();
    annotateRoot(document.body);
    startObserver();
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync') {
      let needRefresh = false;
      let onlyStyle = true;
      for (const k of Object.keys(changes)) {
        if (k in DEFAULTS) {
          settings[k] = changes[k].newValue;
          needRefresh = true;
          if (k !== 'theme' && k !== 'color') onlyStyle = false;
        }
      }
      if (needRefresh) {
        if (onlyStyle) { applyThemeColor(); applyTheme(); }
        else await refreshAll();
      }
    } else if (area === 'local') {
      if (changes.mastered) {
        const oldSet = mastered;
        const newObj = changes.mastered.newValue || {};
        mastered = new Set(Object.keys(newObj));
        for (const w of mastered) if (!oldSet.has(w)) unwrapByLemma(w);
        let removed = false;
        for (const w of oldSet) if (!mastered.has(w)) { removed = true; break; }
        if (removed && settings.enabled) {
          removeAllAnnotations();
          annotateRoot(document.body);
        }
      }
      const vocabKey = 'vocab:' + settings.activeVocab;
      if (changes[vocabKey] && settings.enabled) await refreshAll();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'GET_STATUS') {
      sendResponse({ enabled: settings.enabled, count: markCount });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else init();
})();

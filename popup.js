/* popup.js — 总开关 + 跳转设置 */

const toggleEl = document.getElementById('toggle');
const countEl = document.getElementById('count');
const vocabEl = document.getElementById('vocab');
const openOptionsBtn = document.getElementById('openOptions');

function setToggleUI(on) {
  toggleEl.classList.toggle('on', !!on);
}

async function init() {
  const { enabled = true, activeVocab = 'cet6' } =
    await chrome.storage.sync.get({ enabled: true, activeVocab: 'cet6' });
  setToggleUI(enabled);

  // 显示当前词表名
  const { vocabIndex = [] } = await chrome.storage.local.get('vocabIndex');
  const meta = vocabIndex.find(v => v.id === activeVocab);
  vocabEl.textContent = meta ? `${meta.name} · ${meta.count}` : activeVocab;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https?:/.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, res => {
        if (chrome.runtime.lastError || !res) {
          countEl.textContent = '—';
          return;
        }
        countEl.textContent = String(res.count || 0);
      });
    } else {
      countEl.textContent = '—';
      countEl.style.fontSize = '12px';
    }
  } catch (e) {
    countEl.textContent = '—';
  }
}

toggleEl.addEventListener('click', async () => {
  const { enabled = true } = await chrome.storage.sync.get({ enabled: true });
  const next = !enabled;
  await chrome.storage.sync.set({ enabled: next });
  setToggleUI(next);
});

openOptionsBtn.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

init();

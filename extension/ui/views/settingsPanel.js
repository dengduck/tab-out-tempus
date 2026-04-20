/**
 * ui/views/settingsPanel.js
 * --------------------------
 * ⚙️ 设置面板：只包含 Blacklist（不计时域名）管理。
 *
 * Private Mode 和 Focus Timer 已移到 header 直接操作（M9 redesign）。
 *
 * 数据流：
 *   - 首帧：main.js 传入 blacklist 列表
 *   - 交互：用户输入 → messaging.blacklistAdd / blacklistRemove
 *   - 订阅：BCAST_STATE_CHANGE → updateState() 刷新列表
 *
 * 里程碑：M9。
 */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';
import { LOG_PREFIX } from '../../shared/constants.js';

/** @type {HTMLElement|null} */
let panelEl = null;
/** @type {HTMLElement|null} */
let toggleBtn = null;

/** 当前黑名单 */
let currentBlacklist = [];

// ========== 初始化 ==========

/**
 * @param {{blacklist?: string[]}} initialState
 */
export function init(initialState = {}) {
  toggleBtn = document.getElementById('settingsToggle');
  panelEl = document.getElementById('settingsPanel');
  if (!toggleBtn || !panelEl) return;

  currentBlacklist = initialState.blacklist ?? [];

  toggleBtn.addEventListener('click', () => {
    const isOpen = !panelEl.hidden;
    panelEl.hidden = isOpen;
    toggleBtn.classList.toggle('is-active', !isOpen);
    // 展开时刷新
    if (!isOpen) renderPanel();
  });

  renderPanel();
}

/**
 * BCAST_STATE_CHANGE 回调。
 */
export function updateState(state) {
  if (state.blacklist !== undefined) {
    currentBlacklist = state.blacklist;
  }
  if (!panelEl || panelEl.hidden) return;
  renderPanel();
}

// ========== 渲染 ==========

function renderPanel() {
  if (!panelEl) return;
  panelEl.innerHTML = '';
  panelEl.appendChild(renderBlacklist());
}

function renderBlacklist() {
  const section = h('div', { className: 'sp__section' });

  const header = h('div', { className: 'sp__sectionHeader' });
  header.appendChild(h('span', { className: 'sp__sectionIcon', textContent: '🚫' }));
  header.appendChild(h('span', { className: 'sp__sectionTitle', textContent: '不计时域名' }));
  section.appendChild(header);

  section.appendChild(h('p', { className: 'sp__desc', textContent: '在这些域名上浏览时不记录时间。' }));

  // 添加输入框
  const addRow = h('div', { className: 'sp__actionRow' });
  const input = h('input', {
    className: 'sp__input',
    type: 'text',
    placeholder: '输入域名，如 youtube.com',
  });
  addRow.appendChild(input);

  const addBtn = h('button', { className: 'sp__btn sp__btn--primary', textContent: '添加' });
  const doAdd = async () => {
    const hostname = input.value.trim().toLowerCase();
    if (!hostname) return;
    addBtn.disabled = true;
    try {
      await messaging.blacklistAdd(hostname);
      input.value = '';
    } catch (err) {
      console.error(LOG_PREFIX, 'blacklistAdd failed', err);
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', doAdd);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });
  addRow.appendChild(addBtn);
  section.appendChild(addRow);

  // 当前列表
  const list = currentBlacklist || [];
  if (list.length > 0) {
    const listEl = h('div', { className: 'sp__list' });
    list.forEach((hostname) => {
      const item = h('div', { className: 'sp__listItem' });
      item.appendChild(h('span', { className: 'sp__listHost', textContent: hostname }));
      const removeBtn = h('button', { className: 'sp__listRemove', textContent: '×' });
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        try {
          await messaging.blacklistRemove(hostname);
        } catch (err) {
          console.error(LOG_PREFIX, 'blacklistRemove failed', err);
        }
      });
      item.appendChild(removeBtn);
      listEl.appendChild(item);
    });
    section.appendChild(listEl);
  } else {
    section.appendChild(h('p', { className: 'sp__empty', textContent: '暂无不计时域名' }));
  }

  return section;
}

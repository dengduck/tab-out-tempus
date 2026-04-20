/**
 * ui/views/settingsPanel.js
 * --------------------------
 * ⚙️ 设置面板：Private Mode / Focus Timer / Blacklist 控制。
 *
 * 数据流：
 *   - 首帧：main.js 传入初始 state（privateMode / focusTimer / blacklist）
 *   - 交互：用户点击 → messaging.startPrivateMode / stopPrivateMode / ...
 *   - 订阅：BCAST_STATE_CHANGE → updateState() 刷新面板状态
 *
 * 里程碑：M9。
 */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';
import { LOG_PREFIX } from '../../shared/constants.js';
import { formatDuration } from '../utils/formatDuration.js';

/** @type {HTMLElement|null} */
let panelEl = null;
/** @type {HTMLElement|null} */
let toggleBtn = null;

/** 当前 UI 呈现的状态缓存 */
let currentState = {
  privateMode: null,
  focusTimer: null,
  blacklist: [],
};

// ========== 初始化 ==========

/**
 * 初始化设置面板。
 * @param {{privateMode: any, focusTimer: any, blacklist: string[]}} initialState
 */
export function init(initialState = {}) {
  toggleBtn = document.getElementById('settingsToggle');
  panelEl = document.getElementById('settingsPanel');
  if (!toggleBtn || !panelEl) return;

  currentState = {
    privateMode: initialState.privateMode ?? null,
    focusTimer: initialState.focusTimer ?? null,
    blacklist: initialState.blacklist ?? [],
  };

  toggleBtn.addEventListener('click', () => {
    const isOpen = !panelEl.hidden;
    panelEl.hidden = isOpen;
    toggleBtn.classList.toggle('is-active', !isOpen);
  });

  renderPanel();
}

/**
 * BCAST_STATE_CHANGE 回调——外部调用刷新面板。
 */
export function updateState(state) {
  if (!panelEl || panelEl.hidden) {
    // 面板隐藏时只缓存，不渲染
    if (state.privateMode !== undefined) currentState.privateMode = state.privateMode;
    if (state.focusTimer !== undefined) currentState.focusTimer = state.focusTimer;
    if (state.blacklist !== undefined) currentState.blacklist = state.blacklist;
    return;
  }
  if (state.privateMode !== undefined) currentState.privateMode = state.privateMode;
  if (state.focusTimer !== undefined) currentState.focusTimer = state.focusTimer;
  if (state.blacklist !== undefined) currentState.blacklist = state.blacklist;
  renderPanel();
}

// ========== 整体渲染 ==========

function renderPanel() {
  if (!panelEl) return;
  panelEl.innerHTML = '';

  panelEl.appendChild(renderPrivateMode());
  panelEl.appendChild(renderFocusTimer());
  panelEl.appendChild(renderBlacklist());
}

// ========== Private Mode ==========

function renderPrivateMode() {
  const section = h('div', { className: 'sp__section' });

  const header = h('div', { className: 'sp__sectionHeader' });
  header.appendChild(h('span', { className: 'sp__sectionIcon', textContent: '🔒' }));
  header.appendChild(h('span', { className: 'sp__sectionTitle', textContent: '隐私模式' }));
  section.appendChild(header);

  const desc = h('p', { className: 'sp__desc', textContent: '开启后暂停所有时间记录。' });
  section.appendChild(desc);

  const pm = currentState.privateMode;

  if (pm && pm.active) {
    // 运行中 → 显示剩余时间 + 停止按钮
    const remaining = pm.remainingMs > 0 ? formatDuration(pm.remainingMs) : '即将结束';
    const statusRow = h('div', { className: 'sp__statusRow' });
    statusRow.appendChild(h('span', { className: 'sp__badge sp__badge--active', textContent: `⏸ 剩余 ${remaining}` }));

    const stopBtn = h('button', { className: 'sp__btn sp__btn--danger', textContent: '停止' });
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      try {
        await messaging.stopPrivateMode();
      } catch (err) {
        console.error(LOG_PREFIX, 'stopPrivateMode failed', err);
      }
    });
    statusRow.appendChild(stopBtn);
    section.appendChild(statusRow);
  } else {
    // 未运行 → 显示时长选择 + 开始按钮
    const row = h('div', { className: 'sp__actionRow' });
    const select = h('select', { className: 'sp__select' });
    [5, 15, 30, 60, 120].forEach((min) => {
      const opt = h('option', { value: String(min), textContent: min < 60 ? `${min} 分钟` : `${min / 60} 小时` });
      select.appendChild(opt);
    });
    select.value = '30';
    row.appendChild(select);

    const startBtn = h('button', { className: 'sp__btn sp__btn--primary', textContent: '开启' });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try {
        await messaging.startPrivateMode(Number(select.value));
      } catch (err) {
        console.error(LOG_PREFIX, 'startPrivateMode failed', err);
        startBtn.disabled = false;
      }
    });
    row.appendChild(startBtn);
    section.appendChild(row);
  }

  return section;
}

// ========== Focus Timer ==========

function renderFocusTimer() {
  const section = h('div', { className: 'sp__section' });

  const header = h('div', { className: 'sp__sectionHeader' });
  header.appendChild(h('span', { className: 'sp__sectionIcon', textContent: '🍅' }));
  header.appendChild(h('span', { className: 'sp__sectionTitle', textContent: '专注计时' }));
  section.appendChild(header);

  const desc = h('p', { className: 'sp__desc', textContent: '番茄钟倒计时，帮助保持专注。' });
  section.appendChild(desc);

  const ft = currentState.focusTimer;

  if (ft && ft.active) {
    const remaining = ft.remainingMs > 0 ? formatDuration(ft.remainingMs) : '即将结束';
    const progress = Math.round((ft.progress || 0) * 100);
    const statusRow = h('div', { className: 'sp__statusRow' });

    // 进度条
    const progressBar = h('div', { className: 'sp__progress' });
    const progressFill = h('div', { className: 'sp__progressFill' });
    progressFill.style.width = `${progress}%`;
    progressBar.appendChild(progressFill);
    section.appendChild(progressBar);

    statusRow.appendChild(h('span', { className: 'sp__badge sp__badge--focus', textContent: `🍅 剩余 ${remaining}` }));

    const stopBtn = h('button', { className: 'sp__btn sp__btn--danger', textContent: '停止' });
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      try {
        await messaging.stopFocusTimer();
      } catch (err) {
        console.error(LOG_PREFIX, 'stopFocusTimer failed', err);
      }
    });
    statusRow.appendChild(stopBtn);
    section.appendChild(statusRow);
  } else {
    const row = h('div', { className: 'sp__actionRow' });
    const select = h('select', { className: 'sp__select' });
    [15, 25, 30, 45, 60].forEach((min) => {
      const opt = h('option', { value: String(min), textContent: `${min} 分钟` });
      select.appendChild(opt);
    });
    select.value = '25';
    row.appendChild(select);

    const startBtn = h('button', { className: 'sp__btn sp__btn--primary', textContent: '开始' });
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      try {
        await messaging.startFocusTimer(Number(select.value));
      } catch (err) {
        console.error(LOG_PREFIX, 'startFocusTimer failed', err);
        startBtn.disabled = false;
      }
    });
    row.appendChild(startBtn);
    section.appendChild(row);
  }

  return section;
}

// ========== Blacklist ==========

function renderBlacklist() {
  const section = h('div', { className: 'sp__section' });

  const header = h('div', { className: 'sp__sectionHeader' });
  header.appendChild(h('span', { className: 'sp__sectionIcon', textContent: '🚫' }));
  header.appendChild(h('span', { className: 'sp__sectionTitle', textContent: '不计时域名' }));
  section.appendChild(header);

  const desc = h('p', { className: 'sp__desc', textContent: '在这些域名上浏览时不记录时间。' });
  section.appendChild(desc);

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
  const list = currentState.blacklist || [];
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

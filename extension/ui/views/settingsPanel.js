/**
 * ui/views/settingsPanel.js
 * --------------------------
 * ⚙️ 设置面板：Blacklist（不计时域名）管理 + Idle 阈值设置。
 *
 * Private Mode 和 Focus Timer 已移到 header 直接操作（M9 redesign）。
 *
 * 数据流：
 *   - 首帧：main.js 传入 blacklist 列表
 *   - 交互：用户输入 → messaging.blacklistAdd / blacklistRemove / setIdleThreshold
 *   - 订阅：BCAST_STATE_CHANGE → updateState() 刷新列表
 *
 * 里程碑：M9。
 */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';
import { LOG_PREFIX, IDLE_THRESHOLD_DEFAULT_SEC, IDLE_OPTIONS } from '../../shared/constants.js';
import { renderAdvancedSettings } from './settingsAdvanced.js';

/** @type {HTMLElement|null} */
let panelEl = null;
/** @type {HTMLElement|null} */
let toggleBtn = null;

/** 当前黑名单 */
let currentBlacklist = [];
/** 当前 idle 阈值（秒），0 = 关闭 */
let currentIdleThreshold = IDLE_THRESHOLD_DEFAULT_SEC;
let currentConfig = null;

// ========== 初始化 ==========

/**
 * P1-04：init 改为同步——立即绑定事件并用默认阈值渲染，不再 await 阻塞。
 * 真实 idle 阈值在后台异步拉取，拿到后局部刷新（消除 init 期间的 async 竞态）。
 * @param {{blacklist?: string[]}} initialState
 */
export function init(initialState = {}) {
  toggleBtn = document.getElementById('settingsToggle');
  panelEl = document.getElementById('settingsPanel');
  if (!toggleBtn || !panelEl) return;

  currentBlacklist = initialState.blacklist ?? [];
  currentConfig = initialState.config ?? null;

  toggleBtn.addEventListener('click', () => {
    const isOpen = !panelEl.hidden;
    panelEl.hidden = isOpen;
    toggleBtn.classList.toggle('is-active', !isOpen);
    // 展开时刷新
    if (!isOpen) renderPanel();
  });

  // 先用默认值渲染，保证面板立即可用
  renderPanel();

  // 异步拉真实 idle 阈值，拿到后若有变化再刷新（面板可能尚未展开，无害）
  messaging.getIdleThreshold()
    .then(({ threshold }) => {
      if (typeof threshold === 'number' && threshold !== currentIdleThreshold) {
        currentIdleThreshold = threshold;
        if (panelEl && !panelEl.hidden) renderPanel();
      }
    })
    .catch(() => { /* use default */ });
}

/**
 * BCAST_STATE_CHANGE 回调。
 */
export function updateState(state) {
  if (state.blacklist !== undefined) currentBlacklist = state.blacklist;
  if (state.config !== undefined) currentConfig = state.config;
  if (!panelEl || panelEl.hidden) return;
  renderPanel();
}

// ========== 渲染 ==========

function renderPanel() {
  if (!panelEl) return;
  panelEl.innerHTML = '';
  panelEl.appendChild(renderIdleThreshold());
  panelEl.appendChild(renderBlacklist());
  if (currentConfig) {
    panelEl.appendChild(renderAdvancedSettings(currentConfig, (config) => {
      currentConfig = config;
      if (panelEl && !panelEl.hidden) renderPanel();
    }));
  }
}

// ---------- Idle 阈值 ----------

function renderIdleThreshold() {
  const section = h('div', { className: 'sp__section' });

  const header = h('div', { className: 'sp__sectionHeader' });
  header.appendChild(h('span', { className: 'sp__sectionIcon', textContent: '⏸️' }));
  header.appendChild(h('span', { className: 'sp__sectionTitle', textContent: '空闲检测' }));
  section.appendChild(header);

  section.appendChild(h('p', {
    className: 'sp__desc',
    textContent: '键鼠空闲超过设定时间后自动暂停计时。看视频时自动豁免。',
  }));

  const row = h('div', { className: 'sp__actionRow' });
  const select = h('select', { className: 'sp__select' });

  for (const opt of IDLE_OPTIONS) {
    const option = h('option', { value: String(opt.value), textContent: opt.label });
    if (opt.value === currentIdleThreshold) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  // 如果当前值不在预设列表中（比如用户之前手动设了个 120s），显示自定义
  const isPreset = IDLE_OPTIONS.some((o) => o.value === currentIdleThreshold);
  if (!isPreset && currentIdleThreshold > 0) {
    const custom = h('option', {
      value: String(currentIdleThreshold),
      textContent: `${currentIdleThreshold} 秒（自定义）`,
    });
    custom.selected = true;
    select.appendChild(custom);
  }

  select.addEventListener('change', async () => {
    const newVal = parseInt(select.value, 10);
    if (isNaN(newVal)) return;
    select.disabled = true;
    try {
      const { threshold } = await messaging.setIdleThreshold(newVal);
      currentIdleThreshold = threshold;
    } catch (err) {
      console.error(LOG_PREFIX, 'setIdleThreshold failed', err);
    } finally {
      select.disabled = false;
    }
  });

  row.appendChild(select);
  section.appendChild(row);

  return section;
}

// ---------- Blacklist ----------

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

  const feedback = h('p', { className: 'sp__feedback' });
  const addBtn = h('button', { className: 'sp__btn sp__btn--primary', textContent: '添加' });
  const doAdd = async () => {
    const hostname = input.value.trim();
    if (!hostname) return;
    addBtn.disabled = true;
    feedback.textContent = '';
    try {
      const result = await messaging.blacklistAdd(hostname);
      currentBlacklist = result.list || currentBlacklist;
      input.value = '';
      feedback.textContent = `已添加 ${result.added}`;
    } catch (err) {
      feedback.textContent = `添加失败：${err?.message || err}`;
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
  section.appendChild(feedback);

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
        } finally {
          removeBtn.disabled = false;
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

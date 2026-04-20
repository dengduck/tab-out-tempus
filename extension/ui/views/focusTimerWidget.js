/**
 * ui/views/focusTimerWidget.js
 * ----------------------------
 * Header 上的专注计时快捷按钮。
 *
 * 交互：
 *   - 未激活 → 点击弹出 dropdown 选时长，确认后开始
 *   - 已激活 → 按钮变 active 态，显示精确到秒的剩余时间，点击停止
 *
 * 数据流：
 *   - 首帧：init(state.focusTimer)
 *   - 订阅：BCAST_STATE_CHANGE → update(payload.focusTimer)
 *   - BCAST_TICK → tickUpdate() 刷新剩余时间
 *
 * 里程碑：M9。
 */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';
import { LOG_PREFIX } from '../../shared/constants.js';

const PRESETS = [15, 25, 30, 45, 60];

/** @type {HTMLButtonElement|null} */
let btnEl = null;
/** @type {HTMLSpanElement|null} */
let labelEl = null;
/** @type {HTMLDivElement|null} */
let dropdownEl = null;

/** 缓存当前状态 */
let currentStatus = null;
let dropdownOpen = false;

/**
 * 挂载到 header__right 里已有的按钮。
 * @param {any} initialStatus  getState().focusTimer
 */
export function init(initialStatus) {
  btnEl = document.getElementById('focusTimerToggle');
  if (!btnEl) return;

  // 内部结构：SVG icon + 文字标签 + 倒计时
  btnEl.innerHTML = '';
  const icon = h('span', { className: 'headerWidget__icon' });
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
  const text = h('span', { className: 'headerWidget__text', textContent: '专注计时' });
  labelEl = h('span', { className: 'headerWidget__label' });
  btnEl.appendChild(icon);
  btnEl.appendChild(text);
  btnEl.appendChild(labelEl);

  // dropdown（挂在按钮的父容器上）
  const wrapper = btnEl.parentElement;
  if (wrapper) {
    // 给按钮套一个相对定位容器
    const container = h('div', { className: 'headerWidget__container' });
    wrapper.insertBefore(container, btnEl);
    container.appendChild(btnEl);

    dropdownEl = h('div', { className: 'headerWidget__dropdown' });
    dropdownEl.hidden = true;
    PRESETS.forEach(min => {
      const item = h('button', {
        className: 'headerWidget__dropdownItem',
        textContent: `${min} 分钟`,
      });
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeDropdown();
        btnEl.disabled = true;
        try {
          await messaging.startFocusTimer(min);
        } catch (err) {
          console.error(LOG_PREFIX, 'focusTimerWidget start failed', err);
        } finally {
          btnEl.disabled = false;
        }
      });
      dropdownEl.appendChild(item);
    });
    container.appendChild(dropdownEl);
  }

  btnEl.addEventListener('click', handleClick);

  // 点击外部关闭 dropdown
  document.addEventListener('click', (e) => {
    if (dropdownOpen && dropdownEl && !dropdownEl.contains(e.target) && e.target !== btnEl && !btnEl.contains(e.target)) {
      closeDropdown();
    }
  });

  currentStatus = initialStatus;
  render();
}

async function handleClick(e) {
  if (!btnEl) return;

  if (currentStatus && currentStatus.active) {
    // 运行中 → 停止
    btnEl.disabled = true;
    try {
      await messaging.stopFocusTimer();
    } catch (err) {
      console.error(LOG_PREFIX, 'focusTimerWidget stop failed', err);
    } finally {
      btnEl.disabled = false;
    }
  } else {
    // 未运行 → 切换 dropdown
    e.stopPropagation();
    if (dropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }
}

function openDropdown() {
  if (!dropdownEl) return;
  dropdownEl.hidden = false;
  dropdownOpen = true;
}

function closeDropdown() {
  if (!dropdownEl) return;
  dropdownEl.hidden = true;
  dropdownOpen = false;
}

/**
 * 从 BCAST_STATE_CHANGE 接收更新。
 */
export function update(status) {
  if (status === undefined) return;
  currentStatus = status;
  closeDropdown();
  render();
}

/**
 * 每秒 tick 刷新剩余时间。
 */
export function tickUpdate() {
  if (!currentStatus || !currentStatus.active) return;
  if (currentStatus.endTime) {
    currentStatus.remainingMs = Math.max(0, currentStatus.endTime - Date.now());
    if (currentStatus.durationMs > 0) {
      currentStatus.progress = 1 - (currentStatus.remainingMs / currentStatus.durationMs);
    }
  }
  render();
}

/**
 * 格式化毫秒为 MM:SS 或 H:MM:SS
 */
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hr > 0 ? `${hr}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function render() {
  if (!btnEl || !labelEl) return;

  const active = currentStatus && currentStatus.active;
  btnEl.classList.toggle('is-active', !!active);
  btnEl.title = active ? '点击停止专注计时' : '开始专注计时';

  if (active && currentStatus.remainingMs > 0) {
    labelEl.textContent = formatCountdown(currentStatus.remainingMs);
    labelEl.hidden = false;
  } else {
    labelEl.textContent = '';
    labelEl.hidden = true;
  }
}

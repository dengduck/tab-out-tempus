/**
 * ui/views/privateModeWidget.js
 * ----------------------------
 * Header 上的隐私模式快捷按钮。
 *
 * 交互：
 *   - 未激活 → 点击弹出 dropdown 选时长（15/30/45/60/120 分钟）
 *   - 已激活 → 按钮变 active 态，显示精确到秒的剩余时间，点击关闭
 *
 * 数据流：
 *   - 首帧：init(state.privateMode)
 *   - 订阅：BCAST_STATE_CHANGE → update(payload.privateMode)
 *   - BCAST_TICK → tickUpdate() 刷新剩余时间
 *
 * 里程碑：M9。
 */

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';
import { LOG_PREFIX } from '../../shared/constants.js';

const PRESETS = [15, 30, 45, 60, 120];

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
 * @param {any} initialStatus  getState().privateMode
 */
export function init(initialStatus) {
  btnEl = document.getElementById('privateModeToggle');
  if (!btnEl) return;

  // 内部结构：SVG icon + 文字标签 + 倒计时
  btnEl.innerHTML = '';
  const icon = h('span', { className: 'headerWidget__icon' });
  icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const text = h('span', { className: 'headerWidget__text', textContent: '隐私时间' });
  labelEl = h('span', { className: 'headerWidget__label' });
  btnEl.appendChild(icon);
  btnEl.appendChild(text);
  btnEl.appendChild(labelEl);

  // dropdown（选时长）
  const wrapper = btnEl.parentElement;
  if (wrapper) {
    const container = h('div', { className: 'headerWidget__container' });
    wrapper.insertBefore(container, btnEl);
    container.appendChild(btnEl);

    dropdownEl = h('div', { className: 'headerWidget__dropdown' });
    dropdownEl.hidden = true;
    PRESETS.forEach(min => {
      const item = h('button', {
        className: 'headerWidget__dropdownItem',
        textContent: min >= 60 ? `${min / 60} 小时` : `${min} 分钟`,
      });
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeDropdown();
        btnEl.disabled = true;
        try {
          await messaging.startPrivateMode(min);
        } catch (err) {
          console.error(LOG_PREFIX, 'privateModeWidget start failed', err);
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
      await messaging.stopPrivateMode();
    } catch (err) {
      console.error(LOG_PREFIX, 'privateModeWidget stop failed', err);
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
  }
  render();
}

/**
 * 格式化毫秒为 MM:SS 或 H:MM:SS
 */
function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function render() {
  if (!btnEl || !labelEl) return;

  const active = currentStatus && currentStatus.active;
  btnEl.classList.toggle('is-active', !!active);
  btnEl.title = active ? '点击关闭隐私模式' : '开启隐私模式';

  if (active && currentStatus.remainingMs > 0) {
    labelEl.textContent = formatCountdown(currentStatus.remainingMs);
    labelEl.hidden = false;
  } else {
    labelEl.textContent = '';
    labelEl.hidden = true;
  }
}

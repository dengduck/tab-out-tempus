/**
 * ui/views/headerWidget.js
 * ------------------------
 * Header 快捷控件工厂（P2-22）。
 *
 * privateModeWidget 和 focusTimerWidget 共享 95% 的逻辑：
 *   - 未激活 → 点击弹 dropdown 选时长 → 调 start
 *   - 已激活 → active 态 + MM:SS 倒计时，点击调 stop
 *   - BCAST_STATE_CHANGE → update / BCAST_TICK → tickUpdate
 *
 * 本工厂把差异收敛成 config，返回 { init, update, tickUpdate } 三个方法。
 * 每次调用 createHeaderWidget 产生一个独立闭包实例（互不干扰）。
 *
 * 里程碑：M9 → v2.1（P2-22 提取工厂）。
 */

import { h } from '../utils/dom.js';
import { LOG_PREFIX } from '../../shared/constants.js';

/**
 * @typedef {Object} HeaderWidgetConfig
 * @property {string}   btnId        header 里已有按钮的 DOM id
 * @property {string}   iconSvg      按钮内 SVG（字符串）
 * @property {string}   text         按钮文字标签
 * @property {number[]} presets      dropdown 时长预设（分钟）
 * @property {(min:number)=>string} [presetLabel]  预设项文案（默认 `${min} 分钟`）
 * @property {(min:number,opts?:object)=>Promise<any>} onStart  选时长后调用
 * @property {()=>HTMLElement} [createDropdownExtra]
 * @property {()=>object} [getStartOptions]
 * @property {()=>Promise<any>} onStop  激活态点击调用
 * @property {string}   titleIdle    未激活时按钮 title
 * @property {string}   titleActive  激活时按钮 title
 * @property {string}   logName      console 错误前缀用
 */

/**
 * 创建一个 header 快捷控件实例。
 * @param {HeaderWidgetConfig} config
 * @returns {{init:(s:any)=>void, update:(s:any)=>void, tickUpdate:()=>void}}
 */
export function createHeaderWidget(config) {
  const presetLabel = config.presetLabel || ((min) => `${min} 分钟`);

  /** @type {HTMLButtonElement|null} */
  let btnEl = null;
  /** @type {HTMLSpanElement|null} */
  let labelEl = null;
  /** @type {HTMLDivElement|null} */
  let dropdownEl = null;

  let currentStatus = null;
  let dropdownOpen = false;

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

  async function handleClick(e) {
    if (!btnEl) return;
    if (currentStatus && currentStatus.active) {
      btnEl.disabled = true;
      try {
        await config.onStop();
      } catch (err) {
        console.error(LOG_PREFIX, config.logName, 'stop failed', err);
      } finally {
        btnEl.disabled = false;
      }
    } else {
      e.stopPropagation();
      if (dropdownOpen) closeDropdown();
      else openDropdown();
    }
  }

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
    btnEl.title = active ? config.titleActive : config.titleIdle;

    if (active && currentStatus.remainingMs > 0) {
      labelEl.textContent = formatCountdown(currentStatus.remainingMs);
      labelEl.hidden = false;
    } else {
      labelEl.textContent = '';
      labelEl.hidden = true;
    }
  }

  function init(initialStatus) {
    btnEl = document.getElementById(config.btnId);
    if (!btnEl) return;

    btnEl.innerHTML = '';
    const icon = h('span', { className: 'headerWidget__icon' });
    icon.innerHTML = config.iconSvg;
    const text = h('span', { className: 'headerWidget__text', textContent: config.text });
    labelEl = h('span', { className: 'headerWidget__label' });
    btnEl.appendChild(icon);
    btnEl.appendChild(text);
    btnEl.appendChild(labelEl);

    const wrapper = btnEl.parentElement;
    if (wrapper) {
      const container = h('div', { className: 'headerWidget__container' });
      wrapper.insertBefore(container, btnEl);
      container.appendChild(btnEl);

      dropdownEl = h('div', { className: 'headerWidget__dropdown' });
      dropdownEl.hidden = true;
      const extra = config.createDropdownExtra?.();
      if (extra) dropdownEl.appendChild(extra);
      config.presets.forEach((min) => {
        const item = h('button', {
          className: 'headerWidget__dropdownItem',
          textContent: presetLabel(min),
        });
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          closeDropdown();
          btnEl.disabled = true;
          try {
            await config.onStart(min, config.getStartOptions?.() || {});
          } catch (err) {
            console.error(LOG_PREFIX, config.logName, 'start failed', err);
          } finally {
            btnEl.disabled = false;
          }
        });
        dropdownEl.appendChild(item);
      });
      container.appendChild(dropdownEl);
    }

    btnEl.addEventListener('click', handleClick);

    document.addEventListener('click', (e) => {
      if (dropdownOpen && dropdownEl && !dropdownEl.contains(e.target) && e.target !== btnEl && !btnEl.contains(e.target)) {
        closeDropdown();
      }
    });

    currentStatus = initialStatus;
    render();
  }

  function update(status) {
    if (status === undefined) return;
    currentStatus = status;
    closeDropdown();
    render();
  }

  function tickUpdate() {
    if (!currentStatus || !currentStatus.active) return;
    if (currentStatus.endTime) {
      currentStatus.remainingMs = Math.max(0, currentStatus.endTime - Date.now());
      if (currentStatus.durationMs > 0) {
        currentStatus.progress = 1 - (currentStatus.remainingMs / currentStatus.durationMs);
      }
    }
    render();
  }

  return { init, update, tickUpdate };
}

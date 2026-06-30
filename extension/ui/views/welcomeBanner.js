/**
 * ui/views/welcomeBanner.js
 * -------------------------
 * 首次安装欢迎横幅。
 *
 * 显示条件（同时满足）：
 *   1. chrome.storage.local 里 __welcomeBannerDismissed 不为 true
 *   2. 安装时间（__installTime）距今 ≤ 7 天，或安装时间不存在（兼容旧版升级）
 *
 * 消失方式：
 *   - 用户点击 × 按钮 → 立即隐藏 + 写 dismissed 标记
 *   - 安装超过 7 天 → 不再显示
 *
 * 里程碑：M9（打磨体验）。
 */

import { STORAGE_KEY, LOG_PREFIX } from '../../shared/constants.js';

const BANNER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

/**
 * 初始化欢迎横幅。在 main.js 首帧渲染后调用。
 * 会自动判断是否需要展示，不需要外部传参。
 */
export async function init() {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEY.WELCOME_BANNER_DISMISSED,
      STORAGE_KEY.INSTALL_TIME,
    ]);

    // 已手动关闭 → 不显示
    if (result[STORAGE_KEY.WELCOME_BANNER_DISMISSED] === true) return;

    const installTime = result[STORAGE_KEY.INSTALL_TIME];
    const now = Date.now();

    // 有安装时间且超过 7 天 → 不显示
    if (typeof installTime === 'number' && (now - installTime) > BANNER_TTL_MS) return;

    // 没有安装时间（旧版升级用户）→ 给他补一个，然后正常显示
    if (!installTime) {
      await chrome.storage.local.set({ [STORAGE_KEY.INSTALL_TIME]: now });
    }

    show();
  } catch (err) {
    console.error(LOG_PREFIX, 'welcomeBanner init failed', err);
  }
}

function show() {
  const banner = document.createElement('div');
  banner.className = 'welcomeBanner';
  banner.innerHTML = `
    <p class="welcomeBanner__text">
      🎉 Tabpus 已启动，从现在开始，它会在后台持续追踪你真正查看和使用每个标签页的时长，协助你规划浏览习惯。你可以使用右上角的隐私模式按钮或专注计时按钮来进一步探索使用可能。
    </p>
    <button class="welcomeBanner__close" title="关闭提示" aria-label="关闭提示">&times;</button>
  `;

  banner.querySelector('.welcomeBanner__close').addEventListener('click', () => {
    dismiss(banner);
  });

  // 插入位置：header 之后
  const header = document.getElementById('header');
  if (header && header.parentNode) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    // fallback：插到 #app 最前面
    const app = document.getElementById('app');
    if (app) app.prepend(banner);
  }

  // 进入动画：下一帧添加 is-visible 类
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.classList.add('is-visible');
    });
  });
}

async function dismiss(bannerEl) {
  // Round 4 P1：先持久化「关闭意图」，再播退场动画。
  // 避免动画期间页面被关闭 / storage 写失败导致横幅下次重现。
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY.WELCOME_BANNER_DISMISSED]: true,
    });
  } catch (err) {
    console.error(LOG_PREFIX, 'welcomeBanner dismiss failed', err);
  }

  bannerEl.classList.remove('is-visible');
  bannerEl.classList.add('is-leaving');

  // 等动画结束后移除 DOM
  bannerEl.addEventListener('transitionend', () => {
    bannerEl.remove();
  }, { once: true });

  // 兜底：400ms 后强制移除（防 transitionend 不触发）
  setTimeout(() => {
    if (bannerEl.parentNode) bannerEl.remove();
  }, 400);
}

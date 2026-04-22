/**
 * ui/utils/confetti.js
 * --------------------
 * Canvas 粒子爆炸动画，关闭 tab 时在坐标 (x, y) 处爆开一把彩色碎片。
 *
 * 实现：
 *   - 全局单例 `<canvas>` 挂 document.body，position:fixed 覆盖整屏，pointer-events:none
 *   - burst(x, y, opts) 往共享的 particles 数组里 push 一批粒子
 *   - 单个 rAF loop 推进所有粒子（重力 + 速度 + 旋转 + 淡出），粒子列表空了就停 rAF
 *
 * 关键细节：
 *   - DPR 缩放：canvas 实际像素 = CSS 像素 × devicePixelRatio，避免 HiDPI 模糊
 *   - resize：window resize 时重调 canvas 尺寸
 *   - 粒子用小矩形（旋转后看起来像彩带），比圆点更有"confetti"感
 *
 * 契约 DECISIONS D12（纯 JS，不引入外部库）。
 */

const COLORS = ['#ff7a59', '#ffb547', '#ffd24c', '#5fd37b', '#4eacff', '#c06bff', '#ff6ab0'];

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
/** @type {Array<Particle>} */
const particles = [];
let rafId = 0;
let lastTs = 0;

/** @typedef {{x:number,y:number,vx:number,vy:number,w:number,h:number,color:string,rot:number,vrot:number,life:number,ttl:number}} Particle */

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'confettiLayer';
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * 在 (x, y)（视口坐标）爆开一把粒子。
 * @param {number} x
 * @param {number} y
 * @param {{count?: number, spread?: number, power?: number}} [opts]
 */
export function burst(x, y, opts = {}) {
  ensureCanvas();
  // M10(P1-17): 粒子上限守卫——防止连续快速关闭大量 tab 导致粒子暴涨卡顿
  if (particles.length > 500) return;
  const count = opts.count ?? 28;
  const power = opts.power ?? 1;
  // spread 0~1：1 = 全向四散；0 = 都朝上
  const upBias = 0.65;

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (120 + Math.random() * 260) * power;
    // 初始向上偏置：把 y 分量往上推
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 260 * upBias;

    particles.push({
      x, y,
      vx, vy,
      w: 4 + Math.random() * 5,
      h: 8 + Math.random() * 6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 12,
      life: 0,
      ttl: 0.9 + Math.random() * 0.5,  // 秒
    });
  }

  if (!rafId) {
    lastTs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(ts) {
  if (!ctx || !canvas) { rafId = 0; return; }
  const dt = Math.min(0.05, (ts - lastTs) / 1000);  // 上限 50ms 防掉帧大跳
  lastTs = ts;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gravity = 620;  // px/s^2
  const drag = 0.985;

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life += dt;

    // 物理
    p.vy += gravity * dt;
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;

    // 淡出
    const alpha = Math.max(0, 1 - p.life / p.ttl);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();

    if (p.life >= p.ttl || p.y > window.innerHeight + 40) {
      particles.splice(i, 1);
    }
  }

  if (particles.length === 0) {
    rafId = 0;
    // 清一下画面，防止末帧残留
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  rafId = requestAnimationFrame(tick);
}

/**
 * ui/utils/audio.js
 * -----------------
 * Swoosh 音效（关闭 tab 时播放），用 Web Audio API 实时合成，零资源文件。
 *
 * 原理：
 *   - 生成一段 ~0.22s 的 shaped white noise
 *   - 过一个 bandpass filter，频率从 1800Hz 快速扫到 300Hz（下坠感）
 *   - ADSR envelope 让它有 attack + decay，不是 noise 硬切
 *
 * 懒初始化 AudioContext：浏览器要求用户交互后才能 resume。
 * 首次 playSwoosh 调用时（必然在 click handler 里）创建 + resume，之后复用。
 *
 * 契约 DECISIONS D12（保持纯 JS，不引入 assets）。
 */

/** @type {AudioContext|null} */
let ctx = null;

function ensureContext() {
  if (ctx) return ctx;
  try {
    // eslint-disable-next-line no-undef
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch (err) {
    // 某些环境禁用 AudioContext
    console.warn('[tempus] AudioContext unavailable', err);
    return null;
  }
  return ctx;
}

/**
 * 播放 swoosh 音效。
 * @param {{pitch?: number, duration?: number, gain?: number}} [opts]
 *   pitch: 基准频率倍数，1 是默认，0.7 关批量时听起来更低沉
 *   duration: 秒，默认 0.22
 *   gain: 0..1，默认 0.18（别太吵）
 */
export function playSwoosh(opts = {}) {
  const actx = ensureContext();
  if (!actx) return;

  // 用户 gesture 之后 resume（suspended → running）
  if (actx.state === 'suspended') {
    actx.resume().catch(() => { /* best-effort */ });
  }

  const pitch = opts.pitch ?? 1;
  const duration = opts.duration ?? 0.22;
  const gain = opts.gain ?? 0.18;
  const now = actx.currentTime;

  // 1. 生成 white noise buffer
  const bufferSize = Math.floor(actx.sampleRate * duration);
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = actx.createBufferSource();
  noise.buffer = buffer;

  // 2. bandpass filter sweep
  const filter = actx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(1800 * pitch, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, 300 * pitch), now + duration);

  // 3. ADSR envelope
  const g = actx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.02);           // attack 20ms
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration); // decay to silence

  noise.connect(filter);
  filter.connect(g);
  g.connect(actx.destination);

  noise.start(now);
  noise.stop(now + duration + 0.02);

  // 让 GC 能回收
  noise.onended = () => {
    try {
      noise.disconnect();
      filter.disconnect();
      g.disconnect();
    } catch (_) { /* noop */ }
  };
}

/**
 * ui/components/confettiBurst.js
 * -------------------------------
 * 关闭 tab 时的 confetti 爆炸 + Web Audio swoosh 音效。
 *
 * 说明（M1 决策）：v1 的 confetti 是内联在 app.js 里的纯 JS 函数，swoosh 是 Web Audio
 *   API 生成的（没有 mp3 文件）。v2 保持这个路线——不引入 assets/ 目录的第三方 JS/mp3。
 *
 * 里程碑：M3。
 * 参考实现：`git show legacy-v1:extension/app.js` 的 shootConfetti / playSwoosh 函数。
 */

export function burst(_x, _y) { /* stub, M3 */ }
export function playSwoosh() { /* stub, M3 */ }

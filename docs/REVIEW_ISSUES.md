# Tabpus — 代码审查问题追踪

> 本文档追踪 v1.3.1 全面代码审查中发现的所有问题及其修复状态。
> 审查日期：2026-04-19 | 审查基于 Chrome Extension MV3 最佳实践

---

## 🔴 阻塞 (MUST FIX) — 全部完成 ✅

- [x] **#1** `setInterval` 在 SW 终止后失效 → 改用 `chrome.alarms` — `background.js` (v1.3.2)
- [x] **#2** SW 全局变量丢失（privateModeEndTime 等）→ 持久化到 `chrome.storage.session` — `background.js` (v1.3.2)
- [x] **#3** `appendTimeLog` read-modify-write 竞争条件 → 写入队列串行化 — `background.js` (v1.3.2)

## 🟡 建议 (SHOULD FIX) — 全部完成 ✅

- [x] **#4** manifest 多余 `"sessions"` 权限 → 移除 — `manifest.json` (v1.3.2)
- [x] **#5** `onRemoved` 缺少隐私模式检查 → 添加 — `background.js` (v1.3.2)
- [x] **#6** `onMessage` 末尾 `return true` fallthrough → 改为 `return false` — `background.js` (v1.3.2)
- [x] **#7** `recoverActiveSession` 并发双写风险 → 加防重入标志 — `background.js` (v1.3.2)
- [x] **#8** 每次 tab 切换都读 `blockedDomains` → 缓存 + `onChanged` 监听 — `background.js` (v1.3.2)
- [x] **#9** `config.local.js` 不存在时 404 → 创建空文件 — `extension/config.local.js` (v1.3.2)
- [x] **#10** Settings 面板文字硬编码中文 → 走 i18n — `index.html` + `app.js` (v1.3.2)

## 💭 挑剔 (Nice to have) — 全部完成 ✅

- [x] **#11** `formatDuration()` 在 5-59 秒显示 "0分钟" → 加秒级区间 — `app.js` (v1.3.2)
- [x] **#12** Productivity banner 消息只有中文 → 加英文版本 — `app.js` (v1.3.2)
- [x] **#13** CSS 选择器中 hostname 注入风险 → `CSS.escape()` — `app.js` (v1.3.2)
- [x] **#14** `updateBadge()` 调用频率过高 → `debouncedUpdateBadge()` 200ms debounce — `background.js` (v1.3.2)
- [x] **#15** 导入 timeLog 无去重机制 → 基于 `s+e+h` 去重 — `app.js` (v1.3.2)
- [x] **#16** `onUpdated` 触发 badge 更新过频 → 仅在 `discarded` 状态变化时触发 — `background.js` (v1.3.2)

---

## 📦 新发现的问题（来自 v1.3.2 集中审查）— 全部完成 ✅

- [x] **#17** `renderDomainCard` 中多个 `data-hostname` 属性未 `escapeHtml` → 全部用 `escapeHtml()` 包裹 — `app.js`
- [x] **#18** `buildOverflowChips` 中 `label` 直接插入 innerHTML 无转义（潜在 XSS）→ 改为 `escapeHtml(label)` — `app.js`
- [x] **#19** `buildOverflowChips` 中 `safeUrl`/`safeTitle` 只 escape 引号，不完整 → 统一用 `escapeHtml()` — `app.js`
- [x] **#20** `ensurePersistAlarm()` 异步初始化不稳健 → 直接 `chrome.alarms.create()`（本身幂等）— `background.js`

---

## 🗂️ 代码组织 — 选项 A 已实施

- [x] **app.js 顶部目录索引** — 16 个章节 + 关键函数行号，加了搜索 tip
- [x] **background.js 顶部目录索引** — 12 个章节 + 关键函数行号（ASCII 表格式）

### 待观察 / 未来考虑
- [ ] **选项 B**：拆 3 个最独立的模块（`i18n.js`, `ui-helpers.js`, `heatmap.js`）— 待选项 A 用 1-2 周后评估是否还需要
- [ ] **选项 C**：全面拆分到 `src/` 目录 — 仅在选项 B 验证收益后再考虑

> 决策文档：`brain/000684e19f044dfcbc7c2ed0e7cccf69/modularization-evaluation.md`

---

*状态标记：[x] = 已修复 | [ ] = 待处理 | [-] = 不修 + 原因*

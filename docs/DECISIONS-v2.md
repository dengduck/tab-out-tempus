# v2 Rewrite — Locked Decisions

> 本文档记录 v2 重写启动前（2026-04-20）锁定的关键决策，后续开发过程如需变更必须在此文档追加新记录（而非修改历史条目）。
>
> 相关文档：
> - `REWRITE-PLAN-v2.md` — 里程碑 M0-M9
> - `ARCHITECTURE-v2.md` — 模块边界与接口契约
> - `REVIEW_ISSUES.md` — v1 代码审查问题清单（v2 要避免的坑）

---

## D1. 分支起点：`070fafc`

**决定**：rewrite-v2 分支从 `070fafc` 起步，不是从 `main` 最新也不是从 `15e81be`。

**理由**：
- `070fafc` = "v1.3.0 rebrand（tab-out → tab-out-tempus）终点" 的 docs commit
- 该 commit 已包含 main 的全部功能：bento layout、custom group、pure extension（无 server）、save-for-later、个人 config 支持等
- 之后的 our-features（1.3.1-1.3.5）都是时间统计相关的 feat 和修复，这部分正是 v2 要重写的
- 选 070fafc 能继承所有稳定功能，且不带任何要推翻的时间追踪代码

**不选 main 最新的原因**：main 和 our-features 分叉点 = `2c9b9c5`，之后 main 没再动，所以 "main 最新 = 070fafc 之前的一个 commit"，070fafc 更完整（多了 rebrand docs）。

## D2. 无外部 upstream sync

**决定**：不配置 upstream remote，不做"从 zarazhangrui/tab-out 同步"的操作。

**理由**：
- `origin = dengduck/tab-out-tempus`，是 fork 之后的独立仓库
- 当初 fork 自 zarazhangrui/tab-out，但之后双方都独立演化
- 原始上游的最近更新（如果有）与 v2 重写无关，强行合并反而引入冲突
- v2.1+ 如果需要参考上游新特性，再评估是否 cherry-pick

## D3. 核心功能等价，代码结构允许重写

**决定**：v2 对 v1 采用"功能等价"而非"代码等价"标准。

**具体含义**：
- 用户视角的功能必须保留：域名分组、Homepages 特殊分组、关闭 tab（swoosh + confetti）、重复检测、save-for-later、跨窗口跳转、localhost 分组、badge 计数、bento layout、custom group、per-tab 时长、历史统计、热力图、隐私模式、Focus Timer、黑名单
- 代码结构完全重写：模块边界、文件拆分、状态管理、消息协议都按 `ARCHITECTURE-v2.md` 设计
- UI 细节允许微调：色彩、间距、动画时长等可优化，但不改变核心交互

**验收标准**：v2.0 发布前要做功能对照表（功能名、v1 行为、v2 行为、差异说明），对任何不等价项必须有明确解释。

## D4. chrome.idle API 纳入 v2.0 MVP

**决定**：M4 TimeTracker 阶段同时集成 `chrome.idle` API。

**行为**：
- 用户键鼠空闲 60s → idle 触发 → TimeTracker 暂停当前 slice
- 用户恢复交互 → active 触发 → TimeTracker 创建新 slice
- 这是在 focus 模型之上的二级过滤：窗口 focused 且 chrome.idle 为 active 时才计时

**理由**：
- v1 最大的"时间不准"来源就是"浏览器开着但人离开了桌子"的场景
- 推迟到 v2.1 意味着用户还要在不准的状态下用很久
- chrome.idle 是 Chrome 原生 API，接入成本低（1 个监听 + 1 个状态变量）
- 配合 focus 模型能彻底解决"虚假计时"

**实现要点**（写进 M4 任务）：
- `chrome.idle.setDetectionInterval(60)` —— 60s 阈值
- 监听 `chrome.idle.onStateChanged`（idle / active / locked）
- TimeTracker 通过 `pause('idle')` / `resume('idle')` 接入（统一的 pauseReasons Set 机制，见 D9）
- 多个暂停源（window-blur / idle / private-mode / blacklist）**并行叠加，无优先级**——
  任一源要求暂停就暂停，全部解除才恢复。这比"谁覆盖谁"的优先级模型更 robust，也避免了状态机复杂化。

## D5. Private Mode 保留，从 v1 移植

**决定**：v2.0 M8 阶段恢复 Private Mode 功能，设计参考 `v1-feature-reference/private-mode.md`。

**v1 现状**：完整实现在 our-features/app.js L1620-1910 和 background.js 多处拦截点。

**v2 改进点**：
- 统一 `isPrivateModeActive()` 作为 TimeTracker 的入口守门，不散落在多处 if
- UI 倒计时用 `visibilityState` 控制 vs. 每秒 setInterval
- 消息协议按 `shared/messages.js` 规范化
- 加键盘快捷键（TBD）

## D6. 推迟到 v2.1+ 的功能

**决定**：以下 v1 功能**不进 v2.0 MVP**，推迟到 v2.1 或更晚：

| 功能 | 推迟理由 |
|---|---|
| Productivity Banner（生产力提醒条） | 内容策略没想清楚，v1 实现是 placeholder |
| Tab 休眠/唤醒（Chrome Discard API） | 低频使用，对 v2.0 MVP 不关键 |
| 历史数据导入/导出（JSON） | v2 存储模型可能变，等模型稳定再做 |
| Bento 自定义（用户拖拽调整块） | 起点（070fafc）的 bento 是固定布局，自定义是扩展功能 |

**重要**：这不意味着"不做了"，只是 v2.0 发布时不带。v2.1 计划单独写。

## D7. 工程铁律（写入代码注释）

以下规则在 v2 代码里是"硬性的"，违反必须在 PR 里专项讨论：

1. **TimeTracker 是唯一能修改 `tabCumulativeMs` 的模块**，其它模块只读
2. `tabCumulativeMs` 是**单调计数器**，只允许 `+=` 操作，禁止赋值
3. SW 和 UI 不共享可变状态，只通过 `shared/messages.js` 定义的消息通信
4. 每个模块文件硬性上限 **~400 行**，超了必须拆
5. 永远不用 `setInterval`，定时任务一律走 `chrome.alarms`（最小周期 30s）
6. 所有 API 访问都通过 `shared/chrome-wrapper.js` 包一层，方便测试 mock

## D8. 归档策略

**决定**：v1.3.5 通过双重备份永久保留：

- Git tag：`v1.3.5-legacy`（不可变快照）
- Git branch：`legacy-v1`（长期分支，可继续接收紧急修复但不主动维护）
- `our-features` 分支保持现状，后续不再新增提交，作为历史参考

**恢复路径**：`git checkout v1.3.5-legacy` 或 `git checkout legacy-v1` 都能回到 v1.3.5 可用状态。

---

## D9. TimeTracker 暂停模型：pauseReasons Set（M0 冻结）

**决定**：TimeTracker 不用单一 `isPaused: bool`，改用 `pauseReasons: Set<PauseReason>` 多源叠加模型。

**PauseReason 枚举**：
- `'window-blur'` —— Chrome 窗口失焦（focusModel 触发）
- `'idle'` —— chrome.idle 键鼠空闲 60s+
- `'private-mode'` —— 用户启动了隐私计时窗口
- `'blacklist'` —— 当前 active tab 的 hostname 在黑名单里
- `'no-active-tab'` —— 焦点窗口没有 active tab（例如启动间隙）

**状态机语义**：
- `pauseReasons.size > 0` ⇒ 暂停（不开新 slice、不累加 cumulative）
- `pauseReasons.size === 0` 且有焦点 tab ⇒ 计时中
- `pause(reason)` 调用 `Set.add`；如从 0→1，finalize 当前 slice
- `resume(reason)` 调用 `Set.delete`；如从 1→0 且有焦点 tab，开新 slice

**理由**：
- v1.3.3→1.3.5 反复踩坑的根因就是"不知道是谁把计时停了"——多个地方独立判断 isPaused，互相覆盖
- Set 模型让每个暂停源**独立负责自己的状态**，不用考虑"别人会不会取消我的暂停"
- 诊断面板能直接显示 `pauseReasons` 内容，邓老师一眼看懂"为什么现在没在计时"
- 新增暂停源（未来可能的 Focus Timer strict 模式、网络离线等）只是往枚举里加一个字符串

**测试要求**：`tests/pauseReasons.test.js` 必须覆盖多源叠加的全排列（见 ARCHITECTURE-v2.md §9.2）。

## D10. 消息协议：请求式 + 订阅式混合（M0 冻结）

**决定**：UI ↔ SW 通信采用混合模式：
- **请求式（REQ_\*）**：UI 主动问 SW 要数据，一次性 sendMessage + sendResponse（类似 RPC）
- **订阅式（BCAST_\*）**：SW 在状态变化时广播，UI 通过 `chrome.runtime.onMessage` 接收

**消息类型前缀强制区分**（在 `shared/messages.js`）：
- `MSG.REQ_*` — 所有请求式消息
- `MSG.BCAST_*` — 所有广播消息

**广播类型**：
- `BCAST_TICK`（1s/次）：`{now, todayMs, activeTabId, activeTabMs}`，带动 chip badge 和 header 实时更新
- `BCAST_TAB_CHANGE`（事件驱动）：tab 增删改，UI 做 diff 更新
- `BCAST_STATE_CHANGE`（事件驱动）：pauseReasons / privateMode / focusTimer 变化

**理由**：
- 纯 RPC：`REQ_GET_TAB_TIME` 轮询浪费 IPC，且有延迟
- 纯 Observer：历史视图这种"打开时一次性拉取"的场景用订阅不自然
- 混合模式各取所长：实时数字走订阅（省轮询），快照数据走请求（省订阅复杂度）
- 前缀强制区分让代码审查时一眼区分："这是请求还是广播？"不用读实现

**BCAST_TICK 节电策略**（重要）：
- UI 初始化时给 SW 发 `REQ_GET_STATE`，SW 记录 `hasActiveUIPort = true`
- 只有 `hasActiveUIPort` 时才发 BCAST_TICK，避免 SW 无人在听还在广播
- 所有 new tab page 关闭时（UI 端 `beforeunload`），发 `REQ_UI_GONE`，SW 置 false

**实现约束**：
- REQ 消息的 `onMessage` handler 必须 `return true`（MV3 异步响应要求）
- BCAST 消息的 payload 必须 **最小化**（TICK 里不带完整 tab 列表，只带几个数字）
- UI 订阅 API 返回 unsubscribe 函数，`historyView` 关闭时解绑

## D11. UI 初始化流程：一次性请求 + 订阅式增量（M0 冻结）

**决定**：`ui/main.js` 首次渲染走**请求式并发拉取**（Promise.all），之后**全部走订阅式增量**。

**禁止**：
- 首次渲染之后还用 REQ 拉数据做全量 re-render
- `tabsGrid` 整页重绘（即使 tab 列表变了，也要按 action diff）

**要求**：
- 所有 view 按需加载（历史视图点开才订阅 + 拉数据；关闭解绑）
- 订阅回调必须做 debounce/throttle（BCAST_TICK 1s 一次已经够，BCAST_TAB_CHANGE 如果短时间多次要合并）

**理由**：
- v1 的 app.js 每次 tab 变化都整页重绘 → 带时长 chip 时有明显闪烁
- 订阅式增量让 UI 流畅度接近原生，零依赖前提下也能做到

---

_Last updated: 2026-04-20（M0 冻结，追加 D9-D11）_

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

## D10. 消息协议：请求式 + 订阅式混合（M0 冻结，2026-07-23 生命周期修订）

**决定**：UI ↔ SW 通信采用混合模式：
- **请求式（REQ_\*）**：UI 主动问 SW 要数据，一次性 sendMessage + sendResponse（类似 RPC）
- **订阅式（BCAST_\*）**：UI 建立命名 `runtime Port`，SW 只向活跃 Port 推送广播；断线自动重连

**消息类型前缀强制区分**（在 `shared/messages.js`）：
- `MSG.REQ_*` — 所有请求式消息
- `MSG.BCAST_*` — 所有广播消息

**广播类型**：
- `BCAST_TICK`（1s/次）：`{now, todayMs, activeTabId, isActive, tabTimes}`，一次更新 header 与全部 chip，避免额外轮询
- `BCAST_TAB_CHANGE`（事件驱动）：tab 增删改，UI 做 diff 更新
- `BCAST_STATE_CHANGE`（事件驱动）：pauseReasons / privateMode / focusTimer 变化；允许部分 payload，UI 必须保留未携带字段

**理由**：
- 纯 RPC：`REQ_GET_TAB_TIME` 轮询浪费 IPC，且有延迟
- 纯 Observer：历史视图这种"打开时一次性拉取"的场景用订阅不自然
- 混合模式各取所长：实时数字走订阅（省轮询），快照数据走请求（省订阅复杂度）
- 前缀强制区分让代码审查时一眼区分："这是请求还是广播？"不用读实现

**BCAST_TICK 节电与生命周期策略**（重要）：
- UI 初始化时建立名为 `tempus-ui` 的 `runtime Port`；页面关闭由 Chrome 自动触发 `onDisconnect`
- SW 用 `Set<Port>` 支持多个 new tab 页面，只有集合非空时才运行 1s UI tick
- UI 每 20s 通过 Port 发送 heartbeat；SW 被系统回收导致 Port 断开时，UI 自动重连并恢复 tick
- `REQ_UI_READY/GONE` 仅保留为旧 UI 兼容入口，不再参与引用计数

**实现约束**：
- REQ 消息的 `onMessage` handler 必须 `return true`（MV3 异步响应要求）
- TICK 可携带 `tabTimes`，但只能计算/发送一次，禁止 UI 再发每秒批量查询
- UI 订阅 API 返回 unsubscribe 函数；部分状态广播不得清空未携带字段

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

## D12. Confetti / Swoosh 保持纯 JS 路线，不引入 assets/ 目录（M1 发现，2026-04-20）

**背景**：ARCHITECTURE-v2.md §2 的目录树原本写了：
```
extension/assets/
  ├── swoosh.mp3
  └── confetti.js  (第三方纯 JS)
```
但 M1 建目录时查了 v1 源码（`git show legacy-v1:extension/app.js`）才发现：
- v1 的 confetti **是手写在 app.js 里的纯函数**（`shootConfetti` / `animateParticles`），不是第三方库
- v1 的 swoosh **是用 Web Audio API 实时生成的**（shaped white noise + bandpass filter sweep），不需要 mp3 文件

**决定**：v2 保持 v1 的实现路线：
- `ui/components/confettiBurst.js` 用纯 JS 绘制（Canvas 或 DOM 粒子），不引入第三方库
- swoosh 用 Web Audio API 运行时生成，不引入 mp3 资产
- **不建 `extension/assets/` 目录**（除非未来真的需要第三方资产）

**理由**：
- 坚守"零依赖、开箱即用"哲学
- 避免引入 MP3 这种容易被杀软 flag 的二进制资产
- Web Audio 生成的 swoosh 声音跟 mp3 效果接近（v1 用户反馈很好），没必要多维护一个 mp3 文件
- v1 实现可直接参考复用（`git show legacy-v1:extension/app.js | sed -n '925,1050p'`）

**影响范围**：
- `ARCHITECTURE-v2.md §2` 目录树里 assets/ 的条目**已过时**但暂不修正文档（避免连锁改动）；本决策作为覆盖性修正
- M3 实现 confetti 时直接在 `ui/components/confettiBurst.js` 里写，不用建 assets/

---

## D13. TimeTracker 事件路由独立于 tabRegistry（M4 落地，2026-04-20）

**背景**：M2 里 tabRegistry 已经在 SW 端注册了 `chrome.tabs.onCreated/onUpdated/onRemoved` 用来广播 BCAST_TAB_CHANGE。M4 要把 tab 事件也接到 TimeTracker（`onActivateTab` / `onRemoveTab` / `onUpdateUrl`）。

**决定**：**不复用** tabRegistry 的 listener 去分发给 TimeTracker。sw.js 在 bootstrap 时额外注册一份独立的 `chrome.tabs.onActivated/onRemoved/onUpdated` listener，专门喂给 TimeTracker。

**理由**：
- 分工清晰：tabRegistry = 元数据登记，TimeTracker = 时间追踪，**不共享 listener 降低耦合**
- tabRegistry 不持有 TimeTracker 的引用，反之亦然；都只接收 sw.js 路由过来的调用
- Chrome 允许多个 listener 注册同一事件，性能影响可忽略（同事件 O(2) 回调）
- 未来如果 TimeTracker 的事件订阅策略变化（例如只对 active window 的 tab 响应），不会污染 tabRegistry

**实现位置**：`background/sw.js::registerTabEventsForTracker()`。

## D14. TimeTracker 测试走 DI，不依赖 chrome.tabs（M4 落地，2026-04-20）

**决定**：`timeTracker.init({ nowProvider, tabInfoProvider, emit })` 接受三个可注入依赖。测试里：
- `nowProvider` 注入可控时钟（不用 Date.now）
- `tabInfoProvider` 注入假 tabInfo Map（不走 tabRegistry，也就不需要 mock `chrome.tabs.query`）
- `emit` 注入 null（测试不验证广播）

**理由**：
- ES module 的 named export 不可覆盖（`import * as mod` 是只读 namespace），不能 monkey-patch tabRegistry.get
- DI 让 timeTracker 单测化：mock chrome.storage + 注入两个函数就能跑
- 生产代码零损耗：sw.js 传真 tabInfoProvider，行为等价

**测试覆盖**（`extension/tests/timeTracker.test.js`）：15 个用例，已通过 Node 模拟运行（`/tmp/tempus-node-runner.mjs` 一次性脚本），覆盖 §9.2 全清单：基本累加、多窗口 focus、pauseReasons 多源叠加、Private Mode/黑名单 pause、SW 重启恢复（含 ALARM_PERIOD_S*2 上限）、URL 变更、单调性宏观断言（200 次随机事件序列）。

## D15. "已关闭 tab 的 cumulative 归零"语义（M4 落地，2026-04-20）

**背景**：`onRemoveTab(tabId)` 时除了 finalize 最后一段 slice，还会 `tabCumulativeMs.delete(tabId)`。

**决定**：tab 关闭即从 cumulative Map 里清除该 tabId，前端再查 `getTabCumulativeMs` 会拿到 0。"永久真相"全部落在 timeLog。

**理由**：
- v2 的 cumulative 语义是"**当前 open 这一条 tab 从打开到现在的 lifetime**"——tab 关了就没有 open 的概念
- 历史统计视图从 timeLog 取数据（slice 已 finalize 落盘），不受此影响
- 避免 Map 无限膨胀（用户一天可能开关几百个 tab）
- UI 端 BCAST_TAB_CHANGE 的 `removed` 事件会通知 UI 删除 chip，不会再去查 getTabCumulativeMs

**反例**：v1 曾想让"关了 30s 再开同 URL"累计延续，导致需要持久化 tab lifetime 跨 tabId——那是个复杂度陷阱，v2 断然拒绝。

## D16. `todayCache` 1 秒粗缓存，不做更精巧的失效（M4 落地，2026-04-20）

**背景**：`getTodayTotalMs()` 被 BCAST_TICK 每秒调一次。内部要读 timeLog 做聚合，每秒一次 storage IO 浪费。

**决定**：模块级 `todayCache = { ts, historicalMs }`，1 秒内直接复用；超过 1 秒重查 timeLog。不实现"当有新 slice 写入时主动失效缓存"这种复杂逻辑。

**理由**：
- timeLog 的 slice 通常 ≥ 几秒（finalize 发生在 tab 切换/pause 时），1 秒内新 slice 落盘但 cache 还没刷新 → 下一秒必然刷新，最多延迟 1s
- 同等开销下写更简单的代码 > 炫技

---

## D17. 时间模型收敛：单一时间账本（Time Ledger），废止 `tabCumulativeMs`（2026-04-20 深夜，M4.5 前置决策）

**背景**：M4/M5 落地后复盘发现两类活体 bug 反复出现——
- Bug 1：切 tab 瞬间 chip 数字从 `5s` 掉回 `3s` 再向上跳（缓存与 cumulative 写入时序错位）
- Bug 2：播 B 站视频但物理不动键鼠，60s 后 chrome.idle 触发暂停（把"看视频"误判为"离开")

同期邓老师拉了对手项目 `web-activity-time-tracker`（Vue + TS + 每秒 setInterval tick）做对照研究。三方对比（对手 A / 我们当前 B / 理想 D）后得出结论：**双账本（timeLog 明细 + tabCumulativeMs 聚合快照）是所有同步型 bug 的根源**，且这份聚合在数学上完全冗余——timeLog 能回答的问题是它的超集。

**决定**：v2.0 正式发布前引入 **M4.5 架构收敛** milestone，把时间模型从"双账本"收敛为"单一时间账本"。

### 新模型精确定义

**唯一可变状态（in-memory，SW 进程内）**：
```js
currentSlice = {
  start: number,          // ms timestamp
  domain: string,
  tabId: number,
  // pauseReasons 保留在 TimeTracker 模块级，不塞进 slice
} | null
```
`null` 表示当前不在计时（被任一 pauseReason 暂停、或无 active tab）。

**唯一持久化状态（storage）**：
```
chrome.storage.local['timeLog.YYYY-MM'] = [
  { s: startTs, e: endTs, h: hostname, tid: tabId },
  ...
]
```
append-only，按月分片，继承 v1.3.5 策略。

**所有时长查询 = 纯函数**：
```js
getTodayTotalMs()          = Σ(今日 timeLog slice 的 e-s) + (currentSlice ? now - start : 0)
getTabCumulativeMs(tid)    = Σ(timeLog filter tid) + (currentSlice?.tabId === tid ? now - start : 0)
getDomainTodayMs(domain)   = Σ(timeLog today filter h=domain) + (currentSlice?.domain === domain ? now - start : 0)
getHourlyBuckets(dateKey)  = reduce(timeLog[dateKey], 切 24 桶)
```

**slice 生命周期事件**：
```
应该计时 → 应该不计时：finalizeCurrentSlice()
  → timeLog append {s: slice.start, e: now, h, tid}
  → currentSlice = null
应该不计时 → 应该计时：startCurrentSlice({domain, tabId})
  → currentSlice = {start: now, domain, tabId}
domain/tab 切换：finalize 旧 + start 新（两步原子，中间不对外发 TICK）
chrome.alarms 30s tick：若 currentSlice 已持续 > ALARM_PERIOD_S*2，强制 finalize + 立即 start 新 slice
  （防 SW 被 suspend 前吞掉一整段长 slice）
```

### 废止/替代的旧决策（显式列出避免歧义）

| 旧条目 | 状态 | 替代 |
|---|---|---|
| **D7.1**（TimeTracker 是唯一能写 tabCumulativeMs 的模块）| 🗑️ 废止 | 字段本身消失，无需此铁律 |
| **D7.2**（tabCumulativeMs 单调计数器，只允许 +=）| 🗑️ 废止 | 同上；单调性由 timeLog append-only 自动保证 |
| **D15**（tab 关闭即清除 cumulative Map）| 🗑️ 废止 | Map 不存在，timeLog 永久保留该 tabId 的 slice |
| **D16**（todayCache 1 秒粗缓存）| ⚠️ 降格 | 可选优化而非必需；纯函数 reduce N 条 slice（N 通常 < 几千）性能足够；若实测 BCAST_TICK CPU 占用偏高再加 |

**保留不动的决策**：D1-D6、D8-D14 全部保留。D9 pauseReasons Set、D10 消息协议、D11 UI 订阅式增量、D13 事件路由独立、D14 DI 测试策略——这几条是本次收敛的基座，不受影响。

### 为什么选 D 而不是选项 C（学对手）

| 维度 | A（对手 setInterval） | C（学对手 + timeLog 辅助） | D（单一账本） |
|---|---|---|---|
| MV3 suspend 吞时间 | ❌ 会吞 | ❌ 仍会吞（核心仍是 tick） | ✅ 最多丢 alarm 周期 |
| 数字倒退 | ❌ 不会 | ❌ 不会 | ✅ 数学上不可能（append-only 纯函数）|
| 账本数量 | 1 主 + 1 辅 | 2（summary + timeLog）| **1（timeLog）** |
| 需要编程铁律数 | 0-1 | 2-3 | **0**（数据结构本身约束）|
| 审计/回溯 | 差 | 好 | 好 |

**结论**：C 是"A 的简单 + B 的审计能力"但 MV3 硬伤没解；D 是"B 的架构收敛"——把冗余字段砍掉，所有同步 bug 连带消失。

### Bug 消失证明

**Bug 1（切 tab 数字回退）**：切 tab 瞬间 `finalize → append timeLog → start 新 slice`，UI 下一帧 `getTodayTotalMs()` 重算 = `Σ(已 append) + (now - newSliceStart)` ≥ 切 tab 前的值。**数学上不可能回退**。

**Bug 2（audible 豁免）**：idle 事件入口加一道 `if (newState === 'idle' && activeTab.audible) return`，`pauseReasons.add('idle')` 被跳过。与账本模型正交，同样适用于 D。

### 执行节奏（写入 REWRITE-PLAN-v2.md）

- **M4.5**（单独一个 milestone，原子 commit）：
  - 删除 `tabCumulativeMs` Map 及所有相关方法
  - `getTodayTotalMs` / `getTabCumulativeMs` / 新增 `getDomainTodayMs` / `getHourlyBuckets` 全部改为从 timeLog 现算
  - 重写 `tests/timeTracker.test.js`（M4 的 15 个用例 + 新增 Bug 1 回归用例）
  - 集成 audible 豁免（M4.5 顺手带一起）
  - 集成 chrome.idle 阈值用户可选（默认 180s = 3 分钟）
  - sw.js 的广播 payload 不变，UI 层 API 完全不变——M5 理论上无感
- **M5 回归**：真机跑一遍 M5 真机验收清单，确认无回归
- **M6 历史统计**：在干净账本基座上写，一次写对

### 测试要求

`tests/timeLedger.test.js`（新）必须覆盖：
- 纯函数正确性（固定 timeLog + currentSlice，多断言聚合值）
- 单调性宏观断言（200 次随机事件序列后，对任意时刻查询 `getTodayTotalMs` 结果单调非减）
- **Bug 1 回归用例**：模拟 tab 切换事件 + 立即查询，断言数字不回退
- SW 重启恢复（清空 in-memory，重算得到相同聚合值——这是 D 模型的"免费"属性）
- 月界切换（23:59:59 → 00:00:00 跨月分片）

### 锚点保护

M4.5 开工前，当前 `rewrite-v2` HEAD（M5 commit `52e7d1c`，37/37 测试通过，真机验收过）是回滚锚点。M4.5 commit 出问题可一键 reset 回此锚点，不影响 M5 UI 层代码。

---

## D18. 不计时域名（Excluded Domains）：永久域名黑名单（2026-04-20 深夜，2026-04-20 23:15 修订）

> ⚠️ 本条目早先把"不计时域名"与"Private Mode"揉在一起叙述，邓老师澄清后已修订。两者是**正交**关系，各自职责独立，见本条 + D22。

**定义**：不计时域名是一个**永久域名级黑名单**——只要某域名被加入此列表，**无论 Private Mode 开关是否打开、无论何时**，该域名永远不计时。

**使用场景**：
- 银行官网、企业内网、医疗问诊等敏感页面——用户永远不想记录这些域名的停留时长
- 不是"临时关一下"，而是"这个域名在我的时间账单里永远不出现"

**与 Private Mode 的区别**（两者完全正交）：

| 维度 | 不计时域名 | Private Mode |
|---|---|---|
| 作用对象 | **指定域名**（列表内） | **所有域名**（全局） |
| 生效条件 | **永久**（只要在列表里） | **临时**（开关打开 + 时长窗口内）|
| 用户心智 | "这网站我永远不想被追踪" | "我现在这一会儿不想被追踪" |
| 实现源 | `pauseReasons.add('excluded-domain')` | `pauseReasons.add('private-mode')` |
| 检查时机 | 每次 domain 切换（`onActivateTab` / `onUpdated`）| 开关切换 / 窗口到期 |

**联合语义**：两者都是 `pauseReasons` Set 的独立源，**任一命中即暂停**（Set.size > 0 = 暂停，无优先级，见 D9）。二者可同时生效但互不依赖：
- Private Mode 关着 + 域名在不计时列表 → 仍不计时
- Private Mode 开着 + 域名不在不计时列表 → 仍不计时（被 Private Mode 拦下）
- 两者都命中 → `pauseReasons` 里有两条，关掉一个另一个仍在

**数据结构**：
```js
chrome.storage.local:
  excludedDomains: Array<string>   // e.g. ['icbc.com.cn', 'intranet.company.com']
```

**UI 命名**：
- 设置页栏目标题：**"不计时域名"**
- 加入入口：域名卡右键菜单 "永不计时此域名" / 设置页手动输入

**版本归属**：v2.0 M8（与 Private Mode、Focus Timer 一起，三者共享 pauseReasons 架构）。

---

## D19. 域名分类标签化：预置 6 类 + 用户可维护（v2.1 规划，2026-04-20 深夜）

**背景**：对手实现了"单域名限时"（youtube.com 每天 1h）。我们差异化方向是**"分类组限额"**（🎮 娱乐组每天 2h，组内可含 youtube + bilibili + twitter），更贴近用户对"时间预算"的真实心智模型。

**决定**：v2.1 引入域名分类系统，**预置 6 个常见标签 + 用户可维护**（不走纯白纸路线，避免冷启动痛苦）。

### 预置分类（首次启动写入 storage）

```js
[
  { id: 'work',          name: '工作', emoji: '🎯', color: '#3B82F6', builtin: true },
  { id: 'learning',      name: '学习', emoji: '💡', color: '#10B981', builtin: true },
  { id: 'entertainment', name: '娱乐', emoji: '🎮', color: '#F59E0B', builtin: true },
  { id: 'social',        name: '社交', emoji: '💬', color: '#EC4899', builtin: true },
  { id: 'shopping',      name: '购物', emoji: '🛒', color: '#8B5CF6', builtin: true },
  { id: 'news',          name: '资讯', emoji: '📰', color: '#6B7280', builtin: true },
]
```

### 数据结构

```js
chrome.storage.local:
  categories: Array<{id, name, emoji, color, builtin}>
  domainCategories: { [domain]: categoryId }  // 未在此 map 中的域名 = "未分类"
```

### 三个核心交互

1. **打标签**：域名卡 hover → 右上角 🏷️ → popover 弹出预置+用户分类 → 点选即完成
2. **分类管理**：设置页"分类管理"栏目，支持新建 / 编辑（改名+emoji）/ 删除（删除时警告 N 个已归类域名将变为未分类）
3. **视图分组**：Dashboard 支持"按分类聚合"切换（与 v2.0 的"按域名"视图并列）

### 为什么不预置域名→分类映射

- 文化差异：bilibili/微博/知乎国内常用，海外用户不认识
- 语义歧义：youtube 对张三是娱乐、对李四是学习，默认归哪边都有人不爽
- 首次打标签的"轻仪式感"让用户觉得这个分类是"自己的"
- 常用域名实际就 20-30 个，打一轮 5 分钟

### 组限额（v2.1 配套功能）

基于分类系统，限时页支持两种规则并行：
- 单域名限额：`youtube.com → 1h/day`
- 分类限额：`🎮 娱乐 → 2h/day`

命中策略：两者都检查，取**严格更小**的那条触发 block（限时 block 机制见 D21）。

**独立价值**：即使用户不用限额功能，分类系统本身驱动的"按分类视图"就是对手完全没做的产品增量（"我今天娱乐 3h vs 工作 5h 的时间分布"）。

---

## D20. chrome.idle 阈值用户可选，默认 3 分钟（2026-04-20 深夜）

**决定**：v2.0 M4.5 顺手加一个"空闲检测阈值"设置，用户可选 `30s / 1min / 3min / 5min / 10min / 关闭`，默认 **3 分钟**（180s）。

**理由**：
- 对手默认 30s，但实测 30s 阈值对"读长文 / 盯设计稿"场景过激进
- 3 分钟在"真的离开"和"阅读专注"之间有更好平衡
- 不同用户工作节奏差异巨大（程序员盯代码、研究者读论文、设计师盯 Figma），让用户自调比拍脑袋合理
- "关闭"选项给极端用户（完全不想要 idle 暂停的）一个逃生口

**实现**：
- `chrome.idle.setDetectionInterval(userSetting)` 在设置变化时重调
- D4 写的"60s"废止，以此决策为准
- 设置存 `chrome.storage.local['settings.idleThresholdSec']`

**配合 audible 豁免**：idle 事件到达时先检查 active tab 是否 audible，audible=true 则不 add pauseReason。两者叠加 = 基本覆盖所有"误暂停"场景。

---

## D21. 限时 block 机制：到点跳转插件自带 block 页面（v2.1 规划，2026-04-20 深夜）

**背景**：对手的限时实现非常巧妙——不用 webRequest/declarativeNetRequest，就是每秒 tick 里判断"当前域名今日累计 >= 限额？是 → `chrome.tabs.update(tabId, {url: 'block.html?...'})`"。零额外权限，和计时逻辑共用 tick。

**决定**：v2.1 采用同样思路，但**检查触发点不是每秒 tick**（v2 没有 tick，是事件驱动），而是：
- `finalizeCurrentSlice` 后立即检查 `getDomainTodayMs` 是否超限
- `BCAST_TICK` 广播前（SW 端）顺手检查一次
- 用户主动切到该域名 tab 时（`onActivateTab`）检查一次

**block 页面**：`extension/block.html`，简单的"你今天在 X 已经使用 Y，上限 Z，推迟 5min / 10min / 今日不再提醒"。

**推迟机制**：`chrome.storage.session['deferUntil']` 记录到期时间，TimeTracker 的超限检查跳过期内。

**版本归属**：v2.1（和到时通知、域名分类组限额一起）。

---

## D22. Private Mode：全局临时关闸，与"不计时域名"正交（2026-04-20 23:15 修订补丁）

**定义**：Private Mode 是一个**全局临时开关**——打开后在用户选定的时长窗口内（如 30 分钟 / 1 小时 / 自定义），**所有域名都不计时**；时长到期自动关闭，恢复正常追踪。

**使用场景**：
- "我现在要刷一会儿不想被记录的内容，15 分钟后自动恢复"
- 临时浏览不希望进入时间账单的内容（不限定哪个域名）
- 与隐私意图相关的"时段级"关闸

**与不计时域名的关系**：两者完全正交（参见 D18 对照表）：
- Private Mode = **时段维度**全局关闸（某一段时间全关）
- 不计时域名 = **域名维度**永久关闸（某些域名永远关）
- 二者在 `pauseReasons` Set 里是独立源，互不依赖

**数据结构**：
```js
chrome.storage.session:
  __privateModeEndTime: number | null   // 到期时间戳；null = 未启用
  // 用 session 而非 local：SW 重启后自然失效，符合"临时"语义（沿用 v1 设计）
```

**生效流程**：
1. 用户在 UI 点"开启 Private Mode" + 选择时长 → `__privateModeEndTime = now + duration`
2. TimeTracker 模块每次查询 `pauseReasons` 时检查 `__privateModeEndTime > now` → 是则 add `'private-mode'`
3. chrome.alarms 定期检查（或下一次事件触发时检查），过期即移除该 pauseReason，广播 UI 更新
4. 用户也可手动关闭（提前结束）

**UI 视觉**：开启期间 Header 显示明显的"🔒 隐私模式 · 剩余 N 分钟"提示条，并改变主色调区分。

**与对手的差异**：对手项目 `web-activity-time-tracker` 没有这个功能——他们只有"白名单"（= 我们的"不计时域名"）。Private Mode 是 v1 就有的 Tabpus 原生功能，v2 完整移植，见 `v1-feature-reference/private-mode.md`。

**版本归属**：v2.0 M8。

---

## D23. 致谢参考项目：`web-activity-time-tracker`（2026-04-20 23:15）

**决定**：在项目所有对外文档（README.md / README.zh-CN.md / CHANGELOG.md / DECISIONS-v2.md）和 GitHub 仓库页面加入对参考项目的致谢。

**致谢对象**：
- **项目名**：web-activity-time-tracker
- **GitHub**：https://github.com/brave-tools/web-activity-time-tracker（Chrome Web Store 上架的开源时间追踪扩展，Vue + TS 实现）
- **我们从它身上学到了什么**：
  - `chrome.idle` API 的正确用法 + audible 豁免思路
  - 限时 block 的极简实现路径（`chrome.tabs.update` 跳转 block.html，零额外权限，见 D21）
  - "差异化设计 = 分类组限额" 的灵感反证（对手做了单域名限额，促使我们想到组限额）
  - 通过对照其架构，反向锁定了我们的单一时间账本模型（D17 选 D 不选 C 的关键推手）

**致谢位置**：
1. `README.md` / `README.zh-CN.md`：新增 "Acknowledgments" / "致谢" 章节
2. `CHANGELOG.md` v2.0.0 条目：列出启发来源
3. GitHub 仓库描述 / About 区：简短提及
4. 本文档（D23 本条即为致谢记录）

**版权原则**：
- 我们**未使用其任何代码或资源**（两者栈完全不同：对手 Vue/TS/webpack，我们纯原生 ES Module）
- 致谢出于产品思路启发的感谢，不是代码 License 合规要求
- MIT 协议下即使 copy 代码也只需保留 LICENSE，但我们没 copy，纯粹主动感谢

---

_Last updated: 2026-04-20（M4 完成后深夜补丁 #001+#002，追加 D17-D23，覆盖时间模型收敛、Private Mode 与不计时域名正交定义、功能分版、参考项目致谢）_


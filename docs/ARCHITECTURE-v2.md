# Tabpus v2 — 架构设计

> 本文档是 v2 rewrite 的**设计真相源**。动手前先读它，动手中发现不对先改它，再改代码。

## 📍 M0 冻结状态（2026-04-20）

- ✅ 所有核心模块接口签名已冻结（§3）
- ✅ TimeTracker 采用 pauseReasons Set 多源暂停模型（§3.1）
- ✅ 消息协议采用混合式（请求 REQ_* + 广播 BCAST_*，§5）
- ✅ 存储 schema 严格定义（§6）
- ✅ UI 初始化流程规范（§8）
- ✅ TimeTracker 测试用例清单（§9.2）

**接口一旦冻结，v2.0 开发期间不允许随便改。** 写代码发现设计有问题，必须先回来改这份文档 + `DECISIONS-v2.md` 里追加决策记录，再改代码。

---

## 1. 设计目标

1. **模块边界清晰**：每个文件单一职责，不超过 ~400 行。
2. **时间逻辑零歧义**：只有 `TimeTracker` 可以改 `tabCumulativeMs`；数学上单调不可逆。
3. **零依赖**：纯浏览器 ES Module，`<script type="module">` 直接 import/export，不引入 npm、构建、TS。
4. **前后端分离**：Service Worker（`background/`）只管状态真相；new tab page（`ui/`）只管渲染。
5. **可测试**：核心逻辑模块（TimeTracker、Store）能在 Node 或浏览器 console 跑单元测试。

---

## 2. 目录结构

```
extension/
├── manifest.json                 # v3, type:"module" service worker
├── index.html                    # new tab page，只放 <script type="module" src="ui/main.js">
├── style.css                     # 全局样式 + CSS 变量
├── icons/                        # 16/48/128 PNG
├── assets/
│   ├── swoosh.mp3
│   └── confetti.js               # 第三方纯 JS，保留
│
├── background/                   # Service Worker 世界
│   ├── sw.js                     # 入口：只做事件路由，不写业务
│   ├── timeTracker.js            # ✨ 核心：维护 tabCumulativeMs + pauseReasons Set
│   ├── focusModel.js             # chrome.windows.onFocusChanged 单一焦点
│   ├── idleGuard.js              # chrome.idle 键鼠空闲守护（60s 阈值）
│   ├── privateMode.js            # 隐私计时窗口（pause('private-mode')）
│   ├── blacklist.js              # 域名黑名单（监听 active tab → pause('blacklist')）
│   ├── focusTimer.js             # 番茄钟（strict 模式复用 blacklist 机制）
│   ├── tabRegistry.js            # tabId ↔ url/title/favicon 元数据
│   ├── timeLog.js                # timeLog.YYYY-MM 分片读写（含写入队列）
│   ├── store.js                  # chrome.storage 封装（local/session 双命名空间）
│   └── alarms.js                 # 30s 周期刷盘 / 跨 SW 重启补算
│
├── ui/                           # New tab page 世界
│   ├── main.js                   # 入口：初始化各 view，订阅 SW 广播
│   ├── messaging.js              # 与 SW 通信封装（chrome.runtime.sendMessage）
│   ├── views/
│   │   ├── tabsGrid.js           # 域名分组网格
│   │   ├── homepagesGroup.js     # Homepages 特殊分组
│   │   ├── header.js             # "今日工作" + 时间
│   │   ├── sidebar.js            # Save for Later
│   │   ├── historyView.js        # Today/Week/Month/Year 切换
│   │   ├── heatmap.js            # 24 小时热力图
│   │   ├── focusTimer.js         # 番茄钟
│   │   └── blacklistSettings.js  # 黑名单配置面板
│   ├── components/
│   │   ├── tabChip.js            # 单个 tab chip（含时长 badge）
│   │   ├── domainCard.js         # 域名卡
│   │   ├── confettiBurst.js      # 关闭动效
│   │   ├── privateModeWidget.js  # 隐私模式倒计时悬浮层
│   │   └── stateBadges.js        # 顶栏状态指示（pause reason / focus timer 残留时间等）
│   └── utils/
│       ├── formatDuration.js     # 时长格式化（<1m / 5m / 2h 10m）
│       ├── domain.js             # URL → hostname 分组规则
│       └── dom.js                # createElement helper
│
├── shared/                       # SW 和 UI 都用
│   ├── constants.js              # 魔法数字：ALARM_PERIOD_S、HOMEPAGES_HOSTS、...
│   ├── types.js                  # JSDoc 类型定义（用 @typedef 代替 TS）
│   └── messages.js               # 消息类型常量（MSG_GET_TABS 等）
│
└── tests/                        # 手动跑的单元测试（纯浏览器 console）
    ├── timeTracker.test.js
    ├── timeLog.test.js
    └── runTests.html             # 打开它会自动跑所有测试并输出结果
```

**关键点：** SW 端 (`background/`) 与 UI 端 (`ui/`) **不共享可变状态**，只通过消息通信。`shared/` 只放**常量和类型**。

---

## 3. 模块接口契约（v2.0 冻结）

### 3.1 `background/timeTracker.js` — 时间追踪核心

```javascript
// ========== 内部状态 ==========
// tabCumulativeMs: Map<tabId, number>   —— 单调计数器，只允许 +=
// activeTabId:     number | null        —— 当前正在计时的 tab（null 表示暂停中）
// activeSliceStart: number | null       —— 当前 slice 的开始时间戳（ms）
// hostnameLastSeenMs: Map<hostname, number>
//
// pauseReasons: Set<PauseReason>        —— ✨ 暂停原因集合
//   只要 Set 非空 → 暂停。Set 清空 → 恢复。
//   多源叠加（例：窗口失焦 + idle 同时触发，任一解除都不会立刻恢复）。
//
// type PauseReason =
//   | 'window-blur'     // Chrome 失焦（focusModel 报告）
//   | 'idle'            // chrome.idle 键鼠空闲 60s+
//   | 'private-mode'    // 用户启动了隐私计时窗口
//   | 'blacklist'       // 当前 active tab 的 hostname 在黑名单里
//   | 'no-active-tab'   // 焦点窗口没有 active tab（启动间隙）
//
// 状态机语义：
//   resume(reason)：pauseReasons.delete(reason)；若 Set 空且有焦点 tab → 开 slice
//   pause(reason)：pauseReasons.add(reason)；若当前在计时 → finalize slice
//
// 所有"改变追踪行为"的功能（window focus / idle / private mode / blacklist /
// focus timer 里的 "strict mode"）都走 pause/resume(reason)，不直接改状态。

// ========== 事件入口（由 sw.js 路由调用） ==========
export function onFocusWindow(windowId);          // 窗口焦点变化，内部调 pause/resume('window-blur')
export function onActivateTab(tabId, windowId);   // tab 激活；触发 hostname 变化 → 重新评估 blacklist
export function onRemoveTab(tabId);               // tab 关闭：finalize slice → timeLog，清 cumulative
export function onUpdateUrl(tabId, oldUrl, newUrl); // URL 变化，可能切 hostname 或触发 blacklist

// ========== 暂停/恢复控制（给其它模块调用） ==========
export function pause(reason);                    // reason: PauseReason
export function resume(reason);
export function isPausedBy(reason);               // 查询某个原因是否在 Set 里
export function getPauseReasons();                // 返回当前所有暂停原因（只读快照，给 UI 诊断显示）

// ========== 纯读接口（给 UI 用） ==========
export function getTabCumulativeMs(tabId);
export function getActiveRunningMs();             // 当前未 finalize 的 slice 时长
export function getTodayTotalMs();                // Header "今日工作"（含 historical + running）
export function getHostnameTotalMsForOpenTabs(hostname);
export function getTrackingState();               // {isActive, activeTabId, pauseReasons, sliceStart}

// ========== 周期性行为 ==========
export function tick();                           // alarms 调用：写快照、finalize 过老 slice
export function init();                           // SW 启动时：load snapshot + 注册 listeners
```

**不变式（写进每个相关函数的 JSDoc）：**
- `getTabCumulativeMs(id)` 在同一 tab 生命周期内**单调不降**。
- `finalize` 只做 `+=`，永远不覆盖写。
- 所有外部模块**只读**，禁止 push 进来改 cumulative。
- **pauseReasons 非空 → 绝不开新 slice**；恢复必须 Set 清空后才发生。
- 任何让"追踪行为改变"的功能都必须走 `pause(reason)` / `resume(reason)`，**不允许绕过暂停机制直接改 activeTabId**。

### 3.2 `background/focusModel.js` — 焦点真相源

```javascript
export let focusedWindowId; // null = Chrome 不在焦点（用户切出到其它 app）

export function init();                         // onStartup/onInstalled/SW 唤醒都要调
export function onWindowFocusChanged(windowId); // 唯一入口
export function isFocused();
```

### 3.3 `background/timeLog.js` — 历史分片存储

```javascript
// 存储形式：chrome.storage.local["timeLog.2026-04"] = [{s, e, h, tid}, ...]
export async function appendSlice({start, end, hostname, tabId}); // 串行化写入队列
export async function queryRange(startTs, endTs);                 // 跨月聚合
export async function getMonthShard(yearMonth);
```

### 3.4 `background/store.js` — storage 封装

```javascript
export const local  = { get, set, remove, getMany };
export const session = { get, set, remove };
// 统一处理错误、JSON 序列化、兜底默认值
```

### 3.5 `background/idleGuard.js` — 键鼠空闲守护

```javascript
// 封装 chrome.idle.setDetectionInterval + onStateChanged
// 状态变化时调 timeTracker.pause('idle') / resume('idle')

export function init();                           // 注册 chrome.idle listener，阈值 60s
export function isIdle();                         // 当前是否在 idle 状态
// 内部事件：'active' → resume('idle')；'idle'/'locked' → pause('idle')
```

**设计要点：**
- 阈值 60s 写死在 `shared/constants.js` 的 `IDLE_THRESHOLD_SEC`。
- 不做复杂策略，只是 pauseReason 的一个来源。
- `locked` 和 `idle` 等价处理（都暂停）。

### 3.6 `background/privateMode.js` — 隐私计时窗口

```javascript
// 存储：chrome.storage.local["privateMode"] = {endTime: number} | null
//   SW 重启后从 storage 恢复；过期则自动清掉并 resume('private-mode')

export async function start(durationMin);         // endTime = now + durationMin*60000; pause('private-mode')
export async function stop();                      // 手动结束；clear storage; resume('private-mode')
export async function getStatus();                 // {active, endTime, remainingMs} | null
export function init();                            // SW 启动：读 storage，若未过期注册 alarm 到 endTime
// 内部：到期 alarm 触发 → stop()
```

**与 TimeTracker 的关系：**
- 启动后只往 TimeTracker 喊 `pause('private-mode')`，自己不管时间状态。
- 到期 alarm 也只是 `resume('private-mode')`。
- 活跃期间所有 onActivate/onFocus 事件正常流转，TimeTracker 知道自己暂停着不会累加。

### 3.7 `background/blacklist.js` — 域名黑名单

```javascript
// 存储：chrome.storage.local["blacklist"] = string[]（hostname 列表）

export async function getList();
export async function add(hostname);
export async function remove(hostname);
export async function isBlocked(hostname);
export function init();                            // 订阅 TimeTracker 的 activeTab 变化，自动 pause/resume('blacklist')
```

**设计要点：**
- 黑名单逻辑**不**嵌入 TimeTracker，独立模块监听 active tab 变化。
- 切到黑名单 tab → `pause('blacklist')`，切走 → `resume('blacklist')`。
- `isPausedBy('blacklist')` 让 UI 可以显示 "this site isn't being tracked" 提示。

### 3.8 `background/focusTimer.js` — 番茄钟

```javascript
// 存储：chrome.storage.local["focusTimer"] = {startTime, durationMs, strict} | null

export async function start(durationMin, {strict = false});
export async function stop();
export async function getStatus();                 // {active, remainingMs, strict} | null
export function init();
// strict=true 时：期间对非白名单 hostname 自动 pause('blacklist')（复用同机制）
// strict=false 时：只是个计时器，不干预追踪
```

### 3.9 `ui/messaging.js` — 跨边界通信（混合模式）

```javascript
// ========== 请求式（一次性读取） ==========
export async function getTabs();                   // → {domains: [...], homepages: [...]}
export async function closeTab(tabId);
export async function getTodayWork();              // → {totalMs, breakdown}
export async function getHistoryRange(start, end); // → {slices, heatmap}
export async function getSaved();
export async function saveForLater(tabId);
export async function removeSaved(id);
export async function startFocusTimer(min, opts);
export async function startPrivateMode(min);
export async function getTrackingDiagnostics();    // 调试用：pauseReasons 等

// ========== 订阅式（SW 主动广播） ==========
// SW 通过 chrome.runtime.sendMessage 广播，UI 通过 onMessage 接收
export function subscribeTick(cb);                 // 每秒一次，cb({now, todayMs, activeTabMs})
export function subscribeTabChange(cb);            // tab 打开/关闭/URL 变化，cb({action, tabInfo})
export function subscribeStateChange(cb);          // pauseReasons / privateMode / focusTimer 变化

// 每个 subscribe 返回 unsubscribe 函数
```

**广播频率约束：**
- `tick` 1 秒一次，只带最小 payload（now + 几个数字），渲染层自己决定用不用
- `tabChange` 事件驱动（不周期广播）
- `stateChange` 事件驱动（pauseReasons Set 变化时才发）

---

## 4. TimeTracker 数据模型（核心中的核心）

### 4.1 两层时间存储

| 层次 | 存储位置 | 用途 | 寿命 |
|---|---|---|---|
| **Slice 明细** | `chrome.storage.local["timeLog.YYYY-MM"]` | 历史统计视图数据源 | 永久 |
| **Tab 累计计数器** | SW 内存 `tabCumulativeMs` + `chrome.storage.local["__tabCumulative"]` 周期快照 | chip badge / 域名卡时长 | 到 tab 关闭 |
| **当前 slice** | SW 内存 `activeTabId + activeSliceStart` | 正在进行的未落盘片段 | 毫秒级 |

### 4.2 事件流

```
用户切到 Chrome 窗口 A 的 tab X:
  focusedWindowId = A
  finalizeActiveSlice()           # 把 [oldStart, now] 写入 timeLog + tabCumulativeMs[oldActive] += Δ
  activeTabId = X
  activeSliceStart = now
  
用户切出到其它 app:
  focusedWindowId = null (WINDOW_ID_NONE)
  finalizeActiveSlice()           # 暂停，不开新 slice
  activeTabId = null
  
alarms 每 30s:
  if (activeTabId) {
    // 不 finalize，但写一份快照到 storage.local，用于 SW 重启恢复
    persistRunningSnapshot({tabId, sliceStart, now});
  }
  
SW 冷启动:
  loadSnapshot() → 如果有活 slice，finalize 到 now（丢失的时间最多 30s）
  initFocusedWindow() → 查当前焦点，如果有就开新 slice
```

### 4.3 `tabCumulativeMs` 的单调性保证

**禁止：** 任何地方做 `tabCumulativeMs[id] = X` 的赋值（除 init）。  
**唯一合法操作：** `tabCumulativeMs[id] += delta`（delta ≥ 0）。  
**测试用例：** `timeTracker.test.js` 要覆盖：
- 普通 active → inactive 转换，cumulative 正确累加
- 快速来回切 tab，不丢不重
- SW 重启中途，最多丢 30s
- Chrome 失焦期间不累加
- `onUpdateUrl` 改 hostname 时，旧 slice finalize 到旧 hostname，新 slice 算新 hostname

### 4.4 域名卡时长 = Σ(tab)

```javascript
function getHostnameTotalMsForOpenTabs(hostname) {
  let total = 0;
  for (const [tabId, meta] of tabRegistry) {
    if (meta.hostname === hostname) {
      total += tabCumulativeMs.get(tabId) || 0;
      if (tabId === activeTabId) total += (Date.now() - activeSliceStart);
    }
  }
  return total;
}
```

**注意**：这个是"当前 open tab 的 lifetime 之和"，不是"今天的累计"。如果用户要看今天，走 `timeLog` 聚合。

---

## 5. 消息协议（UI ↔ SW）

**混合模式：请求式（REQ/RES）+ 订阅式（BROADCAST）**

在 `shared/messages.js` 定义所有消息类型：

```javascript
export const MSG = Object.freeze({
  // ===== 请求式：UI → SW → res =====
  // SW 用 chrome.runtime.onMessage 的 sendResponse 回 {ok: true, data} / {ok: false, error}
  REQ_GET_TABS:           'REQ_GET_TABS',           // req: {}, res: {domains, homepages}
  REQ_CLOSE_TAB:          'REQ_CLOSE_TAB',          // req: {tabId}
  REQ_GET_TODAY_WORK:     'REQ_GET_TODAY_WORK',     // res: {totalMs, breakdown}
  REQ_GET_TAB_TIME:       'REQ_GET_TAB_TIME',       // req: {tabId}, res: {cumulativeMs, isActive}
  REQ_GET_HISTORY:        'REQ_GET_HISTORY',        // req: {start, end}, res: {slices, heatmap}
  REQ_SAVE_FOR_LATER:     'REQ_SAVE_FOR_LATER',     // req: {tabId}
  REQ_GET_SAVED:          'REQ_GET_SAVED',
  REQ_REMOVE_SAVED:       'REQ_REMOVE_SAVED',       // req: {id}
  REQ_START_FOCUS_TIMER:  'REQ_START_FOCUS_TIMER',  // req: {durationMin, strict}
  REQ_STOP_FOCUS_TIMER:   'REQ_STOP_FOCUS_TIMER',
  REQ_START_PRIVATE_MODE: 'REQ_START_PRIVATE_MODE', // req: {durationMin}
  REQ_STOP_PRIVATE_MODE:  'REQ_STOP_PRIVATE_MODE',
  REQ_GET_STATE:          'REQ_GET_STATE',          // res: {tracking, privateMode, focusTimer, blacklist}
  REQ_BLACKLIST_ADD:      'REQ_BLACKLIST_ADD',      // req: {hostname}
  REQ_BLACKLIST_REMOVE:   'REQ_BLACKLIST_REMOVE',

  // ===== 订阅式：SW → UI broadcast =====
  // SW 用 chrome.runtime.sendMessage 广播（所有 new tab page 实例都收到）
  BCAST_TICK:          'BCAST_TICK',             // 1s/次, {now, todayMs, activeTabId, activeTabMs}
  BCAST_TAB_CHANGE:    'BCAST_TAB_CHANGE',       // 事件驱动, {action, tabInfo}
  //   action: 'added' | 'removed' | 'updated' | 'moved'
  BCAST_STATE_CHANGE:  'BCAST_STATE_CHANGE',     // 事件驱动, {pauseReasons, privateMode, focusTimer}
});
```

**设计约束：**
- UI 不直接查 `chrome.storage`，统一过 SW（例外：`save-for-later` 读本地 storage 可行，因为无计算）
- REQ 的 sendResponse **必须 return true**（Chrome MV3 异步响应要求）
- BCAST 采用 `chrome.runtime.sendMessage({type: BCAST_*, payload})`，UI `chrome.runtime.onMessage.addListener` 接收
- BCAST_TICK 频率固定 1 秒（由 SW 的 alarms 或 tab 有人监听时才开启的 setInterval 控制，没 listener 时暂停广播以省电）

---

## 6. 存储 Schema（chrome.storage 严格版）

### 6.1 `chrome.storage.local`（跨 SW 重启持久）

| Key | Shape | 说明 |
|---|---|---|
| `timeLog.2026-04` | `Array<{s:number, e:number, h:string, tid?:number}>` | 按月分片的历史 slice；s/e 是 UTC 毫秒时间戳；h 是 hostname；tid 是 tab id（可能已关闭） |
| `__tabCumulative` | `{[tabId]: {firstSeen:number, cumulativeMs:number}}` | TimeTracker 的周期快照，SW 重启时恢复 |
| `__activeSliceSnapshot` | `{tabId, hostname, sliceStart} \| null` | 当前运行中 slice 的快照，SW 冷启动时 finalize 到 now（最多丢 ALARM_PERIOD_S） |
| `saved` | `Array<{id, url, title, favicon, savedAt}>` | Save for Later |
| `privateMode` | `{endTime:number} \| null` | 隐私计时到期时间戳 |
| `focusTimer` | `{startTime, durationMs, strict:boolean} \| null` | 番茄钟状态 |
| `blacklist` | `string[]` | hostname 列表 |
| `config` | `{...}` | 用户配置（预留） |

### 6.2 `chrome.storage.session`（SW 重启会丢，只放"丢了也行"的缓存）

| Key | Shape | 说明 |
|---|---|---|
| `__hostnameLastFocus` | `{[hostname]: timestamp}` | Homepages 分组排序用 |

**原则**：真相源数据一律在 `local`，`session` 只是加速。MV3 下 `session` 在 SW 重启时清空，不能依赖。

### 6.3 版本迁移

- `config` 里预留 `schemaVersion: 2`
- v2.0 首次启动时若检测到旧 v1 格式，给用户一次性清空提示（v1 数据不迁移，因为时间模型完全不同）

---

## 7. Service Worker 生命周期应对（v1 踩过的坑总结）

1. **永远不要用 `setInterval`**。SW 会休眠。用 `chrome.alarms.create('tick', {periodInMinutes: 0.5})`。
2. **启动三入口**都要调 `init()`：`chrome.runtime.onInstalled`, `chrome.runtime.onStartup`, SW 顶层模块 init。
3. **`chrome.storage.session` 不跨 SW 重启**（Manifest V3）。跨重启要持久的数据写 `local`。
4. **写入竞争**：`appendSlice` 必须串行化（Promise 队列），不能并发 get→修改→set。
5. **BCAST_TICK 的广播源**：不能用 `setInterval`（SW 休眠会停）。用 `chrome.alarms` 0.5min 粒度太粗；方案是"有 new tab page 连接着才广播"——
   UI 初始化时发 `REQ_GET_STATE`，SW 记录活跃 port；如有活跃 port，在 SW 唤醒期间用 `setTimeout` 递归模拟 1s tick（只在有 port 时存在，所以不会被 SW 休眠影响到用户不可见的时间）。

---

## 8. UI 初始化流程

`ui/main.js` 是 new tab page 的入口，流程：

```javascript
// 1. 装载基础 DOM（header 占位、tabsGrid 容器、sidebar）
initLayout();

// 2. 一次性取状态（并发）
const [tabs, state, today, saved] = await Promise.all([
  messaging.getTabs(),
  messaging.getState(),
  messaging.getTodayWork(),
  messaging.getSaved(),
]);

// 3. 首次渲染
renderTabsGrid(tabs);
renderHeader({ todayMs: today.totalMs, state });
renderSidebar(saved);

// 4. 订阅 SW 广播（只订阅本 view 关心的）
messaging.subscribeTick(({ now, todayMs, activeTabId, activeTabMs }) => {
  header.updateTodayMs(todayMs);
  tabsGrid.updateActiveTabBadge(activeTabId, activeTabMs);
});

messaging.subscribeTabChange(({ action, tabInfo }) => {
  tabsGrid.applyChange(action, tabInfo);  // diff 更新，不整页重绘
});

messaging.subscribeStateChange((state) => {
  header.updateStateBadges(state);        // pauseReasons / private / focus timer 状态指示
});

// 5. 按需挂载 view（历史视图/热力图在用户点击时才加载数据）
historyView.onOpen(async (range) => {
  const data = await messaging.getHistoryRange(range.start, range.end);
  historyView.render(data);
});
```

**关键约束：**
- 首次渲染 = 请求式拉取一次性快照；之后所有更新走订阅式 diff
- `tabsGrid` 不整页重绘，按 `action` 做增量 DOM 操作
- 历史视图/热力图按需加载，关闭时解绑订阅以免无用广播

---

## 9. 测试策略

### 9.1 `tests/runTests.html`

```html
<!DOCTYPE html>
<script type="module">
  import './timeTracker.test.js';
  import './timeLog.test.js';
  import './pauseReasons.test.js';
  // 每个 .test.js 自注册用例到 window.__tests，最后汇总输出
</script>
```

邓老师用法：
```
1. 在 chrome://extensions 里点 Tabpus v2 的 "检查视图 index.html"
2. Console 里 import('./tests/runTests.html')，或者直接打开 chrome-extension://<id>/tests/runTests.html
3. 看 console 输出 PASS/FAIL
```

### 9.2 TimeTracker 必覆盖测试用例

```
// 基本累加
✓ onActivate → 等 1s → onRemove：cumulative 约等 1000ms
✓ finalize 只 +=，从不覆盖
✓ 同一 tab 多次切入切出，cumulative 严格递增

// 多窗口 focus
✓ 窗口 A focus，切到 B：A 的 active tab finalize，B 的 active tab 开 slice
✓ 窗口失焦（alt-tab 出 Chrome）：pauseReasons 加 'window-blur'，无累加
✓ 重新 focus 回来：pauseReasons 去 'window-blur'，恢复计时

// pauseReasons 多源叠加（关键）
✓ 同时触发 window-blur + idle：Set 里两个 reason
✓ 解除 window-blur 但 idle 还在：依然暂停
✓ 两个都解除才恢复

// Private Mode
✓ start(5 min)：pauseReasons.add('private-mode')，5 min 内无累加
✓ 到期 alarm：自动清除，恢复累加
✓ SW 重启后从 storage 恢复剩余时间

// 黑名单
✓ 切到黑名单域名：pauseReasons.add('blacklist')
✓ 切走：pauseReasons.delete('blacklist')

// SW 重启恢复
✓ 活跃 slice 时 SW 重启：finalize 到 now，最多丢 ALARM_PERIOD_S
✓ Cumulative 从 storage 快照恢复，不归零

// URL 变化
✓ onUpdateUrl 改 hostname：旧 slice finalize 到旧 hostname，新 slice 算新 hostname

// 单调性（宏观断言）
✓ 无论事件序列多诡异，tabCumulativeMs 永远不下降
```

### 9.3 手动回归清单（每次发布前跑）

- [ ] 普通使用 30 分钟，chip 时长准确
- [ ] alt-tab 切出 Chrome 5 分钟，时间不增长
- [ ] 重启 Chrome，时间从上次结束点续上（最多丢 30s）
- [ ] 两个窗口交替切，时间不串
- [ ] 关 tab 后，历史统计视图里能看到这段时间
- [ ] 启动 Private Mode 5 min，期间计时停止，到期自动恢复
- [ ] 把 github.com 加黑名单，切到 github 时 chip 不涨，切走恢复
- [ ] 键鼠静止 60s+（chrome.idle 触发），计时暂停；动鼠标立即恢复

---

## 10. 与 v1 的映射表（迁移时参考）

| v1 位置 | v2 位置 | 备注 |
|---|---|---|
| `background.js::recordTab` | `background/tabRegistry.js::record` | 纯元数据，不碰时间 |
| `background.js::finalize*` / slice 相关 | `background/timeTracker.js` | 全部集中 |
| `background.js::onFocusChanged` | `background/focusModel.js` | 单一真相源；TimeTracker 通过 pause/resume('window-blur') 响应 |
| `background.js::appendTimeLog` | `background/timeLog.js::appendSlice` | 带队列 |
| `app.js::startPrivateMode` (L1620+) | `background/privateMode.js` + `ui/components/privateModeWidget.js` | 逻辑下沉到 SW；UI 只显示倒计时。见 `v1-feature-reference/private-mode.md` |
| `app.js` 黑名单相关 | `background/blacklist.js` + `ui/views/blacklistSettings.js` | 切到黑名单 hostname → pause('blacklist') |
| `app.js::focusTimer` | `background/focusTimer.js` + `ui/views/focusTimer.js` | strict 模式复用 blacklist 机制 |
| `app.js` 前 1000 行（tab 渲染） | `ui/views/tabsGrid.js` + `ui/components/*` | 拆成组件 |
| `app.js` 时长计算 / lifetime 缓存 | **删除**，改从 BCAST_TICK + REQ_GET_TAB_TIME 问 SW | 前端不再算时间 |
| `app.js` 历史视图 | `ui/views/historyView.js` + `heatmap.js` | |
| `app.js` save-for-later | `ui/views/sidebar.js` | |
| `formatDuration` | `ui/utils/formatDuration.js` | 默认最小 1 分钟 |
| `__tabFirstSeen` (session) | `__tabCumulative` (local) | 从 session 换到 local，SW 重启不丢 |

---

## 11. 命名与约定

- 模块文件：`camelCase.js`
- 导出函数：`camelCase`，无默认导出（always named exports）
- 常量：`UPPER_SNAKE`
- 消息类型：`MSG.REQ_*` / `MSG.BCAST_*`（两前缀强制区分请求/广播）
- 日志前缀继续用 `[tempus]`
- 版本号直接跳 `2.0.0`

---

## 12. 下一步

M0 完成的判定标准：**本文档被邓老师读过并认可，每个模块的接口签名都在上面**。  
然后才能进入 M1（动键盘写代码）。

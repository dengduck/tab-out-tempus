# Tab Out Tempus v2 — 架构设计

> 本文档是 v2 rewrite 的**设计真相源**。动手前先读它，动手中发现不对先改它，再改代码。

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
│   ├── timeTracker.js            # ✨ 核心：维护 tabCumulativeMs + 焦点模型
│   ├── focusModel.js             # chrome.windows.onFocusChanged 单一焦点
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
│   │   └── confettiBurst.js      # 关闭动效
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
// 内部状态（SW 内存 + 定期持久化到 storage.local）
// tabCumulativeMs: Map<tabId, number>   —— 单调计数器
// activeTabId:     number | null        —— 当前焦点窗口的 active tab
// activeSliceStart: number | null       —— 当前 slice 的开始时间戳
// hostnameLastSeenMs: Map<hostname, number>

export function onFocusWindow(windowId);       // 窗口焦点变化入口
export function onActivateTab(tabId, windowId); // tab 激活入口
export function onRemoveTab(tabId);             // tab 关闭（finalize slice → timeLog）
export function onUpdateUrl(tabId, oldUrl, newUrl); // URL 变化（可能需要切 hostname）

export function getTabCumulativeMs(tabId);      // 纯读，给 UI 用
export function getActiveRunningMs();           // 当前未 finalize 的 slice 时长
export function getTodayTotalMs();              // Header "今日工作"（含 historical + running）
export function getHostnameTotalMsForOpenTabs(hostname); // 域名卡片时长

// 周期性行为
export function tick();                         // alarms 调用：保存快照、finalize 过老 slice
```

**不变式：**
- `getTabCumulativeMs(id)` 在同一 tab 生命周期内**单调不降**。
- `finalize` 只做 `+=`，永远不覆盖写。
- 所有外部模块**只读**，禁止 push 进来改。

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

### 3.5 `ui/messaging.js` — 跨边界通信

```javascript
export async function getTabs();                       // → SW 聚合结果
export async function closeTab(tabId);
export async function getTodayWork();
export async function getHistoryRange(startTs, endTs);
export function subscribeTimeTick(callback);           // chrome.runtime.onMessage 订阅
```

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

在 `shared/messages.js` 定义所有消息类型：

```javascript
export const MSG = Object.freeze({
  GET_TABS: 'GET_TABS',                     // req: {}, res: {domains: [...], homepages: [...]}
  CLOSE_TAB: 'CLOSE_TAB',                   // req: {tabId}
  GET_TODAY_WORK: 'GET_TODAY_WORK',         // res: {totalMs, breakdown}
  GET_TAB_TIME: 'GET_TAB_TIME',             // req: {tabId}, res: {cumulativeMs, isActive}
  GET_HISTORY: 'GET_HISTORY',               // req: {start, end}, res: {slices, heatmap}
  SAVE_FOR_LATER: 'SAVE_FOR_LATER',         // req: {tabId}
  GET_SAVED: 'GET_SAVED',
  REMOVE_SAVED: 'REMOVE_SAVED',
  START_FOCUS_TIMER: 'START_FOCUS_TIMER',   // req: {durationMin}
  STOP_FOCUS_TIMER: 'STOP_FOCUS_TIMER',
  TICK: 'TICK',                             // SW → UI 广播，1s 一次，只含 {now}
});
```

UI 不直接查 `chrome.storage`（统一过 SW）。例外：`save-for-later` 可以直接读 storage.local（无计算）。

---

## 6. Service Worker 生命周期应对（v1 踩过的坑总结）

1. **永远不要用 `setInterval`**。SW 会休眠。用 `chrome.alarms.create('tick', {periodInMinutes: 0.5})`。
2. **启动三入口**都要调 `init()`：`chrome.runtime.onInstalled`, `chrome.runtime.onStartup`, SW 顶层模块 init。
3. **`chrome.storage.session` 不跨 SW 重启**（Manifest V3）。跨重启要持久的数据写 `local`。
4. **写入竞争**：`appendSlice` 必须串行化（Promise 队列），不能并发 get→修改→set。

---

## 7. 测试策略

### 7.1 `tests/runTests.html`

```html
<!DOCTYPE html>
<script type="module">
  import './timeTracker.test.js';
  import './timeLog.test.js';
  // 每个 .test.js 自注册用例到 window.__tests，最后汇总输出
</script>
```

邓老师用法：
```
1. 在 chrome://extensions 里点 Tab Out Tempus v2 的 "检查视图 index.html"
2. Console 里 import('./tests/runTests.html')，或者直接打开 chrome-extension://<id>/tests/runTests.html
3. 看 console 输出 PASS/FAIL
```

### 7.2 手动回归清单（每次发布前跑）

- [ ] 普通使用 30 分钟，chip 时长准确
- [ ] alt-tab 切出 Chrome 5 分钟，时间不增长
- [ ] 重启 Chrome，时间从上次结束点续上（最多丢 30s）
- [ ] 两个窗口交替切，时间不串
- [ ] 关 tab 后，历史统计视图里能看到这段时间

---

## 8. 与 v1 的映射表（迁移时参考）

| v1 位置 | v2 位置 | 备注 |
|---|---|---|
| `background.js::recordTab` | `background/tabRegistry.js::record` | 纯元数据，不碰时间 |
| `background.js::finalize*` / slice 相关 | `background/timeTracker.js` | 全部集中 |
| `background.js::onFocusChanged` | `background/focusModel.js` | 单一真相源 |
| `background.js::appendTimeLog` | `background/timeLog.js::appendSlice` | 带队列 |
| `app.js` 前 1000 行（tab 渲染） | `ui/views/tabsGrid.js` + `ui/components/*` | 拆成组件 |
| `app.js` 时长计算 / lifetime 缓存 | **删除**，改从 `messaging.getTabTime()` 问 SW | 前端不再算时间 |
| `app.js` 历史视图 | `ui/views/historyView.js` + `heatmap.js` | |
| `app.js` save-for-later | `ui/views/sidebar.js` | |
| `formatDuration` | `ui/utils/formatDuration.js` | 默认最小 1 分钟 |

---

## 9. 命名与约定

- 模块文件：`camelCase.js`
- 导出函数：`camelCase`，无默认导出（always named exports）
- 常量：`UPPER_SNAKE`
- 消息类型：`UPPER_SNAKE` on `MSG.*`
- 日志前缀继续用 `[tempus]`
- 版本号直接跳 `2.0.0`

---

## 10. 下一步

M0 完成的判定标准：**本文档被邓老师读过并认可，每个模块的接口签名都在上面**。  
然后才能进入 M1（动键盘写代码）。

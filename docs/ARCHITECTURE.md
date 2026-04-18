# Tab Out Tempus — Architecture & Data Flow

---

## 系统架构概览

Tab Out Tempus 由两个主要模块组成：

```
┌─────────────────────────────────────────────────────┐
│  extension/index.html                               │
│  ├── extension/app.js      ← 前端 UI 模块            │
│  │     负责：渲染域名卡片、处理交互、视图切换          │
│  │     访问：chrome.tabs API、chrome.storage.local   │
│  │                                          [主线程] │
│  └── extension/style.css  ← 样式                    │
│                                                      │
│  extension/background.js ← Service Worker            │
│     负责：标签计时、徽章更新、storage 持久化           │
│     访问：chrome.tabs API、chrome.storage.local       │
│     特性：SW 会休眠重启，需通过 persistSessions 恢复  │
└─────────────────────────────────────────────────────┘
         chrome.storage.local（共享数据层）
```

---

## 数据流

### 标签页追踪（计时）

```
用户切换标签页
  → chrome.tabs.onActivated 触发
    → background.js: activateTab()
      → finalizePreviousTab()：将上一个标签的 elapsed 写入
        chrome.storage.local[key = `dailyHistory.YYYY-MM-DD.hostname`]
      → recordTab()：记录新标签 hostname + title
        → tabSessions.set(tabId, {hostname, title, activatedAt, totalTime})
      → updateBadge()：更新扩展徽章数字

每 30 秒：persistSessions()
  → 将 tabSessions 写入 chrome.storage.local['sessionData']
  → SW 重启后可恢复
```

### 前端读取打开的标签

```
extension/app.js: renderStaticDashboard()
  → chrome.tabs.query({ currentWindow: true })
  → 按 hostname 分组（过滤 chrome:// 等内部页面）
  → 调用 renderDomainCard() 渲染每个分组
  → 更新 #openTabsMissions 容器
```

### 历史统计视图

```
用户点击 Week/Month/Year 按钮
  → app.js 事件委托：viewBtn.dataset.view
    → getStatsData(view)  ← 读取 chrome.storage.local
      → 扫描所有 dailyHistory.* keys
      → 按日期范围过滤（week/month/year）
      → 按 hostname 聚合
      → 排序返回
    → renderStatsView(stats, range)  ← 写入 #openTabsMissions
    → heatmapContainer.style.display = 'none'  ← 隐藏热力图
```

---

## DOM 结构与关键元素

扩展主页面 `index.html` 的关键容器：

```html
<header>
  #greeting                          ← 问候语
  #dateDisplay                       ← 日期显示
  #headerTimeSpentLabel / #totalWorkTime  ← 顶部总计时
  #privateModeBtn / #privateModeSelect   ← 隐私模式
  #viewSwitcher                      ← Today/Week/Month/Year 切换按钮组
    .view-btn[data-view="today|week|month|year"]
  #langToggleBtn                     ← 语言切换
  #settingsBtn                       ← 设置按钮
</header>

#domainSprwawBanner                 ← 域名分散警告横幅（条件显示）

#heatmapContainer                    ← 24h 热力图（仅 Today 视图显示）
  #heatmapInner

#productivityBanner                  ← 生产力鼓励 Banner（Today/Week）

#openTabsSection                     ← 打开的标签页主区域
  #openTabsSectionTitle              ← "Open tabs" 标题
  #openTabsSectionCount             ← "N domains · Close all N tabs"
  #openTabsMissions                 ← 域名卡片容器（核心渲染目标）
</header>
```

**⚠️ 关键约束**：`#openTabsMissions` 被两个逻辑共用：
- **Today 视图**：`renderStaticDashboard()` 写入域名卡片 HTML
- **Week/Month/Year 视图**：`renderStatsView()` 写入统计数据 HTML

---

## 视图切换逻辑

全局状态：`let currentView = 'today'`（定义在 app.js ≈2797 行）

### 切换到 Today
```js
if (view === 'today') {
  heatmapContainer.style.display = 'block'; // 显示热力图
  await renderStaticDashboard();            // 渲染域名卡片
  await renderProductivityBanner('today');
  renderHeatmap();                           // 不 await，并行执行
}
```

### 切换到 Week/Month/Year
```js
} else {
  heatmapContainer.style.display = 'none';   // 隐藏热力图
  const stats = await getStatsData(view);   // 读取历史数据
  renderStatsView(stats, view);             // 写入 #openTabsMissions
  renderProductivityBanner(view);
}
```

### 语言切换时的视图重绘
```js
// 约第 2817-2837 行
if (currentView === 'today') {
  await renderStaticDashboard();
  renderHeatmap();
} else {
  heatmapContainer.style.display = 'none';  // 关键：Week/Month/Year 下也要隐藏热力图
  const stats = await getStatsData(currentView);
  renderStatsView(stats, currentView);
}
```

---

## 热力图（heatmapContainer）显示/隐藏约定

这是 v1.1.0 开发中踩过的核心 Bug，需严格遵守：

| 视图 | heatmapContainer 状态 | 渲染函数 |
|------|----------------------|---------|
| Today | `display: block` | `renderStaticDashboard()` + `renderHeatmap()` |
| Week/Month/Year | `display: none` | `renderStatsView()` |
| 语言切换（Today） | 保持 `block` | 同 Today |
| 语言切换（Stats） | `display: none` | 同 Stats |

**如果视图切换后热力图异常显示（如覆盖其他内容），首先检查：**
1. 是否在切换逻辑中正确设置了 `heatmapContainer.style.display`
2. 语言切换路径是否也处理了热力图状态

---

## i18n（国际化）

`I18N` 对象定义在 app.js 开头（约第 23 行）：

```js
const I18N = {
  currentLang: 'en',
  translations: {
    en: { ... },
    zh: { ... }   // 中文翻译
  },
  toggle() { ... },
  t(key) { ... }
};
```

语言切换流程：
1. 用户点击 `#langToggleBtn`
2. `I18N.toggle()` 切换 `currentLang`
3. `updateUIText()` 遍历所有 `data-i18n` 元素，更新文本
4. **重绘当前视图**（调用 `renderStaticDashboard` 或 `renderStatsView`）
5. **同步热力图状态**

---

## Service Worker 生命周期

Background.js 作为 SW 的特殊行为：

### SW 何时重启
- Chrome 在不活动后自动终止 SW（节省资源）
- 用户重启浏览器后 SW 重新初始化

### Session 恢复
```js
// background.js onInstalled 回调
const { sessionData } = await chrome.storage.local.get('sessionData');
// 遍历 sessionData 重建 tabSessions Map
```

### 持久化策略
- `finalizePreviousTab()`：每次标签切换时写入 `dailyHistory`
- `persistSessions()`：每 30 秒一次，防止 SW 重启丢失当前 session
- `chrome.runtime.onStartup`：浏览器重启后清空并重新开始

---

## 关键函数映射

| 函数名 | 文件 | 职责 |
|--------|------|------|
| `renderStaticDashboard()` | app.js | 主渲染流程：读取 tabs、分组、渲染域名卡片 |
| `renderDomainCard()` | app.js | 单个域名卡片 HTML 生成 |
| `renderStatsView()` | app.js | 历史统计视图（Week/Month/Year） |
| `renderHeatmap()` | app.js | 24h 热力图渲染 |
| `getStatsData()` | app.js | 从 storage 读取并聚合历史数据 |
| `refreshTimerDisplay()` | app.js | 每秒刷新域名卡片上的计时徽章 |
| `checkDomainSprwaw()` | app.js | 域名分散警告 |
| `checkTempusDupes()` | app.js | Tab Out Tempus 自身标签页重复检测 |
| `recordTab()` | background.js | 记录标签 hostname/title |
| `activateTab()` | background.js | 切换标签页处理 |
| `finalizePreviousTab()` | background.js | 写入 elapsed 到 dailyHistory |
| `persistSessions()` | background.js | 每 30s 持久化 sessionData |
| `clearDomainHistory()` | background.js | 删除某域名所有历史数据 |
| `addToBlockedDomains()` | background.js | 添加到隐私黑名单 |

---

## 扩展页面刷新机制

Tab Out Tempus 是**被动刷新**的（没有轮询），刷新时机：

| 触发条件 | 刷新函数 |
|---------|---------|
| 用户打开新标签页 | 页面加载时自动 `renderDashboard()` |
| 用户切换标签 | SW 计时，不影响 UI |
| 用户关闭标签 | SW 监听 `onRemoved`，不主动刷新 UI |
| 用户点击扩展图标 | 扩展 action 点击（无特殊行为） |
| 用户点击视图切换按钮 | 直接调用对应渲染函数 |
| 语言切换 | 重绘当前视图 |

⚠️ **没有自动刷新**：用户关闭标签后，Dashboard 不会自动更新，直到用户**打开新标签页**重新加载扩展。如果需要立即反映关闭操作，需要在 `onRemoved` 监听中通过 `postMessage` 通知前端刷新。

---

## 计时精度

- SW `finalizePreviousTab()` 使用 `Date.now()` 计算 elapsed
- 前端 `refreshTimerDisplay()` 每秒读取 `tabSessionData`（在 app.js 内存中，非 SW 内存）
- SW 重启后，`tabSessions` Map 丢失，`sessionData` 恢复时只恢复了 `totalTime`，没有 `activatedAt`，**当前 tab 的计时会重置**
- 解决：SW 重启后新标签页会重新初始化计时器

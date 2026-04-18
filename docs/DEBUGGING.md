# Tab Out — Debugging Guide & Known Issues

> 本文档记录开发过程中遇到的实际 Bug、根因分析、调试方法和经验教训。

---

## 🔥 已修复 Bug

### 1. 视图切换后热力图覆盖其他内容

**发现时间**：v1.1.0 开发过程中
**影响版本**：1.1.0

#### 现象
- Today 视图：正常显示域名卡片 + 热力图
- 切换到 Week/Month/Year 视图：只能看到热力图，下方统计数据消失
- 切换语言（中文↔英文）后：Week/Month/Year 视图完全空白

#### 根本原因

DOM 结构中存在**因果关系断裂**：

```
#heatmapContainer         ← 独立容器，热力图写入这里
  #openTabsSection        ← 整个统计区域（包含 #openTabsMissions）
    #openTabsSectionTitle
    #openTabsSectionCount
    #openTabsMissions     ← 统计数据 OR 域名卡片，都写在这里
```

当执行视图切换逻辑时：
```js
// 约第 2057-2059 行
} else {
  // Hide heatmap during stats view (week/month/year), but keep openTabsSection visible
  const heatmapContainer = document.getElementById('heatmapContainer');
  if (heatmapContainer) heatmapContainer.style.display = 'none';
  // ❌ 问题：只隐藏了 heatmapContainer，没隐藏 #openTabsSection
  // 当 Week/Month/Year 时，renderStatsView() 写入了 #openTabsMissions
  // 但如果 #openTabsSection 之前被隐藏过，#openTabsMissions 就看不见了
```

而 `renderStatsView` 本身将数据写入了 `#openTabsMissions`——**但 Week/Month/Year 切换时没有将 `#openTabsSection` 重新显示**，导致数据写到了隐藏的容器里。

同时，语言切换路径在 stats 视图下**没有处理热力图的隐藏状态**：
```js
// 约第 2828-2831 行（语言切换处理）
} else {
  // Hide heatmap during stats view
  const heatmapContainer = document.getElementById('heatmapContainer');
  if (heatmapContainer) heatmapContainer.style.display = 'none';
  // ✓ 正确
```

#### 修复方案
1. 切换到 Week/Month/Year 时，显式 `heatmapContainer.style.display = 'none'`
2. 切换回 Today 时，显式 `heatmapContainer.style.display = 'block'`
3. 语言切换时，根据 `currentView` 决定热力图状态

#### 关键代码位置
- `app.js` 约第 2048-2065 行：视图切换按钮处理
- `app.js` 约第 2817-2837 行：语言切换处理

#### 调试方法
- 添加日志：每个分支入口打印 `[DEBUG]` 标记
- `getBoundingClientRect()` 检测热力图容器实际尺寸（正常 0-200px，异常 3000+px）
- Storage 检查：确认 `dailyHistory` 数据完整（排除数据层问题）

---

### 2. `renderStatsView` 写入错误的容器

**发现时间**：v1.1.0 开发过程中

#### 根本原因
`renderStatsView` 函数签名：
```js
function renderStatsView(stats, range) {
  const container = document.getElementById('openTabsMissions');
  // ...
  container.innerHTML = stats.map(...).join('');
}
```

`#openTabsMissions` 是 `#openTabsSection` 的子元素。Week/Month/Year 视图时：
- `renderStaticDashboard()` 被跳过（没有执行 `openTabsSection.style.display = 'block'`）
- `openTabsSection` 保持 `display: none`（来自上一次的隐藏逻辑）
- `renderStatsView()` 把数据写入了看不见的子容器

#### 教训
> **Flexbox/Grid 布局 Bug 和 JS 视图逻辑 Bug 可能同时存在，调试时要分清层次——先确认数据写对了没有（JS 逻辑），再解决展示对不对（CSS 布局）。**

---

## 🐛 已知潜在问题

### 1. Service Worker 重启后当前 Tab 计时丢失

**描述**：SW 在不活动后被 Chrome 终止重建时，`tabSessions` Map 丢失。当前正在计时的标签页的 `activatedAt` 时间戳无法恢复。

**影响**：用户感觉计时器"跳了一下"

**当前缓解**：`persistSessions()` 每 30s 保存一次，重启后从 `sessionData` 恢复 `totalTime`，但无法恢复精确的 `activatedAt`

**是否修复**：未修复（低优先级，不影响核心统计数据）

---

### 2. 标签页关闭后 Dashboard 不自动刷新

**描述**：用户通过 Tab Out 关闭标签后，Dashboard 不会立即更新。

**当前行为**：需要打开新标签页（触发页面重新加载）才能看到最新状态

**是否修复**：未修复（需要引入消息通信机制）

---

### 3. 重复 Tab Out 标签页检测有时失效

**描述**：用户可能同时打开多个 Tab Out 新标签页，`checkTabOutDupes()` 逻辑存在边界情况。

**位置**：`app.js` `checkTabOutDupes()` 函数

**是否修复**：部分修复（banner 提示但不自动处理）

---

## 🔍 通用调试方法

### 添加日志
```js
console.log('[DEBUG] renderStaticDashboard: domainGroups.length =', domainGroups.length);
```

### 检测 DOM 实际尺寸
```js
const rect = document.getElementById('heatmapContainer').getBoundingClientRect();
console.log('heatmap rect:', rect.height, rect.width);
```

### 检查 Storage 数据
```js
// 在 app.js 中
chrome.storage.local.get(null, items => {
  const dailyKeys = Object.keys(items).filter(k => k.startsWith('dailyHistory.'));
  console.log('dailyHistory keys count:', dailyKeys.length);
});
```

### 分段排除法
1. 首页正常 → 问题在视图切换逻辑
2. 视图切换后 Today 正常但 Stats 异常 → 聚焦 `renderStatsView` 或热力图隐藏逻辑
3. 语言切换后异常 → 聚焦语言切换处理分支

### Chrome 扩展调试
- 打开 `chrome://extensions`
- 找到 Tab Out，点击 "Service Worker" 链接查看 background.js 日志
- 点击 "打开扩展的页面" 查看 popup/index.html 日志
- 使用 `chrome.storage.local.get(...)` 在 Console 验证数据

---

## 🛠 常用调试检查清单

当遇到 UI 显示问题时，按顺序检查：

- [ ] `chrome.storage.local` 中 `dailyHistory` 数据是否正常？
- [ ] `currentView` 全局变量的值是什么？（Today / Week / Month / Year）
- [ ] `heatmapContainer.style.display` 的值是什么？
- [ ] `openTabsSection.style.display` 的值是什么？
- [ ] `#openTabsMissions.innerHTML` 实际内容是什么？
- [ ] `getStatsData()` 返回的数组长度是否为 0？（可能是日期范围问题）
- [ ] `blockedDomains` 中是否包含了目标 hostname？

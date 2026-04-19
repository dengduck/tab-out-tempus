# v1 Feature Reference: Private Mode (Privacy Timer)

**Purpose**: 在用户切换到"隐私模式"期间，暂停所有 tab 的时间追踪，直到计时结束或手动关闭。

**Source**: `our-features` 分支（v1.3.5），将作为 v2.0 M8 阶段"Focus Timer + 黑名单"里的子功能移植过来。

---

## 用户场景

邓老师在做敏感工作（查个人信息、看 HR 材料等）时，不希望这些浏览被 Tempus 记录。此时：

1. 点击工具栏"Private Mode"按钮
2. 选择时长（15min / 30min / 1h / 2h / until midnight）
3. 确认后进入隐私模式
4. 期间所有 tab 追踪暂停，UI 顶部显示倒计时
5. 到时自动退出，或手动点击"End Private Mode"立即退出

## 核心数据模型

**Background Service Worker** 维护单一状态变量：

```js
let privateModeEndTime = null;  // Unix ms timestamp, null = inactive
```

**判断函数**：

```js
function isPrivateModeActive() {
  return privateModeEndTime !== null && privateModeEndTime > Date.now();
}
```

**持久化**：`chrome.storage.session` 的 `__privateModeEndTime` 键。SW 重启时从 session 恢复；如果恢复时已过期则置 null。

## 对时间追踪的影响点（v2 实现时必须覆盖）

在所有时间切片写入（finalize slice）的分支里，**必须先检查** `isPrivateModeActive()`：

| v1 位置 | 拦截内容 |
|---|---|
| `background.js:310` | tab 首次被追踪时（建 tabFirstSeen）—— 隐私模式下跳过 |
| `background.js:341` | focus 切换、finalize 当前 slice —— 隐私模式下不写 timeLog |
| `background.js:453` | alarm 驱动的周期性 slice 收尾 —— 同上 |

**v2 设计建议**：把 `isPrivateModeActive` 做成 TimeTracker 的守门函数，所有 `appendSlice()` 入口统一先过这道闸，不要散落在多处 if 里。

## 消息协议（UI ↔ SW）

v1 用 `chrome.runtime.sendMessage` 直接传字符串 action。v2 要按 `shared/messages.js` 定义的消息 schema 规范化。

**启动隐私模式**：
- Request: `{ action: 'startPrivateMode', duration: 'minutes' | 'midnight', minutes?: number }`
- Response: `{ privateModeEndTime: number | null }`

**查询当前状态**：
- Request: `{ action: 'getPrivateModeState' }`
- Response: `{ privateModeEndTime: number | null }`

**结束隐私模式**：
- Request: `{ action: 'endPrivateMode' }`
- Response: `{ ok: true }`

## UI 要素（v2 可重设计）

v1 的 UI 元素（用于 v2 参考，结构可改但功能要等价）：

- `#privateModeBtn` — toggle 按钮，active 时高亮
- `#privateModeSelect` — 时长下拉（15/30/60/120 分钟 + "until midnight"）
- `#privateModeLabel` — 倒计时文本（"Private Mode — 23:47 left"）
- UI 轮询用 `setInterval(updatePrivateModeCountdown, 1000)` —— **v2 改用 requestAnimationFrame 或计算 diff 后触发单次更新**，避免每秒 DOM 写

## 已知 v1 问题（v2 要避免）

1. **UI 轮询污染**：`setInterval(1s)` 导致 new-tab 页面即使隐藏也在跑；v2 要用 `visibilityState` 控制
2. **SW 和 UI 状态不同步**：SW 是真相源，UI 本地 `privateModeActive` 变量偶尔滞后；v2 要确保 UI 只消费 SW 的 getState response
3. **没有快捷键**：邓老师实际使用频率高，v2 考虑加 keyboard shortcut（如 Cmd+Shift+P）

## v2 里程碑定位

放在 **M8 (Focus Timer + 黑名单)** 一起做——两者都是"临时改变追踪行为"的时间窗口功能，共用同一套"当前窗口 state"模型能减少代码重复。

预计工作量：**0.5 个工作晚**（纯复刻 v1 语义 + 按 v2 消息协议改写）。

/**
 * shared/types.js
 * ----------------
 * 用 JSDoc @typedef 代替 TypeScript 的类型定义集中地。
 * 不导出任何运行时值；纯注释，供其它 .js 文件 import type 样式引用。
 *
 * 使用方式（在其它模块顶部）：
 *   /** @typedef {import('../shared/types.js').PauseReason} PauseReason *\/
 */

/**
 * TimeTracker 的暂停原因枚举。见 ARCHITECTURE-v2.md §3.1 / DECISIONS-v2.md D9。
 * @typedef {'window-blur'|'idle'|'private-mode'|'blacklist'|'no-active-tab'|'history-clear'} PauseReason
 */

/**
 * timeLog 存储里的一条时间片段。
 * @typedef {Object} TimeSlice
 * @property {number} s   开始时间戳（UTC 毫秒）
 * @property {number} e   结束时间戳（UTC 毫秒）
 * @property {string} h   hostname
 * @property {number} [tid] tab id（可选；tab 关闭后仍保留在日志中）
 * @property {string} [id] 幂等写入 ID（恢复 pending slice 时防重复）
 */

/**
 * TimeTracker 对外可见的状态快照。
 * @typedef {Object} TrackingState
 * @property {boolean} isActive              Set.size === 0 且有焦点 tab
 * @property {number|null} activeTabId
 * @property {Array<PauseReason>} pauseReasons  Set 的数组副本（便于 JSON 序列化）
 * @property {number|null} sliceStart
 */

/**
 * Tab 元数据（tabRegistry 维护）。
 * @typedef {Object} TabInfo
 * @property {number} id
 * @property {number} windowId
 * @property {string} url
 * @property {string} hostname
 * @property {string} title
 * @property {string} [favIconUrl]
 * @property {number} firstSeen   firstSeen 时间戳（UTC 毫秒）
 */

/**
 * 全局状态聚合（REQ_GET_STATE 的 response data 形状）。
 * @typedef {Object} GlobalState
 * @property {TrackingState} tracking
 * @property {{active: boolean, endTime?: number, remainingMs?: number}|null} privateMode
 * @property {{active:boolean,startTime:number,endTime:number,durationMs:number,remainingMs:number,strict:boolean,allowedHosts:string[]}|null} focusTimer
 * @property {Array<string>} blacklist
 * @property {Object} config
 */

export {};  // 标记为 module，便于 bundler / Chrome 识别

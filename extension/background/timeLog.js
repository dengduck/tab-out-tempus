/**
 * background/timeLog.js
 * ----------------------
 * 按月分片的历史 timeLog 读写。
 *
 * 存储 key：`timeLog.YYYY-MM` → Array<TimeSlice>
 *
 * 接口：
 *   appendSlice(slice: TimeSlice): Promise<void>   —— 串行化队列防竞争
 *   getRange(startTs, endTs): Promise<Array<TimeSlice>>
 *
 * 里程碑：M4 跟随 TimeTracker 一起落地。
 */

/** @typedef {import('../shared/types.js').TimeSlice} TimeSlice */

export async function appendSlice(_slice) { /* stub, M4 */ }
export async function getRange(_startTs, _endTs) { return []; }

/**
 * tests/formatDuration.test.js
 * ------------------------------
 * formatDuration / formatDurationCompact 单元测试。
 *
 * 里程碑：M5。
 */

import { suite, test, assert } from './testUtil.js';
import { formatDuration, formatDurationCompact } from '../ui/utils/formatDuration.js';

suite('formatDuration — 默认（最小单位 1 分钟）', () => {
  test('0ms → <1 分钟', () => {
    assert.equal(formatDuration(0), '<1 分钟');
  });

  test('59s → <1 分钟', () => {
    assert.equal(formatDuration(59 * 1000), '<1 分钟');
  });

  test('60s → 1 分钟', () => {
    assert.equal(formatDuration(60 * 1000), '1 分钟');
  });

  test('5 分钟', () => {
    assert.equal(formatDuration(5 * 60 * 1000), '5 分钟');
  });

  test('59 分钟', () => {
    assert.equal(formatDuration(59 * 60 * 1000), '59 分钟');
  });

  test('整 1 小时', () => {
    assert.equal(formatDuration(60 * 60 * 1000), '1 小时');
  });

  test('1 小时 3 分钟', () => {
    assert.equal(formatDuration((60 + 3) * 60 * 1000), '1 小时 3 分钟');
  });

  test('2 小时 30 分钟', () => {
    assert.equal(formatDuration((120 + 30) * 60 * 1000), '2 小时 30 分钟');
  });

  test('非数字容错', () => {
    assert.equal(formatDuration(null), '<1 分钟');
    assert.equal(formatDuration(undefined), '<1 分钟');
    assert.equal(formatDuration(NaN), '<1 分钟');
    assert.equal(formatDuration(-1000), '<1 分钟');
    assert.equal(formatDuration('abc'), '<1 分钟');
  });
});

suite('formatDuration — locale=en', () => {
  test('<1m', () => {
    assert.equal(formatDuration(30 * 1000, { locale: 'en' }), '<1m');
  });

  test('5m', () => {
    assert.equal(formatDuration(5 * 60 * 1000, { locale: 'en' }), '5m');
  });

  test('1h', () => {
    assert.equal(formatDuration(3600 * 1000, { locale: 'en' }), '1h');
  });

  test('1h 3m', () => {
    assert.equal(formatDuration((60 + 3) * 60 * 1000, { locale: 'en' }), '1h 3m');
  });
});

suite('formatDuration — allowSeconds', () => {
  test('30 秒', () => {
    assert.equal(formatDuration(30 * 1000, { allowSeconds: true }), '30 秒');
  });

  test('1 分 30 秒', () => {
    assert.equal(formatDuration(90 * 1000, { allowSeconds: true }), '1 分 30 秒');
  });

  test('1 小时 3 分 20 秒', () => {
    assert.equal(formatDuration((3600 + 3 * 60 + 20) * 1000, { allowSeconds: true }), '1 小时 3 分 20 秒');
  });

  test('en + allowSeconds', () => {
    assert.equal(formatDuration(30 * 1000, { allowSeconds: true, locale: 'en' }), '30s');
    assert.equal(formatDuration(90 * 1000, { allowSeconds: true, locale: 'en' }), '1m 30s');
    assert.equal(formatDuration((3600 + 15 * 60) * 1000, { allowSeconds: true, locale: 'en' }), '1h 15m 0s');
  });
});

suite('formatDurationCompact', () => {
  test('<1m 兜底', () => {
    assert.equal(formatDurationCompact(0), '<1m');
    assert.equal(formatDurationCompact(59 * 1000), '<1m');
  });

  test('纯分钟', () => {
    assert.equal(formatDurationCompact(5 * 60 * 1000), '5m');
    assert.equal(formatDurationCompact(59 * 60 * 1000), '59m');
  });

  test('整小时', () => {
    assert.equal(formatDurationCompact(3600 * 1000), '1h');
    assert.equal(formatDurationCompact(2 * 3600 * 1000), '2h');
  });

  test('小时+分钟', () => {
    assert.equal(formatDurationCompact((60 + 3) * 60 * 1000), '1h3m');
    assert.equal(formatDurationCompact((120 + 30) * 60 * 1000), '2h30m');
  });

  test('容错', () => {
    assert.equal(formatDurationCompact(null), '<1m');
    assert.equal(formatDurationCompact(-500), '<1m');
    assert.equal(formatDurationCompact(NaN), '<1m');
  });
});

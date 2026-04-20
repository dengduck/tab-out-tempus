/**
 * tests/testUtil.js
 * ------------------
 * 极简测试运行器：
 *   - suite(name, fn)：注册一组测试
 *   - test(name, fn)：注册单个 case（fn 可以是 async）
 *   - assert.*：断言工具
 *   - run()：执行所有注册的 case 并把结果 append 到 #results
 *
 * 零依赖。失败时抛 Error，被 runner 捕获并标红。
 */

const suites = [];
let currentSuite = null;

export function suite(name, fn) {
  const s = { name, cases: [] };
  currentSuite = s;
  fn();
  suites.push(s);
  currentSuite = null;
}

export function test(name, fn) {
  if (!currentSuite) throw new Error('test() called outside suite()');
  currentSuite.cases.push({ name, fn });
}

export const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || 'equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(cond, msg) {
    if (!cond) throw new Error(msg || 'expected truthy');
  },
  greaterOrEqual(actual, expected, msg) {
    if (!(actual >= expected)) {
      throw new Error(`${msg || 'ge'}: expected >= ${expected}, got ${actual}`);
    }
  },
  closeTo(actual, expected, tolerance, msg) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${msg || 'closeTo'}: expected ~${expected} (±${tolerance}), got ${actual}`);
    }
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg || 'deepEqual'}: expected ${e}, got ${a}`);
  },
};

export async function run(container) {
  let pass = 0, fail = 0;
  const lines = [];
  for (const s of suites) {
    lines.push(`\n📦 ${s.name}`);
    for (const c of s.cases) {
      try {
        await c.fn();
        lines.push(`  ✓ ${c.name}`);
        pass++;
      } catch (err) {
        lines.push(`  ✗ ${c.name}\n    ${err && err.message ? err.message : err}`);
        fail++;
        console.error('[test fail]', s.name, '>', c.name, err);
      }
    }
  }
  const summary = `\n${'─'.repeat(40)}\n${pass} passed, ${fail} failed`;
  const html = lines.map((l) => {
    if (l.startsWith('  ✓')) return `<span class="pass">${escapeHtml(l)}</span>`;
    if (l.startsWith('  ✗')) return `<span class="fail">${escapeHtml(l)}</span>`;
    return escapeHtml(l);
  }).join('\n') + '\n' + `<span class="${fail === 0 ? 'pass' : 'fail'}">${escapeHtml(summary)}</span>`;
  if (container) container.innerHTML = html;
  return { pass, fail };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

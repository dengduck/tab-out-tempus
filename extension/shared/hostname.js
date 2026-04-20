/**
 * shared/hostname.js
 * -------------------
 * URL → hostname 纯函数工具，SW 和 UI 都用。
 *
 * 放在 shared/ 是因为这是跨端一致的**数据归一化规则**，
 * 不是 UI 展示规则（那些仍在 ui/utils/domain.js）。
 */

/**
 * 归一化 URL 用于重复标签检测。
 *   - strip hash fragment
 *   - strip trailing slash（仅 path 结尾，不影响查询参数）
 *   - 去除 www. 前缀
 *   - query params 按 key 排序（确保 ?a=1&b=2 == ?b=2&a=1）
 *   - 非 http/https 返回空串（不参与去重）
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/^https?:/.test(u.protocol)) return '';
  // 去 www.
  let host = u.hostname;
  if (host.startsWith('www.')) host = host.slice(4);
  // 去 trailing slash（仅当 path 只有 / 时保留，避免 "/" 和 "" 不一致）
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  // query params 排序
  const params = Array.from(u.searchParams.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const query = params.length > 0 ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  // 端口
  const port = u.port ? `:${u.port}` : '';
  return `${u.protocol}//${host}${port}${path}${query}`;
}

/**
 * 从 URL 提取归一化 hostname。
 *   - http/https/file 协议才返回非空
 *   - localhost / 127.0.0.1 保留端口（localhost:3000 ≠ localhost:8080）
 *   - 其他 host 去除 www. 前缀
 * @param {string} url
 * @returns {string}
 */
export function getHostname(url) {
  if (!url || typeof url !== 'string') return '';
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (!/^https?:|^file:/.test(u.protocol)) return '';
  let host = u.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return u.port ? `${host}:${u.port}` : host;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

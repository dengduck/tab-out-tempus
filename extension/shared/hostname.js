/**
 * shared/hostname.js
 * -------------------
 * URL → hostname 纯函数工具，SW 和 UI 都用。
 *
 * 放在 shared/ 是因为这是跨端一致的**数据归一化规则**，
 * 不是 UI 展示规则（那些仍在 ui/utils/domain.js）。
 */

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

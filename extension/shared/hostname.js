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
  // 原生排序保留 URL 编码语义，避免手工拼接造成 decoded-query 冲突。
  u.searchParams.sort();
  const port = u.port ? `:${u.port}` : '';
  return `${u.protocol}//${host}${port}${path}${u.search}`;
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
  try { u = new URL(url); } catch { return ''; }
  if (!/^https?:|^file:/.test(u.protocol)) return '';
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === '127.0.0.1') {
    return u.port ? `${host}:${u.port}` : host;
  }
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/**
 * 用户输入 → 规范 hostname。支持完整 URL、裸域名、路径、www、大小写。
 * 仅接受 http/https 语义；普通域名自动补 https://。
 */
export function normalizeHostnameInput(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { return ''; }
  if (!/^https?:$/.test(url.protocol)) return '';
  return getHostname(url.href);
}

import { h } from '../utils/dom.js';
import * as messaging from '../messaging.js';

function section(title, description) {
  const el = h('div', { class: 'sp__section' });
  el.appendChild(h('div', { class: 'sp__sectionHeader' }, [
    h('span', { class: 'sp__sectionTitle' }, [title]),
  ]));
  if (description) el.appendChild(h('p', { class: 'sp__desc' }, [description]));
  return el;
}

function input(placeholder, value = '') {
  const el = h('input', { class: 'sp__input', type: 'text', placeholder });
  el.value = value;
  return el;
}

function button(label, action, primary = false) {
  const btn = h('button', {
    class: `sp__btn${primary ? ' sp__btn--primary' : ''}`,
    type: 'button',
  }, [label]);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await action(); }
    finally { btn.disabled = false; }
  });
  return btn;
}

function select(options, value) {
  const el = h('select', { class: 'sp__select' });
  for (const [optionValue, label] of options) {
    const option = h('option', { value: optionValue }, [label]);
    option.selected = String(optionValue) === String(value);
    el.appendChild(option);
  }
  return el;
}

function report(error, host) {
  console.error('[tempus] settings update failed', error);
  if (host) host.textContent = `保存失败：${error?.message || error}`;
}

function renderAppearance(config, onConfig) {
  const el = section('外观与分组', '主题可跟随系统；分组方式可按域名、分类或自定义分组。');
  const row = h('div', { class: 'sp__actionRow' });
  const theme = select([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], config.theme);
  const mode = select([['domain', '按域名'], ['category', '按分类'], ['custom', '自定义分组']], config.groupMode);
  theme.addEventListener('change', async () => {
    try { onConfig((await messaging.setTheme(theme.value)).config); } catch (err) { report(err, status); }
  });
  mode.addEventListener('change', async () => {
    try { onConfig((await messaging.setGroupMode(mode.value)).config); } catch (err) { report(err, status); }
  });
  const status = h('p', { class: 'sp__feedback' });
  row.append(theme, mode);
  el.append(row, status);
  return el;
}

function renderData(config, onConfig) {
  const el = section('历史数据', '可长期保留，或自动清理指定天数以前的记录。');
  const retention = select([
    ['forever', '永久保留'], ['30', '保留 30 天'], ['90', '保留 90 天'], ['180', '保留 180 天'], ['365', '保留 1 年'],
  ], config.historyRetentionDays ?? 'forever');
  const status = h('p', { class: 'sp__feedback' });
  retention.addEventListener('change', async () => {
    const days = retention.value === 'forever' ? null : Number(retention.value);
    try { onConfig((await messaging.setRetention(days)).config); } catch (err) { report(err, status); }
  });
  el.append(h('div', { class: 'sp__actionRow' }, [retention]), status);
  return el;
}

function renderFocusHosts(config, onConfig) {
  const el = section('Strict 模式白名单', '每行一个域名；支持 *.example.com。严格专注时只允许这些网站。');
  const area = h('textarea', { class: 'sp__textarea', rows: '4', placeholder: 'docs.example.com\n*.company.com' });
  area.value = (config.focusAllowedHosts || []).join('\n');
  const status = h('p', { class: 'sp__feedback' });
  el.append(area, button('保存白名单', async () => {
    const hosts = area.value.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
    try {
      onConfig((await messaging.setFocusHosts(hosts)).config);
      status.textContent = '已保存';
    } catch (err) { report(err, status); }
  }, true), status);
  return el;
}

function renderCategories(config, onConfig) {
  const el = section('域名分类与每日预算', '预算单位为分钟；留空表示不限制。');
  const categoryList = h('div', { class: 'sp__list' });
  for (const category of config.categories || []) {
    const remove = h('button', { class: 'sp__listRemove', type: 'button' }, ['×']);
    remove.addEventListener('click', async () => {
      try { onConfig((await messaging.removeCategory(category.id)).config); } catch (err) { report(err, status); }
    });
    categoryList.appendChild(h('div', { class: 'sp__listItem' }, [
      h('span', { class: 'sp__listHost' }, [`${category.emoji || ''} ${category.name} (${category.id})`]), remove,
    ]));
  }

  const categoryId = input('分类 ID，如 research');
  const categoryName = input('分类名称');
  const categoryColor = input('颜色，如 #3B82F6', '#3B82F6');
  const addCategory = button('添加分类', async () => {
    try {
      onConfig((await messaging.upsertCategory({
        id: categoryId.value,
        name: categoryName.value,
        color: categoryColor.value,
        emoji: '•',
      })).config);
    } catch (err) { report(err, status); }
  });

  const host = input('域名，如 youtube.com');
  const categoryOptions = [['', '未分类'], ...(config.categories || []).map((c) => [c.id, c.name])];
  const category = select(categoryOptions, '');
  const budget = input('每日预算（分钟，可留空）');
  const saveDomain = button('保存域名规则', async () => {
    try {
      const minutes = budget.value.trim() ? Number(budget.value) : null;
      const result = await messaging.setDomainRule(
        host.value,
        category.value || null,
        minutes === null ? null : Math.round(minutes * 60_000),
      );
      onConfig(result.config);
    } catch (err) { report(err, status); }
  }, true);

  const status = h('p', { class: 'sp__feedback' });
  el.append(categoryList,
    h('div', { class: 'sp__stack' }, [categoryId, categoryName, categoryColor, addCategory]),
    h('div', { class: 'sp__stack' }, [host, category, budget, saveDomain]), status);
  return el;
}

function renderCustomGroups(config, onConfig) {
  const el = section('自定义分组', '为一组域名指定自己的分组名称；多个域名用逗号分隔。');
  const list = h('div', { class: 'sp__list' });
  for (const group of config.customGroups || []) {
    const remove = h('button', { class: 'sp__listRemove', type: 'button' }, ['×']);
    remove.addEventListener('click', async () => {
      try { onConfig((await messaging.removeCustomGroup(group.id)).config); } catch (err) { report(err, status); }
    });
    list.appendChild(h('div', { class: 'sp__listItem' }, [
      h('span', { class: 'sp__listHost' }, [`${group.name}: ${group.hosts.join(', ')}`]), remove,
    ]));
  }
  const id = input('分组 ID，如 qingteng');
  const name = input('分组名称');
  const hosts = input('域名：a.com, b.com');
  const status = h('p', { class: 'sp__feedback' });
  el.append(list, h('div', { class: 'sp__stack' }, [id, name, hosts,
    button('保存分组', async () => {
      try {
        onConfig((await messaging.upsertCustomGroup({
          id: id.value,
          name: name.value,
          hosts: hosts.value.split(',').map((v) => v.trim()).filter(Boolean),
        })).config);
      } catch (err) { report(err, status); }
    }, true),
  ]), status);
  return el;
}

export function renderAdvancedSettings(config, onConfig) {
  const root = h('div', { class: 'sp__advanced' });
  root.append(
    renderAppearance(config, onConfig),
    renderData(config, onConfig),
    renderFocusHosts(config, onConfig),
    renderCategories(config, onConfig),
    renderCustomGroups(config, onConfig),
  );
  return root;
}

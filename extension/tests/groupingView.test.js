import { suite, test, assert } from './testUtil.js';
import {
  resolveGroupForHost,
  groupDomains,
  resolveBudget,
  budgetStatus,
} from '../ui/views/groupingView.js';

const config = {
  categories: [
    { id: 'work', name: 'Work' },
    { id: 'social', name: 'Social' },
  ],
  domainCategories: {
    'github.com': 'work',
    'chat.example.com': 'social',
  },
  customGroups: [
    { id: 'project', name: 'Project', domains: ['github.com', '*.project.test'] },
  ],
};

suite('Grouping view helpers', () => {
  test('domain mode creates one group per normalized hostname', () => {
    assert.deepEqual(
      resolveGroupForHost(' GitHub.COM. ', { ...config, groupMode: 'domain' }),
      { id: 'github.com', name: 'github.com', type: 'domain' },
    );
  });

  test('category mode resolves categories and falls back to Uncategorized', () => {
    assert.deepEqual(
      resolveGroupForHost('github.com', { ...config, groupMode: 'category' }),
      { id: 'work', name: 'Work', type: 'category' },
    );
    assert.deepEqual(
      resolveGroupForHost('unknown.test', { ...config, groupMode: 'category' }),
      { id: 'uncategorized', name: 'Uncategorized', type: 'uncategorized' },
    );
  });

  test('custom mode prefers custom groups before category fallback', () => {
    assert.deepEqual(
      resolveGroupForHost('github.com', { ...config, groupMode: 'custom' }),
      { id: 'project', name: 'Project', type: 'custom' },
    );
    assert.deepEqual(
      resolveGroupForHost('chat.example.com', { ...config, groupMode: 'custom' }),
      { id: 'social', name: 'Social', type: 'category' },
    );
    assert.deepEqual(
      resolveGroupForHost('docs.project.test', { ...config, groupMode: 'custom' }),
      { id: 'project', name: 'Project', type: 'custom' },
    );
  });

  test('groupDomains aggregates domains and tabs without changing input', () => {
    const domainGroups = [
      { hostname: 'github.com', tabs: [{ id: 1 }, { id: 2 }] },
      { hostname: 'docs.project.test', tabs: [{ id: 3 }] },
      { hostname: 'chat.example.com', tabs: [{ id: 4 }] },
      { hostname: 'other.test', tabs: [{ id: 5 }] },
    ];
    const before = JSON.stringify(domainGroups);

    const groups = groupDomains(domainGroups, { ...config, groupMode: 'custom' });

    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0], {
      id: 'project',
      name: 'Project',
      type: 'custom',
      domains: [domainGroups[0], domainGroups[1]],
      tabs: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    assert.deepEqual(groups[1], {
      id: 'social',
      name: 'Social',
      type: 'category',
      domains: [domainGroups[2]],
      tabs: [{ id: 4 }],
    });
    assert.equal(groups[2].type, 'uncategorized');
    assert.equal(JSON.stringify(domainGroups), before, 'input must remain unchanged');
  });

  test('resolveBudget reads canonical exact-domain budgets', () => {
    const budgetConfig = { ...config, domainBudgets: { 'github.com': 90 } };
    assert.equal(resolveBudget('www.GitHub.com', budgetConfig), 90);
    assert.equal(resolveBudget('docs.github.com', budgetConfig), null);
    assert.equal(resolveBudget('unknown.test', config), null);
  });

  test('budgetStatus distinguishes none, ok, warning, and exceeded', () => {
    assert.equal(budgetStatus(10, null), 'none');
    assert.equal(budgetStatus(79, 100), 'ok');
    assert.equal(budgetStatus(80, 100), 'warning');
    assert.equal(budgetStatus(100, 100), 'exceeded');
    assert.equal(budgetStatus(120, 100), 'exceeded');
  });
});

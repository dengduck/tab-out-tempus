# Tabpus — Developer Guide

> 本文档面向参与 Tabpus 开发的 AI Agent 和人类开发者。记录开发流程、Git 策略、代码规范和注意事项。

---

## 开发环境准备

### 1. 克隆仓库

```bash
git clone https://github.com/dengduck/tabpus.git
cd tabpus
```

### 2. 安装 Chrome 扩展

```bash
# 显示 extension 文件夹路径
echo "Extension folder: $(cd extension && pwd)"

# macOS 复制路径
cd extension && pwd | pbcopy

# 打开 Chrome 扩展页
open "chrome://extensions"

# 开启 Developer mode（右上角开关）
# 点击 "Load unpacked"
# Cmd+Shift+G 打开"前往文件夹"，粘贴路径
```

### 3. 验证安装

打开新标签页，应能看到 Tabpus 界面。关闭 Chrome 扩展页，再次打开新标签页即可。

### 4. 调试

- **前端日志**：`chrome://extensions` → Tabpus → "打开扩展的页面"
- **SW 日志**：`chrome://extensions` → Tabpus → "Service Worker" 链接

---

## Git 分支策略

### 分支结构

```
upstream/xxx    ← 上游（Zara）仓库的分支（readonly）
origin/main     ← 本地 main 的远程，track upstream/main
main            ← 本地 main，只跟踪上游，不做自己的修改
our-features    ← 活跃开发分支，所有定制功能在此
```

### 首次配置 upstream

```bash
# 克隆后，添加上游仓库
git remote add upstream https://github.com/zarazhangrui/tab-out.git

# 确认 remote 配置
git remote -v
# origin   https://github.com/dengduck/tabpus.git (fetch)
# origin   https://github.com/dengduck/tabpus.git (push)
# upstream https://github.com/zarazhangrui/tab-out.git (fetch)
# upstream https://github.com/zarazhangrui/tab-out.git (push)

# 拉取上游更新
git fetch upstream

# 将 upstream/main 合并到本地 main
git checkout main
git merge upstream/main --no-edit

# 切换回开发分支
git checkout our-features
```

### 从上游同步最新代码

**每次开发新功能之前**执行以下步骤：

```bash
# 1. 确保工作区干净
git status  # 应无修改

# 2. 切到 main
git checkout main

# 3. 拉取上游更新并合并
git fetch upstream
git merge upstream/main --no-edit

# 4. 切回开发分支，合并 main
git checkout our-features
git merge main --no-edit

# 5. 如有冲突，手动解决后继续
# git add .
# git commit
```

### 向上游贡献

```bash
# 从 main 创建 PR 分支
git checkout main
git checkout -b feature/your-feature-name

# 开发并提交
git add .
git commit -m "feat: description"

# 推送到自己的 origin（不是 upstream！）
git push origin feature/your-feature-name

# 在 GitHub 上创建 PR → 合并到 upstream/main
```

---

## 代码规范

### 文件组织

| 文件 | 职责 | 行数参考 |
|------|------|---------|
| `app.js` | 前端 UI 逻辑、事件处理、视图渲染 | ≈2900 行 |
| `background.js` | SW、计时、徽章、存储 | ≈400 行 |
| `index.html` | DOM 结构 | ≈400 行 |
| `style.css` | 所有样式 | - |

### app.js 结构

文件顶部按区域组织（不要打乱顺序）：

```js
// 1. 常量定义 / 全局状态
// 2. i18n
// 3. 配置
// 4. DOM 引用缓存（getElementById）
// 5. 工具函数
// 6. 主要渲染函数（render*）
// 7. 事件处理函数（click 等）
// 8. 初始化代码
```

### 命名规范

- 函数：`camelCase`，动词开头（如 `renderStatsView`、`getStatsData`）
- 常量：`SCREAMING_SNAKE_CASE`
- 全局变量：`camelCase`，带前缀说明作用域（如 `currentView`、`hiddenDomains`）
- DOM 元素：与 HTML `id` 一致
- CSS class：kebab-case（如 `mission-card`、`view-btn`）

### 日志规范

使用 `[DEBUG]` 前缀，便于过滤：
```js
console.log('[DEBUG] renderStaticDashboard: domainGroups.length =', domainGroups.length);
```

发布前移除不必要的日志。

### i18n 规范

所有用户可见文本必须通过 `I18N.t('key')` 访问：
```js
// 正确
titleEl.textContent = I18N.t('Open tabs');

// 错误 ❌
titleEl.textContent = 'Open tabs';
```

新增文本时，同时更新 `translations.en` 和 `translations.zh`。

---

## 关键开发注意事项

### ⚠️ 热力图显示/隐藏约定

视图切换时必须同步处理 `heatmapContainer` 的显示状态：

```js
if (view === 'today') {
  heatmapContainer.style.display = 'block';  // 显示热力图
  await renderStaticDashboard();
  renderHeatmap();
} else {
  heatmapContainer.style.display = 'none';   // 隐藏热力图
  renderStatsView(stats, view);
}
```

语言切换时也要遵循同样规则，参考 `app.js` 第 2817-2837 行。

### ⚠️ #openTabsMissions 共用容器

`#openTabsMissions` 被 Today 视图（域名卡片）和 Stats 视图（统计列表）共用。
渲染时必须确保容器父元素 `#openTabsSection` 处于正确的 `display` 状态。

### ⚠️ Service Worker 内存不持久

`background.js` 中的 `tabSessions` Map 在 SW 重启后会丢失。
不要在前端直接读取 `tabSessions`，应通过 `chrome.runtime.sendMessage` 与 SW 通信。

### ⚠️ 不要修改工作区文件夹名称

如果使用 WorkBuddy 等工具，**不要修改包含 tabpus 的工作区文件夹名称**，否则工具链可能失效。

---

## 开发流程约定

### 功能开发

1. **讨论方案**：先向用户解释思路，提供完整方案，不要边做边改
2. **实施**：在 `our-features` 分支进行
3. **测试**：用户手动测试
4. **提交**：由用户确认后执行 `git commit`（除非用户明确要求）
5. **推送**：由用户通知后再执行 `git push`

### Bug 修复

1. 先在本地复现 Bug
2. 添加 `[DEBUG]` 日志定位根因
3. 修复后移除调试代码
4. 提交时写清楚 Bug 现象和修复内容

### Commit 信息格式

```
<type>: <简短描述>

<可选的详细说明>

Closes/Fixes: #<issue>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

---

## 版本管理

每次发版：

1. 更新 `CHANGELOG.md`（格式见文件内示例）
2. 更新 `extension/manifest.json` 中的 `version` 字段
3. Git tag（可选）
4. 推送后由用户在 GitHub 创建 Release

---

## 常用命令

```bash
# 查看状态
git status

# 查看当前分支
git branch

# 查看远程
git remote -v

# 暂存改动（不提交）
git stash

# 恢复暂存
git stash pop

# 查看日志
git log --oneline -10

# 对比分支
git diff our-features..main
```

---

## 资源链接

- [Chrome Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Tabpus 上游仓库](https://github.com/zarazhangrui/tab-out)
- [Tabpus Fork 仓库](https://github.com/dengduck/tabpus)

# Tab Out Tempus — Project Overview

> **fork**: https://github.com/dengduck/tab-out-tempus
> **upstream**: https://github.com/zarazhangrui/tab-out
> **工作目录**: `/Users/jundeng/WorkBuddy/20260418032939/tab-out`

---

## 什么是 Tab Out Tempus

Tab Out Tempus 是一个 Chrome 新标签页扩展，用域名分组的方式展示用户所有打开的标签页。内置关闭动画、重复标签检测、"稍后保存"、历史统计等功能。所有数据完全存储在本地（`chrome.storage.local`），无服务器、无账号、无外部 API 调用。

---

## 技术栈

| 组件 | 技术方案 |
|------|---------|
| 扩展类型 | Chrome Manifest V3 |
| 前端页面 | 纯 HTML + CSS + JS（无框架），`extension/index.html` |
| Service Worker | `extension/background.js` |
| 数据存储 | `chrome.storage.local` |
| 音效 | Web Audio API（合成，无音频文件） |
| 动画 | CSS transitions + JS confetti 粒子 |
| 统计图表 | 24 小时热力图（DOM-based） |

### 关键约束
- **无 Node.js / npm**：纯浏览器扩展，不依赖构建工具
- **无外部请求**：所有资源内联或来自 Google Fonts CDN（字体）
- **Manifest V3**：Service Worker 替代传统 background page

---

## 文件结构

```
tab-out-tempus/
├── extension/
│   ├── index.html      # 主页面（Dashboard UI 结构）
│   ├── app.js          # 前端逻辑：渲染、交互、视图切换 (≈2900 行)
│   ├── background.js   # Service Worker：计时、徽章、存储持久化
│   ├── style.css       # 所有样式
│   ├── manifest.json   # 扩展配置
│   └── icons/          # 扩展图标 (16/48/128 PNG)
├── docs/               # 本文档目录（AI 协作知识库）
│   ├── PROJECT.md      # 本文件
│   ├── ARCHITECTURE.md # 视图逻辑、数据流、组件关系
│   ├── DEBUGGING.md    # 已知 Bug、根因分析、调试经验
│   └── DEV_GUIDE.md   # 开发流程、Git 策略、注意事项
├── AGENTS.md           # AI 辅助安装指南（给其他 AI 阅读）
├── CHANGELOG.md        # 版本变更记录
└── README.md           # 用户级说明文档
```

---

## 功能清单

### 核心功能
- [x] **域名分组展示**：按域名将打开的标签页分组为卡片网格（bento 布局）
- [x] **Homepages 分组**：Gmail / X / LinkedIn / YouTube / GitHub 首页自动归入顶部专属分组
- [x] **关闭动画**：关闭标签页时触发 swoosh 音效 + confetti 粒子效果
- [x] **重复标签检测**：琥珀色 "(2x)" 徽章标识，一键关闭重复标签
- [x] **跨窗口跳转**：点击任意标签标题，直接跳转到对应标签（跨窗口）
- [x] **Save for Later**：关闭前将标签暂存到侧边栏，之后可恢复
- [x] **localhost 端口分组**：本地开发时按端口号区分不同项目
- [x] **可折叠分组**：每个分组默认显示 8 个标签，超出显示 "+N more"
- [x] **Tab 休眠/唤醒**：使用 Chrome Tab Discard API 节省内存，💤 徽章标识

### 统计与计时
- [x] **Session 计时**：实时追踪每个域名的浏览时长
- [x] **每域名计时徽章**：域名卡片上实时更新 session 时间（每秒刷新）
- [x] **历史统计视图**：Today / Week / Month / Year 四种视图切换
- [x] **24 小时热力图**：Today 视图顶部，按小时显示各域名浏览强度
- [x] **隐私黑名单**：指定域名排除在统计之外
- [x] **生产力 Banner**：Today / Week 视图顶部显示鼓励语
- [x] **Tab 陈旧度追踪**：7 天以上未访问的域名显示 💤 徽章

### 隐私与专注
- [x] **隐私模式（Focus Timer）**：暂停所有计时，支持 15min / 30min / 1h / 2h / 8h / 到午夜多种时长
- [x] **同时打开多域名检测**：警告用户域名过于分散，建议合并

### 数据管理
- [x] **历史记录导出**：将所有统计数据下载为 JSON 文件备份
- [x] **历史记录导入**：重装或迁移时恢复历史数据

---

## 存储数据结构

所有数据存储在 `chrome.storage.local`，key 格式如下：

| Key Pattern | 说明 |
|------------|------|
| `dailyHistory.YYYY-MM-DD.hostname` | 每日每域名累计时长（毫秒） |
| `hourlyData.hostname` | 每域名每日 24 小时数组（最近 30 天） |
| `tab_{id}` | Session 恢复数据（background.js SW 重启后） |
| `sessionData` | 所有 tab session 的聚合快照 |
| `blockedDomains` | 隐私黑名单数组 |
| `deferredTabs` | Save for Later 暂存的标签数组 |
| `hostnameLastFocus` | 每域名最后访问时间戳（背景 SW 内存 + 存储） |

---

## 版本策略

- 采用语义化版本（SemVer）
- 每次发版后记录到 `CHANGELOG.md`
- **当前本地版本**：1.1.0（在上游 1.0.0 基础上加统计视图等功能）
- **当前 manifest.json 版本号**：1.2.0（本地自定义版本号）
- 上游同步时机：每次开发新功能之前执行

---

## 分支策略

```
main            ← 跟踪上游，只做同步，不做自己的修改
our-features    ← 活跃开发分支，所有定制功能在此
```

- **不要在 main 分支上做自己的修改**
- **从 upstream 同步后**：`upstream/main → main → our-features`（两步 merge）
- **向上游贡献**时，从 main 拉分支发 PR

详见 [DEV_GUIDE.md](./DEV_GUIDE.md)

**语言：** [English](README.md) | 简体中文

# Tabpus

**掌控你的标签页。**

Tabpus 是一个 Chrome 新标签页扩展，将所有打开的标签页按域名分组展示在一个简洁的仪表盘上。Homepages（Gmail、X、LinkedIn 等）自动归入专属分组。关闭标签时有动听的音效和彩纸特效。

无服务器。无账号。无外部请求。纯 Chrome 扩展。

---

## 使用 AI 编程助手安装

把这个仓库链接发给你的 AI 助手（Claude Code、Codex 等），然后说 **"帮我安装这个"**：

```
https://github.com/dengduck/tabpus
```

AI 会一步步指导你，大约 1 分钟搞定。

---

## 功能特性

### 核心功能
- **一目了然的标签页展示** 干净的网格布局，按域名自动分组
- **Homepages 专属分组** Gmail 收件箱、X 首页、YouTube、LinkedIn、GitHub 首页集中到一张卡片
- **优雅地关闭标签** 配有 swoosh 音效 + 彩纸爆裂特效
- **重复标签检测** 同一页面打开多次时自动标记，一键去重
- **点击跳转任意标签** 跨窗口直达，不会打开新标签
- **稍后查看收藏库** 点击打开后仍保留，支持 URL 去重、搜索和排序
- **灵活分组** 可按域名、6 个预置分类或自定义分组展示
- **浅色 / 深色 / 跟随系统主题** 适配白天与夜间使用
- **localhost 端口分组** 开发时每个项目端口清晰可辨
- **100% 本地** 数据绝不离开你的电脑
- **纯 Chrome 扩展** 无需服务器、Node.js、npm 或任何额外配置

### 时间与统计
- **会话时间追踪** 实时显示每个域名的浏览时长
- **域名计时徽章** 每张域名卡片上实时更新的计时器
- **历史统计** 在「今天 / 本周 / 本月 / 本年」之间切换，查看时间去向
- **不计时域名** 支持输入完整 URL 或域名，规范化后从所有统计中排除
- **每日域名预算** 显示接近/超过预算状态，并在到达预算时通知一次
- **24 小时热力图** 按域名可视化每日浏览强度（今天视图）

### 专注与隐私
- **Private Mode** 在选定时长内暂停所有追踪，到期自动恢复
- **Focus Timer** 显示倒计时并在结束时发送系统通知
- **Strict Focus** 只允许白名单中的精确域名或通配域名，其他页面跳转到插件内阻止页，结束后自动恢复
- **可配置空闲检测** 支持 30 秒 / 1 / 3 / 5 / 10 分钟或关闭，播放声音的标签自动豁免

### 数据与历史
- **JSON / CSV 导出** 下载完整的本地时间账本
- **历史保留期限** 可永久保留，或自动清理 30 / 90 / 180 / 365 天以前的数据
- **安全清空历史** 只清理时间记录，不删除稍后查看和设置

---

## 手动安装

**1. 克隆仓库**

```bash
git clone https://github.com/dengduck/tabpus.git
```

**2. 加载 Chrome 扩展**

1. 打开 Chrome，访问 `chrome://extensions`
2. 右上角开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择克隆仓库中的 `extension/` 文件夹

**3. 打开新标签页**

你会看到 Tabpus。

---

## 工作原理

```
你打开一个新标签页
  → Tabpus 展示所有标签，按域名分组
  → Homepages（Gmail、X 等）在顶部独立成组
  → 点击任意标签标题直接跳转
  → 关闭不需要的分组（音效 + 彩纸）
  → 关闭前先保存标签到"稍后阅读"
  → 切换到 本周/本月/本年 查看浏览历史
  → 不希望留下记录时开启 Private Mode
  → 开启 Focus Timer，需要时使用 Strict 白名单模式
  → 导出 JSON/CSV，或设置自动保留期限
```

一切运行在 Chrome 扩展内部。无外部服务器、无 API 调用、无数据外传。标签和浏览历史存储在 `chrome.storage.local`。

---

## 技术栈

| 技术 | 实现 |
|------|------|
| 扩展 | Chrome Manifest V3 |
| 存储 | chrome.storage.local |
| 音效 | Web Audio API（合成音，无文件） |
| 动画 | CSS 过渡 + JS 彩纸粒子 |

---

## 致谢

Tabpus 站在两个开源项目的肩膀上：

**[Tab Out](https://github.com/zarazhangrui/tab-out)**，作者 [Zara](https://x.com/zarazhangrui) —— 本项目的创意起源。Tabpus 最初是 Tab Out 的 fork：用域名分组取代默认新标签页的核心理念、swoosh + 彩纸的关闭动效、以及"稍后保存"的书签流程，都源自 Zara 的设计。此后 Tabpus 已**完全重写**（v2.0 —— 全新模块化架构，与 v1 零共享代码），但创意火花始于那里。感谢 Zara 以 MIT 许可证开源了这个项目。

**[web-activity-time-tracker](https://github.com/brave-tools/web-activity-time-tracker)** —— 一个优秀的 Chrome 网页活动时间追踪扩展（Vue/TypeScript 技术栈，与我们的原生 ES Module 完全不同）。通过研究它的架构，我们在 v2 从零构建时间追踪层时获得了宝贵的设计启发：

- `chrome.idle` API 的正确用法 + 对播放中音视频的豁免思路
- 限时 block 的极简实现路径（通过 `chrome.tabs.update` 跳转到本地 block 页面，零额外权限）
- 通过对照其架构，帮助我们锁定了**单一时间账本**模型（见 `docs/DECISIONS-v2.md` D17）

感谢两个项目坚持开源，让这种相互学习成为可能。

---

## 许可证

MIT 许可证。由 [Zara](https://x.com/zarazhangrui) 最初创建为 [Tab Out](https://github.com/zarazhangrui/tab-out)。由 [dengduck](https://github.com/dengduck/tabpus) 重写并扩展为 **Tabpus**。

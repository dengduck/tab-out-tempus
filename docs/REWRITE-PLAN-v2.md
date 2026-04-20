# Tab Out Tempus v2 — 重写启动方案

> 决策日期：2026-04-20  
> 触发原因：v1.3.3→1.3.5 迭代中反复踩时间逻辑 bug，根因是 app.js / background.js 耦合过重，没有模块边界。  
> 决策方式：邓老师四选一确认 + 2026-04-20 二次确认 5 个补充决策（见 `DECISIONS-v2.md`）。

## 📍 执行状态（2026-04-20 更新）

- ✅ 第 2 节的归档和分支操作已执行完毕（tag `v1.3.5-legacy` + 分支 `legacy-v1` + 分支 `rewrite-v2` 已建立）
- ✅ 补充决策已落地为 `docs/DECISIONS-v2.md`
- ✅ Private Mode 作为 v2.0 MVP，v1 实现参考见 `docs/v1-feature-reference/private-mode.md`
- ✅ chrome.idle API 纳入 M4 TimeTracker（60s 无键鼠暂停）
- ✅ **M0 架构冻结完成**（2026-04-20）：ARCHITECTURE-v2.md §3 所有接口签名、§5 消息协议、§6 存储 schema、§8 UI 初始化流程、§9.2 测试用例清单全部敲定；新增决策 D9 (pauseReasons Set) / D10 (混合消息模式) / D11 (UI 订阅式增量)
- ✅ **M1 骨架搭建完成**（2026-04-20）：清空 v1 代码；按 ARCHITECTURE-v2 §2 建 background/ ui/ shared/ tests/ 共 27 个源文件；manifest v2.0.0（SW type:module，新增 alarms/idle 权限）；最小 sw.js + ui/main.js 打通 UI↔SW 通信链路（REQ_UI_READY / REQ_GET_STATE）；所有业务模块占位带 JSDoc 接口契约和目标 M 里程碑标注；新增决策 D12（confetti/swoosh 保持纯 JS 路线，不引入 assets/）
- ✅ **M2-M5 完成**（2026-04-20，HEAD `52e7d1c`）：tab 分组、close FX、TimeTracker（15/15 测试）、时间 UI（37/37 测试）全部跑通真机验收；追加决策 D13-D16
- ⚠️ **M5 后复盘发现架构冗余**（2026-04-20 深夜）：拉对手 `web-activity-time-tracker` 对照研究 + 切 tab 数字回退 Bug 诊断后，锁定**单一时间账本**模型为长远最优。追加决策 **D17-D23**（详见 DECISIONS-v2.md 补丁 #001/#002）：
  - D17 时间模型收敛为单一时间账本，废止 `tabCumulativeMs` + D7.1/D7.2/D15/D16
  - D18 不计时域名（Excluded Domains）= **永久域名级黑名单**（无论 Private Mode 开关状态，列表内域名永远不计时）
  - D19 域名分类标签化（预置 6 类 + 用户维护，v2.1）
  - D20 chrome.idle 阈值用户可选，默认 3 分钟（覆盖 D4 的 60s）
  - D21 限时 block 机制（v2.1）
  - D22 Private Mode = **全局临时关闸**（开启后限定时长内所有域名都不计时），与 D18 正交
  - D23 致谢参考项目 `web-activity-time-tracker`（README / CHANGELOG / GitHub About 都加）
- ⏭️ 下一步：**M4.5 架构收敛**（把双账本收敛为单一 timeLog 账本 + audible 豁免 + idle 阈值可选），UI 层 API 不变无感；完成后进 M6 历史统计

---

## 1. 锁定的决策

| 维度 | 选择 | 含义 |
|---|---|---|
| **架构** | 轻：纯浏览器 ES Module | 多个 `.js` 文件 + `<script type="module">` import/export；**无 npm、无构建、无 TypeScript**。保持"开箱即用、零依赖"哲学。 |
| **MVP 范围** | 核心 + 多窗口 focus + Focus Timer + 黑名单 | 见下方功能矩阵。其他功能（生产力 Banner、Tab 休眠、导入导出等）**推迟到 v2.1+**。 |
| **Per-tab 时长** | v2.0 就做，全新设计 | 用**单调计数器 + 独立 TimeTracker 模块 + 单元测试**，而不是从 timeLog 反推。 |
| **存档策略** | commit v1.3.5 + tag `v1.3.5-legacy` + 新建 `legacy-v1` 分支 + `rewrite-v2` 从 v1.3.0（`070fafc`）起步 | 旧版永久可回，心理压力归零。 |

---

## 2. 存档与分支操作步骤（共 6 步，5-10 分钟）

> ⚠️ 动手前先确认：当前 working tree 所有 1.3.5 改动**您想保留**还是**丢弃**？  
> 本方案默认**保留**（commit 进 our-features 再打 tag），如果想丢弃，把第 1 步改成 `git stash` 或 `git restore`。

```bash
# 0. 先退回到仓库根
cd "/Users/jaydendeng/Documents/Obsidian Vault/一些小项目/tab-out-Tempus/tab-out-tempus-workspace"

# 1. 把当前 1.3.5 的改动全部 commit（含 .workbuddy/ 以外的所有文件）
#    .workbuddy/ 按 .gitignore 处理，不入库
git add CHANGELOG.md extension/ docs/REVIEW_ISSUES.md extension.zip
git commit -m "chore(legacy): freeze v1.3.5 before rewrite"

# 2. 打 tag 固化 v1.3.5 的最后状态
git tag -a v1.3.5-legacy -m "Final snapshot of v1.x architecture before v2 rewrite"

# 3. 以当前 HEAD 为起点建 legacy-v1 分支（永久保留）
git branch legacy-v1

# 4. 从 v1.3.0 的干净点（070fafc）创建 rewrite-v2 分支
git checkout -b rewrite-v2 070fafc

# 5. 把 docs/ 从 our-features 拉过来（保留设计经验，作为 v2 设计输入）
git checkout our-features -- docs/

# 6. 推送所有分支和 tag 到 origin
git push origin our-features legacy-v1 rewrite-v2
git push origin v1.3.5-legacy
```

**操作完毕后的仓库状态：**
- `main` — 跟踪 upstream（不动）
- `our-features` — 停在 v1.3.5-legacy，**冻结不再改**
- `legacy-v1` — 与 our-features 同 HEAD，长期存档
- `rewrite-v2` — **✨ 新开发主线**，从 v1.3.0 的 rebrand 版起步 + 带 docs/

---

## 3. MVP 功能矩阵（v2.0 发布标准）

### ✅ 必须有（MVP 范围）

**UI 核心：**
- [ ] 域名分组网格（localhost 按端口分组）
- [ ] Homepages 特殊分组
- [ ] 关闭单个标签（swoosh 音效 + confetti）
- [ ] 关闭整组、关闭重复
- [ ] 重复标签检测与橙色 badge
- [ ] 跨窗口点击跳转
- [ ] Save for Later 侧边栏

**时间追踪：**
- [ ] Session 计时 + Header "今日工作"
- [ ] 历史统计视图（Today / Week / Month / Year）
- [ ] 24 小时热力图
- [ ] **Per-tab chip 时长 badge（全新 TimeTracker 设计）**
- [ ] **域名卡片时长 = Σ(该域名所有 open tab 时长)**
- [ ] **多窗口 focus 模型（v1.3.4 已验证经验直接用）**

**个人常用：**
- [ ] Focus Timer（番茄钟/自定义时长）
- [ ] **不计时域名（D18）** — 永久域名黑名单：列表内域名**任何时候**都不计时（与 Private Mode 正交）
- [ ] **Private Mode（D22，从 v1 移植）** — 全局临时关闸：开启后指定时长内**所有域名**都不计时，时长到期自动关闭
- [ ] **chrome.idle 集成（D20 用户可选阈值，默认 3 分钟）** — 键鼠空闲超阈值自动暂停；audible 豁免（看视频不误暂停）

### 🔜 v2.1 再加

- [ ] **限时 block**（到达域名/分类每日限额时跳转 block 页面，D21）
- [ ] **到时通知**（chrome.notifications 提醒）
- [ ] **域名分类标签化 + 组限额**（预置 6 类 + 可维护，D19）
- [ ] 生产力 Banner
- [ ] Tab 休眠 / 唤醒（Chrome Discard API）
- [ ] 历史数据导入 / 导出
- [ ] 自定义分组（Bento layout 的用户拖拽）
- [ ] 工具栏 badge 计数（原 main 有的）
- [ ] 更新检查通知

### ❌ 暂不考虑

- TypeScript 迁移
- 组件化框架（Preact 等）
- 云同步、账号系统
- 多语言（保持中英双文案即可）

---

## 4. 开发里程碑（建议节奏）

> 约束：邓老师每晚可投入 1-2 小时，周末单日 4-6 小时。

| 里程碑 | 预估工作量 | 交付物 |
|---|---|---|
| **M0: 架构冻结** | 0.5 晚（今晚） | `ARCHITECTURE-v2.md` 定稿，模块边界/接口签名全部写死 |
| **M1: 骨架 + 静态 UI** | 1 晚 | manifest、index.html、css 变量系统、空的模块文件 + import 图跑通；chrome://extensions 能加载但没实际功能 |
| **M2: Tab 读取 + 域名分组渲染** | 1-2 晚 | 打开新 tab 能看到所有标签按域名分组；Homepages 分组；点击跳转 |
| **M3: 关闭 + 重复检测 + confetti** | 1 晚 | 关闭交互回来（含音效动画） |
| **M4: TimeTracker 模块（核心难点）** | 2-3 晚 | 独立 `timeTracker.js` + 单元测试文件；能准确维护 tabCumulativeMs 单调计数器；多窗口 focus 模型内置；**chrome.idle 集成（60s 无键鼠 → pauseByIdle）**；守门函数统一拦截 Private Mode / Focus Timer / 黑名单 |
| **M5: 时间 UI 接入** | 1-2 晚 | Header "今日工作"、chip badge、域名卡时长 |
| **🆕 M4.5: 架构收敛（单一时间账本）** | 1-2 晚 | 依据 D17，删除 `tabCumulativeMs` Map；`getTodayTotalMs` / `getTabCumulativeMs` / 新增 `getDomainTodayMs` / `getHourlyBuckets` 全改为从 timeLog 纯函数现算；audible 豁免；D20 idle 阈值用户可选；`tests/timeLedger.test.js`（含 Bug 1 回归用例 + SW 重启无损断言）；UI 层 API 不变，M5 回归通过 |
| **M6: 历史统计 + 热力图** | 2 晚 | Today/Week/Month/Year + 24h 热力图（在干净账本基座上一次写对） |
| **M7: Save for Later** | 1 晚 | 侧边栏 + chrome.storage.local 持久化 |
| **M8: Focus Timer + 不计时域名 + Private Mode** | 1-2 晚 | 三个功能共享 `pauseReasons` Set 架构但语义正交：Focus Timer = 时段级主动白名单，不计时域名（D18）= 域名级永久黑名单，Private Mode（D22）= 时段级全局关闸 |
| **M9: 打磨 + README** | 1 晚 | 改 README、CHANGELOG、版本号 2.0.0 |

**合计：约 12-17 个工作晚**（M4.5 追加后 +1~2 晚），折合 3-4 周（含周末）。

**⚠️ 当前位置**：M5 完成（commit `52e7d1c`，回滚锚点）；下一步 **M4.5**。M4.5 commit 出问题可一键 reset 回 `52e7d1c`，UI 层代码不受影响。

---

## 5. 关键工程原则（写进 v2 代码注释）

> ⚠️ 本节原文（P2/P3 关于 `tabCumulativeMs` 的约束）已随 D17 废止。以下是 M4.5 收敛后的新版本。

1. **单向数据流**：storage / SW 是真相源 → 前端只渲染，不回写业务状态。
2. **timeLog 是唯一事实源**——所有时长聚合都从 timeLog 纯函数现算，禁止在内存里维护冗余的聚合字段（这是 D17 废止双账本的核心铁律）。
3. **timeLog append-only**——不修改、不删除历史 slice；当前 slice 关闭时 append 一条，永远不回写。
4. **唯一可变状态 = `currentSlice`**（TimeTracker 模块内）+ `pauseReasons: Set`；其它一切皆 immutable。
5. **每个模块一个 `.js` 文件**，对外只暴露 named exports，不要全局变量。
6. **模块之间只通过接口通信**，禁止跨模块直接读写对方的内部状态。
7. **写在前面的 3 个约定（v1 踩过的坑）：**
   - `chrome.windows.onFocusChanged` 是焦点的唯一真相源
   - `chrome.alarms`（最小 30s）做周期存盘 + 长 slice 强制 finalize，不要用 `setInterval`
   - `chrome.storage.session` 不跨 SW 重启，真相要写 `.local`

---

## 6. 风险与回滚

| 风险 | 应对 |
|---|---|
| 重写期间邓老师想临时用旧版 | 随时 `git checkout legacy-v1 && 在 chrome://extensions 切加载目录` |
| MVP 跑到 M5 发现 TimeTracker 设计不对 | 因为 TimeTracker 是独立模块+单测，**只需重写单个文件** |
| 功能搬着搬着又回到 3000 行 | 每个模块设硬性上限 400 行，超限必须拆分 |
| 邓老师忙起来断档超过 2 周 | `docs/REWRITE-PLAN-v2.md` 和 `ARCHITECTURE-v2.md` 就是"召回文档"，继续时先读这两份 |

---

## 7. 下一步（等邓老师拍板）

- [ ] **选项 A**：今晚就执行第 2 节的 6 步存档操作，然后我继续写 `ARCHITECTURE-v2.md`
- [ ] **选项 B**：先让我把 `ARCHITECTURE-v2.md` 写完（纸上设计），周末再一口气动手 M0→M1
- [ ] **选项 C**：方案我都认可，您替我再细化某一部分（比如 TimeTracker 接口）再决定

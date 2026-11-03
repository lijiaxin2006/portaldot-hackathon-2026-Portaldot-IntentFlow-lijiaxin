# Dashboard 前端风格重构 P0 基线记录

> 基线日期：2026-11-01  
> 代码基线：`main` / `3fc15c4`  
> 状态：**P0 已完成，范围已冻结**

## 1. 基线目标

本记录把当前 Dashboard 作为后续视觉重构的可比较基线，确认页面的业务定位、数据语义、前端入口和只读边界。工作区中已有未提交文件属于既有用户资产，本次基线只记录，不覆盖、不回滚。

Dashboard 是本地只读运维面板，读取已保存的 Runtime、流动性池、Intent 执行证据和验收记录。它不是行情交易终端，不发起交易、签名、广播或链上写入。

## 2. 当前实现清单

| 文件 | 基线规模 | 当前职责 |
| --- | ---: | --- |
| `apps/dashboard/public/index.html` | 82 行 | 页面结构、顶栏、摘要、池快照、证据表、验收区 |
| `apps/dashboard/public/styles.css` | 103 行 | 浅色主题、品牌绿、表格、状态标签和两档移动端媒体查询 |
| `apps/dashboard/public/app.js` | 183 行 | `/api/overview` 读取、池和证据渲染、搜索、详情和摘要统计 |
| `apps/dashboard/server.mjs` | 113 行 | loopback 静态服务、只读 SQLite 查询和 JSON API |

当前没有前端构建步骤，`package.json` 通过 `npm run p7:dashboard` 直接启动 Node 服务。

## 3. 页面区域与数据映射

| 页面区域 | HTML 标识 | JS 数据来源 | 基线行为 |
| --- | --- | --- | --- |
| 顶栏刷新 | `#refresh`、`#updated-at` | `refresh()` | 手动请求 `/api/overview`，显示本地更新时间 |
| 数据库状态 | `#database-state` | `snapshot.database` | 显示已连接、尚未创建或暂不可读取 |
| 最新运行 | `#metric-run`、`#metric-runtime` | `snapshot.runs[0]` | 显示 run id 和 runtime version，缺失时显示未采集 |
| 池快照 | `#metric-pools`、`#pools-body`、`#snapshot-block` | `snapshot.pools`、`snapshot.runs[0]` | 显示池地址、资产、储备、费率和区块 |
| 执行摘要 | `#metric-evidence`、`#metric-status`、`#metric-latency` | `snapshot.evidence` | 统计证据数、Confirmed 数量和模拟耗时均值 |
| 证据筛选 | `#search`、`#evidence-body` | `execution.intent_id`、`route_hash`、`execution.tx_hash` | 按哈希字符串筛选证据 |
| 证据详情 | `#detail` | 当前选中的证据记录 | 鼠标点击表格行后展开 Intent、Route、Receipt、事件和风险信息 |
| 验收进度 | `#requirement-*` | `evidence`、`deployments` | 显示 finalized 数量、部署记录和性能样本数 |

## 4. 当前视觉与布局基线

### 视觉基线

- 页面背景为 `#f5f7f6`，内容表面为白色，使用细边框分区。
- 品牌标识和主按钮使用品牌绿；状态标签目前有默认、`confirmed` 和 `rejected` 三类明确样式。
- 主字体为 `Inter, "Segoe UI", "Noto Sans SC", sans-serif`；hash 使用 `Cascadia Code / Consolas`。
- 普通卡片和表格没有明显阴影，圆角约 4–6px，整体接近浅色运维台。
- 页面还没有统一的语义颜色 Token，存在直接写入的颜色值。

### 响应式基线

| 视口 | 当前行为 |
| --- | --- |
| 默认桌面 | 主内容最大宽度 1440px；摘要四列；验收区左右两栏 |
| ≤820px | 顶栏和主内容缩小边距；摘要变为两列；验收区上下排列 |
| ≤540px | 顶栏允许换行；标题和搜索纵向排列；详情两列；证据表最小宽度 980px 并在容器内滚动 |
| 320px | CSS 设置了页面最小宽度，但尚未形成独立的 320px 验收记录 |

## 5. 已确认的问题清单

这些问题是后续 P1–P6 的输入，不在 P0 阶段直接修复。

| 编号 | 优先级 | 问题 | 影响 |
| --- | --- | --- | --- |
| P0-UI-01 | 高 | CSS 颜色、字体和表面规则没有统一 Token | 后续局部调整容易产生语义重复和颜色漂移 |
| P0-UI-02 | 高 | `app.js` 根据原始状态生成 class，但样式只明确覆盖 `confirmed`、`rejected` | 待处理、未提交或未知状态缺少稳定的视觉语义 |
| P0-UI-03 | 高 | 证据行只绑定 `click`，没有键盘焦点、Enter 或 Space 行为 | 详情无法通过键盘可靠打开 |
| P0-UI-04 | 中 | API 失败只更新数据库状态，表格仍使用普通空数据文案 | 读取失败与暂无证据容易混淆 |
| P0-UI-05 | 中 | 搜索占位文案写成 `Intent / route / tx hash`，实际逻辑匹配的是三个哈希值 | 用户可能误解为可按任意 route 文本搜索 |
| P0-UI-06 | 中 | 数值没有统一启用 tabular numerals | 金额、区块和耗时的纵向比较不够稳定 |
| P0-UI-07 | 中 | 表格交互行没有专门的语义提示或焦点样式 | 鼠标用户依赖 hover，键盘用户缺少入口反馈 |
| P0-UI-08 | 低 | 页面没有独立记录 320px、长 hash 和错误详情的视觉结果 | 窄屏验收缺少可重复基准 |

## 6. 只读边界确认

已确认的服务边界：

- `server.mjs` 只接受 `GET` 请求，其他方法返回 405。
- SQLite 以 `readOnly: true` 打开，并执行 `PRAGMA query_only = ON`。
- `/api/health` 明确返回 `readOnly: true`。
- 页面只有手动刷新，没有 WebSocket、自动刷新、签名、广播或写入接口。
- 当前工作区没有 `data/intentflow.sqlite3`，因此 Dashboard 的证据状态应显示为本地证据库尚未创建。

`evidence/p0/` 中的测试网探测报告属于链上合约生命周期证据，不是 Dashboard 的应用 SQLite 数据，不能直接当作页面运行数据填充。

## 7. P0 范围冻结

### P1–P6 允许触及

- `apps/dashboard/public/styles.css`：Token、布局、表格、状态和响应式样式。
- `apps/dashboard/public/index.html`：状态容器、表格语义、键盘操作所需的最小结构调整。
- `apps/dashboard/public/app.js`：状态映射、空/失败状态、搜索文案和详情键盘交互。
- `docs/`：实施、验收和交接记录。

### 明确冻结

- 不改 `apps/dashboard/server.mjs` 的 API 契约和只读行为。
- 不改 Rust、合约、SQLite schema、交易执行、签名和广播流程。
- 不增加暗色交易终端、行情图表、WebSocket、自动刷新或外部字体/图标依赖。
- 不用假数据填充缺少的 SQLite 证据，不把 P0 链上证据写成 P7 Dashboard 数据。

## 8. P0 结论

P0 的基线、字段映射、问题清单和范围冻结已经完成。下一阶段应从 P1 Token 与 CSS 基础层开始；P7 只能在 P1–P6 完成后重新执行并决定是否签署视觉重构通过。

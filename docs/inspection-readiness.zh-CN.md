# 项目检查说明

检查日期：2026-10-23（Asia/Shanghai）  
仓库基线：`main`，提交 `3fc15c4dd7c511feca45b61bd3e545f8625d5ae6`  
检查范围：公开仓库、阶段材料、已保存的测试网证据，以及一个可复现的本地 Solver 演示。

## 检查结论

| 检查项 | 当前结论 |
|---|---|
| 公开 GitHub 仓库 | 已有公开仓库；匿名读取可见当前 `main` 提交。 |
| 项目进度 | Rust 单链路由、Solver、Router 合约和本地运维工具已实现；完整测试网兑换闭环尚未完成。 |
| 测试网集成证据 | P0 有真实合约上传、实例化、读取、调用和事件证据；P2 合约部署预检因存储押金不足被阻塞，没有 P2 广播交易。 |
| 核心功能演示 | 可本地复现 Solver 对直连和两跳候选进行报价、风险约束检查并选择路线；此演示使用固定模拟快照，不连接链。 |

本文核对了已保存材料和代码，没有在本轮重新执行整套测试，也没有提交新的测试网交易。仓库 CI 工作流存在，但本说明不据此宣称 CI 已通过。

## 1. 公开仓库

- GitHub：[Portaldot-IntentFlow](https://github.com/lijiaxin-jp/Portaldot-IntentFlow)
- 检查基线：[提交 `3fc15c4`](https://github.com/lijiaxin-jp/Portaldot-IntentFlow/commit/3fc15c4dd7c511feca45b61bd3e545f8625d5ae6)
- 当前主分支：`main`

检查时，匿名远端查询返回的 `main` HEAD 与本地基线提交一致。当前工作区新增的本说明和演示代码尚未发布到该提交；要让 GitHub 检查者直接访问这些新增内容，需要后续提交并推送。

## 2. 开发进度

| 阶段 | 已有内容 | 状态与限制 |
|---|---|---|
| P0 测试网能力探测 | runtime/metadata、Contracts dry-run、Wasm 上传、实例化、读取、调用及事件记录。 | 一次合约生命周期有 finalized 证据；对已部署实例的重复读取和调用成功。第二个独立实例因存储押金不足，完整重复性门槛仍为 inconclusive。 |
| P1 Rust 项目骨架 | 领域模型、报价/路由引擎、Portaldot client、池适配器、Solver、Executor、配置和 SQLite 证据存储。 | 代码已在仓库；本轮只编译了路线演示所需依赖，没有重新编译整个 workspace，也未核验到可引用的本轮 CI 通过记录。 |
| P2 ink! 合约 | PSP22 测试代币、恒定乘积池、单/双跳 Router 和共享接口；有本地测试代码。 | 合约间 runtime 回滚验收尚未完成；本说明未重跑本地合约测试。 |
| P3 测试网部署 | 部署计划、Wasm/metadata hash 核对、构造和调用 dry-run、断点续跑工具。 | 最新保存的预检报告为 `failed_or_blocked`，`broadcast_count=0`，没有 P2 合约地址。测试账户约有 93.57 tPOT；三份唯一 Wasm 的代码存储押金估算约为 3,836.70 tPOT，尚未计入实例存储押金和交易费。 |
| P4/P5 client、Adapter、Solver | 只读链状态和池快照适配、固定区块 dry-run 接口、确定性路线报价及风险报告。 | 代码已具备；当前 runtime 在线对照和 P5 验收场景仍待完成。 |
| P6/P7/P8 执行证据、Dashboard、验收报告 | SQLite 证据存储、只读本地 Dashboard、公开验收报告生成器。 | 工具已存在；生成器只汇总真实记录，不生成链上证据。当前缺少 P2 部署和足够的成功交易样本。 |
| 跨链 C0/C1 | C0 能力调研材料；C1 模拟器设计文档。 | 尚未确认 Portaldot 官方桥或消息协议；C1 模拟器尚未编码，不能宣称已有跨链能力。 |

代码结构和可公开的阶段边界可从 [README](../README.md)、[P6–P8 运维说明](p6-p8-operations.zh-CN.md)、[Solver](../crates/portaldot-solver/src/lib.rs)、[Executor](../crates/portaldot-executor/src/lib.rs) 和合约目录核对。

## 3. 测试网集成证据

### P0：最小合约生命周期

[P0 证据摘要](../evidence/p0/README.md) 及其关联 JSON 报告记录了：

- `Contracts` runtime 能力、metadata 和 dry-run 查询；
- 一份 5,000 字节探测 Wasm 的上传，在 finalized 区块收到 `Contracts.CodeStored`；
- 合约实例化、预测地址匹配，以及 finalized `ping` 调用和事件；
- 对同一实例重复读取和 `ping`，结果及事件可核对。

P0 报告的总体判断仍是 `inconclusive`：第二个独立实例的 storage deposit dry-run 返回 `Contracts.StorageDepositNotEnoughFunds`，没有广播第二次实例化交易。该证据证明的是小型探测合约生命周期，不是 P2 Router 部署或代币兑换。

相关文件：[能力报告](../evidence/p0/capability-report.json)、[交易索引](../evidence/p0/transactions.json)、[首次生命周期](../evidence/p0/lifecycle-run.json)、[重复读取和调用](../evidence/p0/lifecycle-repeat.json)。

### P2 部署预检

本地工作区中的 `evidence/p3/p2-deployment.json` 是只读预检结果：状态 `failed_or_blocked`，广播数为 0，没有 PSP22、AMM Pool 或 IntentRouter 的已部署地址。报告记录的可用余额约 93.57 tPOT，三份唯一 Wasm 的代码押金估算约 3,836.70 tPOT；估算不含实例状态押金和交易费。该报告证明部署条件检查已运行，不证明 P2 合约已部署。当前 `.gitignore` 排除了该 JSON，因此它没有包含在公开仓库的检查基线中；上面的 P3 数字是对本地报告的摘要。

### 证据边界

当前可核验的真实测试网集成范围是 P0 探测合约。P2 部署、池初始化、Router 成功兑换、滑点/截止时间保护失败，以及端到端应用记录，均没有本说明可以引用的完成证据。链下本地演示不能代替这些链上验收。

## 4. 核心功能初步演示：风险感知路线选择

从仓库根目录运行：

```powershell
cargo run --locked -p portaldot-solver --example route-demo
```

该演示在内存中构造三个固定池快照：A→B 直连池，以及 A→C→B 两跳路径。Solver 会枚举候选、按 exact-input 公式计算输出、检查最低输出/手续费/价格冲击约束，并输出选中路线及确定性 hash。价格冲击上限设为 150 bps；因此报价更高但风险超限的两跳路线会被拒绝。输入金额为 1,000,000 单位；演示采用合成池储备，不代表真实代币数量或测试网报价。

本机运行输出：

```text
network=local-demo (no RPC, signing, or broadcast)
intent: amount_in=1000000 A->B, min_out=1000000, max_fee=100000
candidate_count=2
candidate: path=A->B@pool-11 hops=1 amount_out=1006901 risk_score=1006901 price_impact_bps=99 accepted=true reason=none
candidate: path=A->C@pool-12,C->B@pool-13 hops=2 amount_out=1023719 risk_score=- price_impact_bps=- accepted=false reason=price_impact_above_limit
selected_route_hash=9e49aa08da3593b7801e6cb986d7becece1f78eb8d81893c4bc2f1562f02c1a6
report_hash=cf845b5b864af707ce7e4bd01ef0a8b927fcde3e46897b1ee17d2b6fd053d9b7
```

演示边界：只计算路线，不连接 RPC、不签名、不广播，也不调用 Router。它展示 Rust Solver 的本地核心能力，不代表真实资金兑换已完成。

实现位置：[route-demo 示例](../crates/portaldot-solver/examples/route-demo.rs)、[Solver 路线评估](../crates/portaldot-solver/src/lib.rs)。

## 5. 检查时应保留的表述

- 项目已有可匿名访问的公开 GitHub 仓库和可复现的本地 Solver 路线演示。
- Portaldot 测试网有 P0 探测合约的 finalized 生命周期及事件证据。
- P2 AMM/Router 合约尚无测试网部署或兑换验收证据；最新部署预检因余额不足阻塞。
- 跨链仍处于能力调研和设计阶段，不应描述为已实现。
- P3 预检 JSON 未公开；公开检查者可直接复核的测试网原始材料目前是已纳入仓库的 P0 文件。

以上区分了已实现代码、链上证据和仍待验收项，避免把“代码存在”或“dry-run 通过”写成“产品闭环已上线”。

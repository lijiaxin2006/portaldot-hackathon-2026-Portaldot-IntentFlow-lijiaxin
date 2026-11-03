# P1 当前状态与使用说明

核验日期：2026-10-22  
核验范围：仓库代码、一期阶段定义、现有 P0/P3 证据和操作文档。  
注意：本次只做静态核对，没有重新编译、运行测试或向测试网发送请求。

## 结论

**P1 所定义的独立项目骨架，代码已基本写入仓库；但这不等于一期 DeFi 产品已完成，也不等于测试网交易已验收。** 一期计划把 P1 定义为 workspace、配置、错误模型、日志和 CI 基础。当前仓库已有对应 Rust crate、配置解析、结构化 tracing 和 CI 工作流。

可直接使用的目前主要是库模块、配置校验器、只读探测器、合约构建工具和部署预检工具。仓库没有一个把“读池—Solver 报价—Router dry-run—签名提交—证据入库”串起来的现成 P1 命令行服务。跨链也不属于 P1；Portaldot 官方跨链能力未确认，C1 模拟器目前只有方案文档。

## 阶段状态

| 阶段 | 当前状态 | 已有内容 / 未完成内容 |
|---|---|---|
| P0 能力探测 | 单合约生命周期有真实测试网证据；严格重复部署门槛仍未通过 | 现有报告记录了 Wasm 上传、实例化、读取、调用和事件；第二个独立实例因存储押金不足未能完成 dry-run，整体判定为 inconclusive。见 `evidence/p0/README.md` 和 `evidence/p0/capability-report.json`。 |
| P1 项目骨架 | **代码结构已具备；当前没有新的 CI/构建通过记录** | 有 workspace、领域和引擎库、Portaldot client、DEX adapter、Solver、Executor、配置和证据存储；有 `.github/workflows/rust.yml`。默认配置关闭执行，并要求 dry-run。 |
| P2 合约 | 源码和本地测试代码已存在；跨合约 runtime 验收未完成 | 包括测试 PSP22、AMM Pool、IntentRouter 和共享接口。文档说明本地测试不能证明合约间回滚；本次未重新运行测试。 |
| P3 测试网部署 | **未部署，预检被余额/押金阻塞** | `evidence/p3/p2-deployment.json` 状态为 `failed_or_blocked`，`broadcast_count=0`，没有 P2 合约地址。报告记录可用余额约 93.57 tPOT，三份唯一 Wasm 的代码存储押金估算约 3,836.70 tPOT，代码押金差额约 3,743.13 tPOT；尚未计入合约状态押金和交易费。 |
| P4/P5 client、Adapter、Solver | 主要代码模块已存在；在线 runtime 对照和验收未完成 | 可以读取最终区块、runtime、合约事件和池快照，生成路线报价与风险报告；当前没有本轮测试网兼容性验证或 P5 验收记录。 |
| P6/P7/P8 执行记录、Dashboard、公开报告 | 本地工具代码存在；链上验收数据不足 | Executor、SQLite evidence store、只读 Dashboard 和验收报告生成器已在仓库。报告生成器不会制造链上证据；当前尚无满足一期门槛的部署、交易和性能样本。 |
| 跨链 C0/C1 | C0 报告已交付；C1 尚未实现 | 官方仓库未发现可用跨链桥；本地双链模拟器目前只有设计文档，不能作为测试网跨链证明。 |

### “代码编写完整”的具体含义

- 如果指 **P1 阶段定义的项目骨架**：从文件结构看，已基本完成。
- 如果指 **一期可真实执行并通过测试网验收的 DeFi 闭环**：尚未完成。P2 合约未部署，真实 Router swap 和保护性失败交易没有证据。
- 如果指 **跨链功能**：尚未实现。现有 P1/P2 单链代码不能被描述为跨链能力。
- P1 完成标准还包括可编译；CI 工作流配置了编译和合约测试步骤，但本说明没有 CI 运行结果，因此不把“有 workflow”写成“CI 已通过”。

## 现在如何使用

以下命令从仓库根目录运行。Rust workspace 声明最低 Rust 版本 1.90；Windows 下合约构建脚本使用 Docker 中的固定 Linux 工具链。只读/本地步骤不需要账户助记词。

程序集成时可组合这些库接口：`PortaldotClient::connect` 连接节点，`InkAmmPoolAdapter::from_contract_bundle` 按 ink! bundle 读取池，`portaldot_solver::evaluate/solve` 计算路线，`portaldot_executor::dry_run` 做固定区块模拟，`SqliteEvidenceStore` 保存证据。`execute_and_record` 包含签名提交流程，但需要已部署的 Router、有效账户、执行策略和成功 dry-run。仓库目前没有把这些步骤封装成一个可直接启动的交易服务。

### 1. 编译链下 Rust workspace

```powershell
cargo check --workspace --locked
```

这一步编译领域类型、报价和路线引擎、配置、Portaldot client、DEX adapter、Solver、Executor 与 evidence store。它不连接测试网，也不发送交易。

### 2. 校验示例配置

```powershell
cargo run -p portaldot-config --example validate -- config/portaldot-testnet.toml
```

这只校验 TOML 字段和策略约束。示例配置中的合约地址为空，`execution.enabled=false`；校验通过不代表已发现合约或已具备交易条件。

### 3. 运行合约本地测试并构建 Wasm

```powershell
cargo test --manifest-path contracts/Cargo.toml --workspace --locked
pwsh -File scripts/build-p2-contracts.ps1
```

测试覆盖本地 token、Pool 和 Router 逻辑，但不替代真实 contracts runtime 的跨合约回滚测试。构建成功后，bundle 和可部署 Wasm 位于 `target/p2-contracts/`。

### 4. 只读探测 Portaldot 测试网

先安装 Node 依赖：

```powershell
npm ci
$env:PORTALDOT_TESTNET_WS_URL = 'wss://test-node-v3.portaldot.dev'
npm run p8:probe
```

`p8:probe` 读取链身份、runtime、metadata、finalized 区块和 Contracts 能力；不需要测试账户，不签名、不广播。输出文件默认写到公开验收目录，可用该脚本参数指定其他路径。

例如指定一份新报告：

```powershell
npm run p8:probe -- artifacts/p8-public-acceptance/probe-report-next.json
```

### 5. 运行 P2 部署预检

先准备已构建的 `target/p2-contracts/` artifacts，再设置测试网地址和公开账户地址：

```powershell
$env:PORTALDOT_TEST_ACCOUNT_ADDRESS = '<测试账户 SS58 地址>'
npm run p2:deploy -- --report=evidence/p3/p2-deployment-next.json
```

`p2:deploy` 默认只查询 runtime、校验部署计划并 dry-run 构造/合约调用；不会读取助记词、签名或广播。此处使用新的报告路径，避免覆盖现有预检记录。当前阻塞是存储押金不足，重新预检前应先确认资金预算；估算还需覆盖合约状态押金和交易费。

### 6. 查看本地运行证据

```powershell
npm run p7:dashboard
```

默认打开本地只读 Dashboard：`http://127.0.0.1:8787`。它展示 SQLite 已保存的 runtime、池、intent、dry-run 和 receipt；空数据库或缺少交易记录时会显示未采集，不会模拟成功状态。

## 目前不能据此完成的操作

- 不能通过现有命令直接完成 P2 合约部署和 swap；当前测试网预算不足，部署报告没有广播交易。
- 不能从 Dashboard 发起交易；Dashboard 是只读视图。
- 不能把 `cargo check`、本地合约测试或部署 dry-run 当作测试网交易成功证据。
- 不能运行真实跨链路由；Portaldot 没有已确认的官方桥，C1 模拟器尚未实现。

## 下一步建议

1. 先运行链下 workspace 检查和本地合约测试，保存本轮实际输出；同时确认 CI 状态。
2. 根据最新 Wasm hash 和 runtime 押金重新计算资金需求，补足代码押金、合约状态押金与交易费，再重新执行只读部署预检。
3. 由负责人确认部署计划、账户和测试金额后，才进行显式广播；部署后记录代码 hash、metadata hash、地址、交易和区块证据。
4. 在测试网完成池初始化、成功 swap 和保护性失败场景，再进入公开验收。
5. 单链测试网闭环通过后，继续跨链能力确认与 C1 模拟器；跨链模拟结果仍需与真实桥接证据区分。

## 依据文件

- `docs/phase-1-development.zh-CN.md`：P0–P8 定义和一期完成标准。
- `README.md`：workspace 结构、构建和部署预检命令。
- `.github/workflows/rust.yml`：配置的 CI 检查步骤。
- `docs/p3-p5-code-status.zh-CN.md`、`docs/p6-p8-operations.zh-CN.md`：后续阶段代码与验收边界。
- `evidence/p0/capability-report.json`：P0 真实测试网生命周期结果。
- `evidence/p3/p2-deployment.json`：最新保存的 P2 部署预检结果。

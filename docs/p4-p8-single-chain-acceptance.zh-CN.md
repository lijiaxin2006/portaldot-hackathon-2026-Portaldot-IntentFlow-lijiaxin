# P4-P8 单链真实验收运行器

本运行器只针对 `portaldot-testnet` 单链，跨链不在范围内。它读取 P3 finalized 部署报告，核对五个合约地址和链上 code hash，读取两个 AMM 池的 finalized 快照，执行单跳与两跳 Router dry-run，并把运行环境、池快照、报价、模拟结果和失败原因写入 SQLite。

广播模式使用提交前的 best block 生成 route commitment。已部署 Router 的 route age 上限为 2 个区块，而交易 finalized 可能跨过更多区块；best block 能避免 dry-run 通过后因 finalized 等待而过期。

## 只读 / dry-run

先设置节点地址。账户地址可以省略，运行器会从 P3 报告中的 finalized 交易反查签名账户；也可以显式设置 `PORTALDOT_TEST_ACCOUNT_ADDRESS`。此模式不读取助记词，不签名，不广播：

```powershell
$env:PORTALDOT_TESTNET_WS_URL = 'wss://test-node-v3.portaldot.dev'
$env:INTENTFLOW_EVIDENCE_DB = 'data/intentflow.sqlite3'
npm run p4:p8:acceptance -- --dry-run-only --success-count 10
```

dry-run 只代表当前链上状态下的模拟结果。当前 P3 账户的 Router allowance 已为 0，成功场景会记录真实的 `TokenCallFailed`，而不会写成成功；广播模式会先重新 approve Router。

## 真实广播

广播模式需要显式 `--broadcast`，并要求账户地址和助记词同时存在。运行器先 approve Router，再逐笔执行单跳、两跳成功样本和五类保护性失败场景；每笔等待 finalized receipt 后才写入 SQLite：

广播交易带有固定的小额 priority tip，用于满足已部署 Router 两区块 route-age 限制；tip 不写入公开报告。

```powershell
$env:PORTALDOT_TESTNET_WS_URL = 'wss://test-node-v3.portaldot.dev'
$env:PORTALDOT_TEST_ACCOUNT_ADDRESS = '<测试账户地址>'
$env:PORTALDOT_TEST_ACCOUNT_MNEMONIC = '<仅注入当前进程>'
$env:INTENTFLOW_EVIDENCE_DB = 'data/intentflow.sqlite3'
npm run p4:p8:acceptance -- --broadcast --success-count 10
```

当前已部署 Router 的两跳 dry-run 会返回 `InvalidAssetPair`，因此本次成功 finalized 门槛使用 `--single-hop-only`；两跳失败会保留在 SQLite 和公开报告中，作为待修复链上缺口：

```powershell
npm run p4:p8:acceptance -- --broadcast --single-hop-only --success-count 10
```

节点连接不稳定时可用 `--success-only` 分批累计成功样本；每次仍会重新 dry-run、签名并等待 finalized：

```powershell
npm run p4:p8:acceptance -- --broadcast --single-hop-only --success-only --success-count 1
```

公开报告：

```powershell
npm run p8:probe -- artifacts/p8-public-acceptance/probe-report.json
npm run p8:acceptance -- --database data/intentflow.sqlite3 --probe artifacts/p8-public-acceptance/probe-report.json
```

P8 会把 P3 部署、池初始化和 Router 配置的 finalized 交易合并到公开报告，但只有 SQLite 中的 Router 执行 receipt 才计入“成功 finalized 交易 10 笔”门槛。失败交易保留并带有 dry-run/receipt 错误原因。

## 本轮已验证

- finalized P3 部署报告可核对 5 个合约地址和 code hash。
- 两个池快照、runtime、区块范围、机器配置和 dry-run 耗时已写入 SQLite。
- 成功返回和 ink! revert 返回均按 bundle 中的嵌套类型解码；授权不足会记录为 `TokenCallFailed`，不是 ABI 解码错误。
- `SlippageExceeded`、`FeeLimitExceeded`、`InvalidDeadline`、`InvalidAssetPair`、`InvalidAmount` 五类保护性失败可被链上 dry-run 解码。
- 未设置签名环境时不会广播；P8 报告仍保持 `incomplete`，不会把 dry-run 当作交易成功。

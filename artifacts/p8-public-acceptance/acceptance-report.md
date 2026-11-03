# Portaldot IntentFlow 公开验收报告

- 状态：incomplete
- 网络：portaldot-testnet
- 生成时间：2026-11-02T13:46:57.706Z
- Git revision：3fc15c4dd7c511feca45b61bd3e545f8625d5ae6
- 节点浏览器：https://node-console.portaldot.dev/

## 部署

| 合约 | 地址 | 代码 hash | Metadata hash | 部署交易 | 区块 hash |
| --- | --- | --- | --- | --- | --- |
| token_a | 5HqqyY3wh7QGVp61PwZu1SaVpP1MB43zgSkhawXxbZSqw4uV | 0x89d7e0f4e8bb22b51ed3d3e214f875f4fee734861b5d625969436bf0c55cfbd5 | 0x80789771cc96a5f6fe8ecf4976107ee43ab9be7eafb0fbf48a2f4aae1f022289 | 0x6add00b1cb1c46744bcea49d688d4a2708f095bebf94e1e4067b48205b6effe6 | 0x4443b8a74524086d963b4de1bdbc3ecb476d81ee8a3afb4e8334477d1484a4d0 |
| token_b | 5CxhT4eMfjkRHpMMPJeUp6cevGocFDnzk3bHnmaTSpnsHriP | 0x89d7e0f4e8bb22b51ed3d3e214f875f4fee734861b5d625969436bf0c55cfbd5 | 0x80789771cc96a5f6fe8ecf4976107ee43ab9be7eafb0fbf48a2f4aae1f022289 | 0x5e41242d3c2e63271da6cd2be61fa51c00a457049d13c185ad11461ffaa23bcd | 0x0678598cf74f0dc9ebdfa81da570a07517ad04cff71fc87c268543dd7aea2efe |
| pool_a | 5D2WV819oHM3kvEekfLis4f3deHkys2vS6AVAMTGLoi9ZPVx | 0x942348f282c7fb3b0bb14c978337cefd35642977588d149d232f5508f1666dfa | 0x249126089c7235a14c87a2cde0529967a4be2c227fa5d57bc3aed20c55153dd6 | 0x3fb6d6d3bb3a8ae3182df26467dab66801150dd907a0edfcce07132bdfaabc80 | 0x6fcabb4ff500764dc074533c741d2fae1a4fc86f0eba6bfacc6e7d9ef28ac5b8 |
| pool_b | 5DVRsqRZPfXe7hu4FMKAY8zDR43a6u7Y4BiwSWMFR89WbBr7 | 0x942348f282c7fb3b0bb14c978337cefd35642977588d149d232f5508f1666dfa | 0x249126089c7235a14c87a2cde0529967a4be2c227fa5d57bc3aed20c55153dd6 | 0x91a0172d41d4706aff234c1cb79dd64203ca28ece26e91912cd4f40892dfd672 | 0x1787cbc539a40e871446514445eeabd49a5fa3abea624f819e9cff70342952a7 |
| intent_router | 5FszZYxNiddFT9DP4tFWget9goRceKEB6d7iEaPaJBBuSG6o | 0x21b3ec4389374d588bfb17180138dfbf4ce58558cbecaa96d0f110dfd36250ff | 0xb8b1cec80d7a8182e875252f61cf1522499a0eb70047ccd145ff30f0c718528e | 0x90ef28d6464ac91fe26de20aa5111069dfb6a9044f8abc23f5e7d3995510e0c6 | 0x1dea126236edf8a5246fbf90a7876834f245167b2f12b024761967f2956951d2 |

## 只读能力探测

- 来源：probe-report.json
- finalized 区块：292475 / 0x11411e2eada4c129d148e190141e7bf17ce7ec9d7f14bc753dc6b4df6f986402
- Runtime：portaldot-v3 (3002)
- Metadata hash：0x9403cfae49f4b196cf35a6982c3176ba3434f48df1c7b7cc4a90238e40d2f46e

## 测试网交易

成功 finalized 交易：0/10；报告收录 finalized 记录：0

| Intent | 交易 hash | 区块 | 状态 | 事件数 |
| --- | --- | ---: | --- | ---: |
| — | — | — | 未采集 | 0 |

## 性能

| 阶段 | 样本 | 最小 ms | 平均 ms | P50 ms | P95 ms | 最大 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dry-run | 0 | — | — | — | — | — |
| 提交 | 0 | — | — | — | — | — |

### 运行环境

- 尚无运行环境记录。

## 待完成项

- 成功的测试网 finalized 交易为 0/10
- 缺少 dry-run 或提交耗时样本
- 缺少包含 runtime、区块范围和机器配置的运行记录

事件内容以十六进制保存在 JSON 报告中，可按区块和 extrinsic index 交叉核验。报告不包含签名材料或 RPC 凭据。

复现命令：`npm run p8:probe`、`npm run p8:acceptance -- --probe artifacts/p8-public-acceptance/probe-report.json`、`npm run p7:dashboard`。P2 只读部署预检：`npm run p2:deploy`。

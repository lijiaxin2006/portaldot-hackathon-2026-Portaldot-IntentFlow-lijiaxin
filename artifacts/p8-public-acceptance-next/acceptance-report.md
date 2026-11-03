# Portaldot IntentFlow 公开验收报告

- 状态：incomplete
- 网络：portaldot-testnet
- 生成时间：2026-11-02T15:55:18.108Z
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

- 未附带探测报告。

## P3 部署与初始化交易

已收录：19

| 类型 | 交易 hash | finalized 区块 hash | 合约/目标 | 方法 |
| --- | --- | --- | --- | --- |
| code_upload_token | 0x9f3c5476c44ceaaf850db7e09903d2804540481a7d8cc260c652b6083dc27e65 | 0xc582c9196b15056f01369ee8203bcbd7188e188a5e2c48b69c4efbcbd7f74127 |  |  |
| code_upload_pool | 0xeaddb777cd7cd72a36b27efa5ecf8b864783ceb8acafc10cbbf3440f625cb5ac | 0x4fcebce6fc84553b2f1436a67549feb9e3791de6fe2b7d356198deb3c35dc6db |  |  |
| code_upload_intent_router | 0x2a4135f580c38fc6b5ebdf163db9dda8179e8f1d9726987afca0e7cdb8af03a2 | 0x554718cd85c53868c70220aabe2444806335e5f31af716af2f10690d66915378 |  |  |
| deployment_token_a | 0x6add00b1cb1c46744bcea49d688d4a2708f095bebf94e1e4067b48205b6effe6 | 0x4443b8a74524086d963b4de1bdbc3ecb476d81ee8a3afb4e8334477d1484a4d0 | 5HqqyY3wh7QGVp61PwZu1SaVpP1MB43zgSkhawXxbZSqw4uV |  |
| deployment_token_b | 0x5e41242d3c2e63271da6cd2be61fa51c00a457049d13c185ad11461ffaa23bcd | 0x0678598cf74f0dc9ebdfa81da570a07517ad04cff71fc87c268543dd7aea2efe | 5CxhT4eMfjkRHpMMPJeUp6cevGocFDnzk3bHnmaTSpnsHriP |  |
| deployment_pool_a | 0x3fb6d6d3bb3a8ae3182df26467dab66801150dd907a0edfcce07132bdfaabc80 | 0x6fcabb4ff500764dc074533c741d2fae1a4fc86f0eba6bfacc6e7d9ef28ac5b8 | 5D2WV819oHM3kvEekfLis4f3deHkys2vS6AVAMTGLoi9ZPVx |  |
| deployment_pool_b | 0x91a0172d41d4706aff234c1cb79dd64203ca28ece26e91912cd4f40892dfd672 | 0x1787cbc539a40e871446514445eeabd49a5fa3abea624f819e9cff70342952a7 | 5DVRsqRZPfXe7hu4FMKAY8zDR43a6u7Y4BiwSWMFR89WbBr7 |  |
| deployment_intent_router | 0x90ef28d6464ac91fe26de20aa5111069dfb6a9044f8abc23f5e7d3995510e0c6 | 0x1dea126236edf8a5246fbf90a7876834f245167b2f12b024761967f2956951d2 | 5FszZYxNiddFT9DP4tFWget9goRceKEB6d7iEaPaJBBuSG6o |  |
| router_allow_pool_a | 0x9222bc95faf8767992b5314febdd6fe6492f3632e2ded80045ebff280e07a57a | 0x8ec520649fcb1ffb7b21a78421e798c6ddc6294b85aa9eb7abf5176a1ee3f436 | 5FszZYxNiddFT9DP4tFWget9goRceKEB6d7iEaPaJBBuSG6o | set_pool_allowed |
| router_allow_pool_b | 0xd9437fa882ce4bcc795dd621a25bbbff4f1fdc9aeb2dfa20bb12cc5d88e20b43 | 0x84b752dd68a867a5735ada2c0ce23a59ddf9663faf45d3474bc2898dc1b5c9c1 | 5FszZYxNiddFT9DP4tFWget9goRceKEB6d7iEaPaJBBuSG6o | set_pool_allowed |
| router_authorize_deployer | 0x0772f600f520d12bd28e76137ca9036b77f865c6d323536246b3b54b520e61e1 | 0x06b66da397b302fc06dfb48e66346be0b529dd5faf26bd3864cffe251b4a131a | 5FszZYxNiddFT9DP4tFWget9goRceKEB6d7iEaPaJBBuSG6o | set_solver_authorized |
| pool_a_approve_token_a | 0xb0726b648d04f90c38830f74476b41aab26613014c5b647b0ffbf3e007550cd2 | 0xbd9621101ccc3cdeefbaac1ca74e511016b7a7b965024834cf22de76040ff1f0 | 5HqqyY3wh7QGVp61PwZu1SaVpP1MB43zgSkhawXxbZSqw4uV | approve |
| pool_a_approve_token_b | 0x637e2060496e66c0e453fa894db1fafec27866d09d8f8f1ec5b576c8cbccdb14 | 0xf48af4c859eaad091ba1a374b9c86f7144e65256bf0ca735b9ec4353b04b8770 | 5CxhT4eMfjkRHpMMPJeUp6cevGocFDnzk3bHnmaTSpnsHriP | approve |
| pool_b_approve_token_a | 0x953990155fedc5823baeefd81aa8784111fb064730f6f1dba20329fff5d25104 | 0xb606a7a65e60979a7e8dfb47c9ef3bf4b637a34828e7dd340e2e000a8784bcaa | 5HqqyY3wh7QGVp61PwZu1SaVpP1MB43zgSkhawXxbZSqw4uV | approve |
| pool_b_approve_token_b | 0x4b026a0c5463c8e47be0f853831c18d780376b719cb24469620d3590d78b1851 | 0x1e09bf722f39d1742b78012a99ed68f0669432e2f72079cfdba0260a1bbf0fc2 | 5CxhT4eMfjkRHpMMPJeUp6cevGocFDnzk3bHnmaTSpnsHriP | approve |
| pool_a_add_liquidity | 0x5cd82154ded3e220e99ab37e14437c0d681f51bb17a10559949ad60386c8b808 | 0xc84bc176a66fadd8973bd4c2bcfcc3a510f57de89eed16ee8dbaba2862e0a7ab | 5D2WV819oHM3kvEekfLis4f3deHkys2vS6AVAMTGLoi9ZPVx | add_liquidity |
| pool_b_add_liquidity | 0xec7f31fe9b69e17e42764e41828a4205f89f9db3aa9d0a6eba56b83ebcbdfce6 | 0xb6668023d6b4f02b3d31e11bff3027280f0f5a69cd82d77858a0ef6b603649c7 | 5DVRsqRZPfXe7hu4FMKAY8zDR43a6u7Y4BiwSWMFR89WbBr7 | add_liquidity |
| acceptance_swap_approval | 0xb284a085b72392b3489d6b3f34eaa8d6794f73ac41161db23c01f01e84a61567 | 0x92bb037af562813d045faaf5bd1461547029bd2c54898e49d10a332fd4598cc8 | 5HqqyY3wh7QGVp61PwZu1SaVpP1MB43zgSkhawXxbZSqw4uV |  |
| acceptance_swap | 0xaab258fbadfec8aae1d4f875950a6703541f6eb8b8a50c12f4ad25bff2bdb57b | 0xd608d1d50c082a1032953154fb27fb7674721d9e979be4c73d8eec2249c3f64f |  |  |

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

- 缺少目标网络上具备完整 Contracts 能力的只读探测报告
- 成功的测试网 finalized 交易为 0/10
- 缺少 dry-run 或提交耗时样本
- 缺少包含 runtime、区块范围和机器配置的运行记录

事件内容以十六进制保存在 JSON 报告中，可按区块和 extrinsic index 交叉核验。报告不包含签名材料或 RPC 凭据。

复现命令：`npm run p8:probe`、`npm run p8:acceptance -- --probe artifacts/p8-public-acceptance/probe-report.json`、`npm run p7:dashboard`。P2 只读部署预检：`npm run p2:deploy`。

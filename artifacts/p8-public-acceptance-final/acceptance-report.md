# Portaldot IntentFlow 公开验收报告

- 状态：ready_for_review
- 网络：portaldot-testnet
- 生成时间：2026-11-03T05:08:49.155Z
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
- finalized 区块：301548 / 0xb88a0cedff58421dd791af2b7d06d5a84abf25c92b7b22bcc66501905d8985ce
- Runtime：portaldot-v3 (3002)
- Metadata hash：0x0eff5335e441b48b0dc27379292fb53584c78594f2024ecdc2ee9a245670d700

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

成功 finalized 交易：10/10；报告收录 finalized 记录：20

| Intent | 交易 hash | 区块 | 状态 | 事件数 |
| --- | --- | ---: | --- | ---: |
| 0x21833848f8d3ba222edc18875cd9bad1f79254f1af06c559a07873e1a9b29689 | 0x2b43ba0a2601888eaf5725933a3e173f56be3ebdc355c356f9ea3a4daa0c7a69 | 300882 | Rejected | 5 |
| 0x966c423a6b89ac39755106635657aa36d3d62122a4fd9adf8b19115f2fd9b4ed | 0x316e439d485e134bf8116d5c8021a0fe4342583b6e108ef7f910c5cf3982d704 | 300916 | Rejected | 5 |
| 0x81bb131f06cd99353b594d188588bc13d28babe6ac3663de2a2464470c5caf99 | 0xb0107a2e9f740f91fcd714ed4fdee465f626a2920df9da0a4f179300b450336c | 301064 | Confirmed | 23 |
| 0x569eea318857dda51a2fe69f1d70aa7e47e75d89e76560218f0aba3bfc1e1759 | 0xc1328e82128fc427dd3b3373842494bbcaebf45cf81dfda67a0dbe506848eb30 | 301068 | Rejected | 4 |
| 0x3e9907b0e44d926d4b17c85e1308433494cd3aa720e0922e781579bf1a3ab879 | 0xf72d511e72e853cb1069012772b6512aabbef96fb406fd218b0ba6fce7634e50 | 301072 | Rejected | 4 |
| 0x0edb36c04cb0598af92d7c07551924216d09b69603eec5e835c4970acac101e9 | 0xc8a4ff3c4e7a8a3caaca0051198e4f805fd262a5587caee1873723379a03197c | 301076 | Rejected | 5 |
| 0x274bba52eb02c4dbd1d82d76325f13cd31214569d563e417991ad73287b1ae50 | 0xb73af2ea0715ed3911371d099a5a873a4aa044fe43a5c0c61b9662a0d075654f | 301080 | Rejected | 5 |
| 0xc8f265bae6dd2b855088cce6e2b53516ccb4748f098d31654f64edb7599c6cf8 | 0xd619a60a150612c6414fd654a2d87563d98bc2e2db1b09fcde119c266c338361 | 301084 | Rejected | 5 |
| 0xd771a22e508463b67c8070ca9edeb0362ee4aab8252d0df8768b1cc18329dbca | 0x40de1751248efe332262b267cab17a6ec73919a2d21d03d39a8f369430c0abf2 | 301342 | Confirmed | 23 |
| 0xa2939cba28791636949623ab055f4e54e450bdaac8111619056608105a7b93f8 | 0x1a78bd0f35adec1e7e5092f37b522e8318fc0c4dbd92c76ca84370a4d0ed4857 | 301359 | Rejected | 5 |
| 0x226c6ecee47d01ce6c0cf5f403f57a12e515cdbe4e7fe65c69e5f3f92b006f4a | 0xa8672a088f77ac70c6c26ec08355e44eaa4ed00140eca68acbf3516e955e6bf5 | 301367 | Rejected | 5 |
| 0xa06e9c849bcbc87268a0ee8b296d5d8fe4c26ef07913a78dd8cac437c755e7cb | 0x1de5d0d01a2b3f4b038e9428029686ed2a96a5dde43f2456e616812273ea5bdf | 301408 | Rejected | 5 |
| 0x385dd19942c350484155d3b107b78ef73c44673f669e638081f951beaf7543ee | 0xceb22ed920ff047258dc3aae92b5a7618c8a20a3d9e561f79194ad46df9b85e2 | 301454 | Confirmed | 23 |
| 0x5c804cf36abdae72dd9643f1f8439e0cfe5d2bf82ec8250b6bd9fccb0fc7f62a | 0x7f7a755fbc3869f697905d5fa64ec8ea1779c255ee350ee231b6e1189e167353 | 301476 | Confirmed | 23 |
| 0x27c1ac9000c6e698ae79b54e7342ac813d9400e1e775cd044bcf14a60328cfee | 0x4c0bb8f3d9759d1450f43a2c74b305391074132f37a5d6bf6045971dfea77416 | 301480 | Confirmed | 23 |
| 0xf989ce358fc86cb766a35f07e288f7caab3fc0f6ebd2adcf36bb482ac49c9c54 | 0xf5f5cf7abed4cf3d1296a5602a311ca2cb0ea47cd23fafcd97b165142fd2dc85 | 301494 | Confirmed | 23 |
| 0xcf60a7e654f0febe6a8119a319bf1532f552e63063fde0343a6e04f64935f66b | 0x02303c1fd9ebca74f5223d31fadfc2ac8bec2c8ca484986faf0d4c0468fde68d | 301498 | Confirmed | 23 |
| 0xc0561e2a2215e4c08614962922d27ddef8b528ed8622d22baaae878aa84bf371 | 0xeb584a890d4017c29b26a2dacc52b845ac3ab60a446090c9d3a014c0992a3a3b | 301513 | Confirmed | 23 |
| 0x167108676ee53c03c64fdd6c5a2ae392193fcf1bae555369a5bcbfc69ad94575 | 0x3199a916803b8d21a70cc3179589650896fe7ecd22718a73b18ab48859d09a25 | 301517 | Confirmed | 23 |
| 0xe023f87fb002fa2af2ebe5186c543b9d930c97338fe44df705c7a0b56be64fd0 | 0xe196afedad33fb9fd9d5488438a24c63b207265fe9079d226389394a1871c804 | 301531 | Confirmed | 23 |

## 性能

| 阶段 | 样本 | 最小 ms | 平均 ms | P50 ms | P95 ms | 最大 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dry-run | 21 | 389 | 599 | 461 | 1055 | 1304 |
| 提交 | 20 | 16750 | 19261 | 18057 | 19785 | 39439 |

### 运行环境

- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 300873–—，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 300908–—，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301055–301084，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301168–—，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301190–—，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301332–301342，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301349–301367，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301397–301408，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301445–301454，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301467–301480，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301485–301498，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301504–301517，机器 win32/x64/node-24.19.0
- portaldot-testnet: runtime portaldot-v3/3002/tx2，区块 301522–301531，机器 win32/x64/node-24.19.0

## 待完成项

- 无

事件内容以十六进制保存在 JSON 报告中，可按区块和 extrinsic index 交叉核验。报告不包含签名材料或 RPC 凭据。

复现命令：`npm run p8:probe`、`npm run p8:acceptance -- --probe artifacts/p8-public-acceptance/probe-report.json`、`npm run p7:dashboard`。P2 只读部署预检：`npm run p2:deploy`。

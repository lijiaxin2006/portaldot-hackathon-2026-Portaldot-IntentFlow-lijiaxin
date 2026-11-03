import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('Usage: node scripts/p8-generate-acceptance.mjs [--database PATH] [--output DIR] [--deployments JSON] [--probe JSON]\n');
  process.exit(0);
}

const databasePath = resolve(root, args.database ?? process.env.INTENTFLOW_EVIDENCE_DB ?? 'data/intentflow.sqlite3');
const outputDir = resolve(root, args.output ?? 'artifacts/p8-public-acceptance');
const rows = readDatabase(databasePath);
const defaultDeploymentPath = resolve(root, 'evidence/p3/p2-live-preflight-v2.json');
const suppliedDeploymentPath = args.deployments ? resolve(root, args.deployments) : (existsSync(defaultDeploymentPath) ? defaultDeploymentPath : null);
const suppliedDeployments = suppliedDeploymentPath ? await loadDeployments(suppliedDeploymentPath) : [];
const deploymentTransactions = suppliedDeploymentPath ? await loadDeploymentTransactions(suppliedDeploymentPath) : [];
const suppliedProbe = args.probe ? await loadProbe(resolve(root, args.probe)) : null;
const records = rows.evidence.map(parseJson).filter(Boolean);
const targetNetwork = process.env.PORTALDOT_TESTNET_NETWORK ?? 'portaldot-testnet';
const deployments = uniqueBy([
  ...rows.deployments.map(parseJson).filter(Boolean).map(publicDeployment),
  ...suppliedDeployments,
], (item) => `${item.network}:${item.contractKind}:${item.address}`)
  .filter((item) => item.network === targetNetwork && item.address && item.codeHash && item.metadataHash && item.deployTxHash && item.deployBlockHash);
const transactions = records
  .filter((record) => record.execution?.network === targetNetwork && record.receipt?.tx_hash)
  .map(publicTransaction);
const successfulTransactions = transactions.filter((transaction) => transaction.success === true);
const performance = buildPerformance(records.filter((record) => record.execution?.network === targetNetwork));
const runs = rows.runs.map(parseJson).filter(Boolean).map(publicRun).filter((run) => run.network === targetNetwork);
const pools = rows.pools.map(parseJson).filter(Boolean).map(publicPool).filter((pool) => pool.network === targetNetwork);
const capabilityProbe = suppliedProbe ? publicProbe(suppliedProbe) : null;
const complete = deployments.length > 0
  && successfulTransactions.length >= 10
  && performance.ready
  && probeReady(capabilityProbe, targetNetwork)
  && runs.some((run) => run.runtimeVersion && run.machineProfile && run.blockRange?.end !== null);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  network: targetNetwork,
  explorer: 'https://node-console.portaldot.dev/',
  source: { database: 'SQLite evidence store', p3DeploymentReport: suppliedDeploymentPath ? relative(root, suppliedDeploymentPath) : null, p3DeploymentTransactions: deploymentTransactions.length, transactionRecords: transactions.length, successfulFinalizedTransactions: successfulTransactions.length },
  gitRevision: gitRevision(),
  deployments,
  deploymentTransactions,
  capabilityProbe,
  runs,
  poolSnapshots: pools,
  transactions,
  performance,
  acceptance: {
    status: complete ? 'ready_for_review' : 'incomplete',
    requirements: {
      deploymentManifest: { passed: deployments.length > 0, count: deployments.length },
      readOnlyCapabilityProbe: { passed: probeReady(capabilityProbe, targetNetwork) },
      finalizedTestnetTransactions: { passed: successfulTransactions.length >= 10, count: successfulTransactions.length, required: 10, totalFinalizedRecords: transactions.length },
      measuredPerformance: { passed: performance.ready, dryRunSamples: performance.dryRun.sampleCount, submissionSamples: performance.submission.sampleCount },
      reproducibleContext: { passed: runs.some((run) => run.runtimeVersion && run.machineProfile && run.blockRange?.end !== null) },
    },
    gaps: acceptanceGaps({ deployments, successfulTransactions, performance, runs, capabilityProbe, targetNetwork }),
  },
};

await mkdir(outputDir, { recursive: true });
const jsonPath = resolve(outputDir, 'acceptance-report.json');
const markdownPath = resolve(outputDir, 'acceptance-report.md');
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(report), 'utf8');
const files = [];
for (const name of ['acceptance-report.json', 'acceptance-report.md']) {
  const content = await readFile(resolve(outputDir, name));
  files.push({ path: name, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length });
}
await writeFile(resolve(outputDir, 'bundle-manifest.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt: report.generatedAt, files }, null, 2)}\n`, 'utf8');
process.stdout.write(`Acceptance bundle written to ${outputDir}\n`);
process.stdout.write(`Status: ${report.acceptance.status}; successful finalized testnet transactions: ${successfulTransactions.length}/10\n`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') result.help = true;
    else if (['--database', '--output', '--deployments', '--probe'].includes(value)) {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a path`);
      result[value.slice(2)] = next;
      index += 1;
    } else throw new Error(`Unknown option: ${value}`);
  }
  return result;
}

function readDatabase(path) {
  if (!existsSync(path)) return { evidence: [], runs: [], pools: [], deployments: [] };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec('PRAGMA query_only = ON');
    return {
      evidence: readColumn(database, 'portaldot_evidence', 'payload_json'),
      runs: readColumn(database, 'portaldot_runs', 'payload_json'),
      pools: readColumn(database, 'portaldot_pools', 'payload_json'),
      deployments: readColumn(database, 'portaldot_deployments', 'payload_json'),
    };
  } finally {
    database.close();
  }
}

function readColumn(database, table, column) {
  try {
    return database.prepare(`SELECT ${column} FROM ${table}`).all().map((row) => row[column]);
  } catch (error) {
    if (String(error.message).includes('no such table')) return [];
    throw error;
  }
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

async function loadDeployments(path) {
  const source = JSON.parse(await readFile(path, 'utf8'));
  const rows = Array.isArray(source) ? source : source.deployments ?? source.contracts ?? [];
  const candidates = Array.isArray(rows)
    ? rows.map((item) => ({ ...item, network: item.network ?? source.network ?? source.network_name }))
    : Object.entries(rows).map(([kind, item]) => ({
      ...item,
      network: item.network ?? source.network ?? source.network_name,
      contract_kind: item.contract_kind ?? kind,
    }));
  return candidates
    .filter((item) => item.status === undefined || item.status === 'pass')
    .map(publicDeployment)
    .filter((item) => item.address && item.codeHash && item.metadataHash && item.deployTxHash && item.deployBlockHash);
}

async function loadDeploymentTransactions(path) {
  const source = JSON.parse(await readFile(path, 'utf8'));
  const values = [
    ...Object.entries(source.code_uploads ?? {}).map(([kind, item]) => ({ kind: `code_upload_${kind}`, ...item })),
    ...Object.entries(source.deployments ?? {}).map(([kind, item]) => ({ kind: `deployment_${kind}`, ...item })),
    ...Object.entries(source.steps ?? {}).map(([kind, item]) => ({ kind, ...item })),
  ];
  return values.filter((item) => item.status === 'pass' && item.transaction_hash && item.finalized_block_hash)
    .map((item) => ({
      network: source.network ?? targetNetwork,
      kind: item.kind,
      txHash: publicBytesOrText(item.transaction_hash),
      blockHash: publicBytesOrText(item.finalized_block_hash),
      contract: publicBytesOrText(item.contract_address ?? ''),
      message: safeText(item.message ?? ''),
    }));
}

async function loadProbe(path) {
  return { ...JSON.parse(await readFile(path, 'utf8')), sourceName: path.split(/[\\/]/).at(-1) };
}

function publicProbe(source) {
  const latest = source.finalizedBlock
    ?? source.observed_finalized_block
    ?? source.latest_finalized_block
    ?? source.latestFinalizedBlock;
  let endpointHost = source.endpointHost ?? null;
  const endpoint = source.endpoint_id ?? source.endpoint;
  if (!endpointHost && endpoint) {
    try { endpointHost = new URL(endpoint).host; } catch { endpointHost = null; }
  }
  return {
    source: safeText(source.sourceName ?? 'probe report'),
    network: safeText(source.network ?? ''),
    observedAt: safeText(source.observedAt ?? source.observed_at_utc ?? ''),
    endpointHost: endpointHost ? safeText(endpointHost) : null,
    chain: safeText(source.chain ?? ''),
    genesisHash: hex(source.genesisHash ?? source.genesis_hash),
    finalizedBlock: { number: latest?.number ?? null, hash: hex(latest?.hash) },
    runtime: publicValue(source.runtime ?? {}),
    metadataHash: hex(source.metadataHash ?? source.runtime?.metadata_sha256 ?? source.runtime?.metadataHash),
    capabilities: publicValue(source.capabilities ?? {}),
  };
}

function publicDeployment(value) {
  return {
    network: safeText(value.network ?? value.network_name ?? 'portaldot-testnet'),
    contractKind: safeText(value.contract_kind ?? value.contractKind ?? value.kind ?? ''),
    address: publicBytesOrText(value.address ?? value.contract_address ?? ''),
    codeHash: publicBytesOrText(value.code_hash ?? value.codeHash ?? ''),
    metadataHash: publicBytesOrText(value.metadata_hash ?? value.metadataHash ?? ''),
    deployTxHash: publicBytesOrText(value.deploy_tx_hash ?? value.deployTxHash ?? value.transaction_hash ?? ''),
    deployBlockHash: publicBytesOrText(value.deploy_block_hash ?? value.deployBlockHash ?? value.finalized_block_hash ?? ''),
  };
}

function publicBytesOrText(value) {
  return Array.isArray(value) ? hex(value) : safeText(value ?? '');
}

function publicTransaction(record) {
  const receipt = record.receipt;
  return {
    network: record.execution.network,
    intentId: hex(record.execution.intent_id),
    routeHash: hex(record.execution.route_hash),
    commitmentHash: hex(record.execution.commitment_hash),
    status: record.execution.status,
    txHash: hex(receipt.tx_hash),
    blockNumber: receipt.block?.number ?? null,
    blockHash: hex(receipt.block?.hash),
    extrinsicIndex: receipt.extrinsic_index,
    success: receipt.success,
    eventHash: hex(record.execution.event_hash),
    events: (record.events ?? []).map((event) => ({
      pallet: safeText(event.pallet),
      event: safeText(event.event),
      blockNumber: event.block?.number ?? null,
      blockHash: hex(event.block?.hash),
      extrinsicIndex: event.extrinsic_index,
      eventIndex: event.event_index,
      contract: event.contract ? hex(event.contract.Contract ?? event.contract) : null,
      topics: (event.topics ?? []).map(hex),
      dataHex: bytesHex(event.data),
    })),
    failureReason: redact(record.simulation?.failure_reason ?? record.failure_reason ?? receipt.failure_reason),
    amountIn: record.intent?.amount_in ?? null,
    minAmountOut: record.intent?.amount_out_min ?? null,
    quotedAmountOut: record.quote?.amount_out ?? null,
    fee: record.quote?.fee ?? null,
    score: record.quote?.score ?? null,
    risk: publicValue(record.quote?.risk_fields ?? null),
    route: record.route ? {
      startBlock: record.route.start_block?.number ?? null,
      startBlockHash: hex(record.route.start_block?.hash),
      steps: (record.route.steps ?? []).map((step) => ({
        pool: hex(step.pool_id),
        assetIn: publicAsset(step.asset_in),
        assetOut: publicAsset(step.asset_out),
      })),
    } : null,
    inputHash: hex(record.input_hash),
    simulationHash: hex(record.simulation_hash),
    receiptHash: hex(record.receipt_hash),
    simulationDurationMs: record.simulation_duration_ms ?? null,
    submissionDurationMs: record.submission_duration_ms ?? null,
  };
}

function publicRun(run) {
  return {
    runId: safeText(run.run_id ?? ''),
    network: safeText(run.network ?? ''),
    runtimeVersion: safeText(run.runtime_version ?? ''),
    blockRange: { start: run.start_block ?? null, end: run.end_block ?? null },
    startBlockHash: hex(run.start_block_hash),
    endBlockHash: hex(run.end_block_hash),
    codeRevision: safeText(run.code_revision ?? ''),
    machineProfile: safeText(run.machine_profile ?? ''),
    createdAtMs: run.created_at_ms ?? null,
  };
}

function publicPool(value) {
  const snapshot = value.snapshot ?? value;
  return {
    network: safeText(value.network ?? ''),
    poolAddress: hex(snapshot.pool_id?.Contract ?? snapshot.pool_id),
    asset0: publicAsset(snapshot.asset_0),
    asset1: publicAsset(snapshot.asset_1),
    reserve0: snapshot.reserve_0 ?? null,
    reserve1: snapshot.reserve_1 ?? null,
    feeBps: snapshot.fee_bps ?? null,
    observedBlock: snapshot.observed_at?.number ?? null,
    observedBlockHash: hex(snapshot.observed_at?.hash),
    codeHash: hex(snapshot.code_hash),
  };
}

function publicAsset(asset) {
  if (!asset) return null;
  return asset.Contract ? hex(asset.Contract) : Object.hasOwn(asset, 'Native') ? 'Native' : safeText(asset);
}

function buildPerformance(records) {
  const dryRun = summarize(records.map((record) => record.simulation_duration_ms));
  const submission = summarize(records.map((record) => record.submission_duration_ms));
  return { dryRun, submission, ready: dryRun.sampleCount > 0 && submission.sampleCount > 0 };
}

function summarize(values) {
  const samples = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!samples.length) return { sampleCount: 0, minMs: null, averageMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  const percentile = (fraction) => samples[Math.max(0, Math.ceil(samples.length * fraction) - 1)];
  return {
    sampleCount: samples.length,
    minMs: samples[0],
    averageMs: Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: samples.at(-1),
  };
}

function probeReady(probe, targetNetwork) {
  const requiredCapabilities = ['contractsModule', 'dryRunApi', 'uploadCall', 'instantiateCall', 'eventQueries'];
  return Boolean(probe?.network === targetNetwork
    && probe.finalizedBlock?.hash
    && probe.metadataHash
    && requiredCapabilities.every((capability) => probe.capabilities?.[capability] === true));
}

function acceptanceGaps({ deployments, successfulTransactions, performance, runs, capabilityProbe, targetNetwork }) {
  const gaps = [];
  if (!deployments.length) gaps.push('缺少已核验的部署清单');
  if (!probeReady(capabilityProbe, targetNetwork)) gaps.push('缺少目标网络上具备完整 Contracts 能力的只读探测报告');
  if (successfulTransactions.length < 10) gaps.push(`成功的测试网 finalized 交易为 ${successfulTransactions.length}/10`);
  if (!performance.ready) gaps.push('缺少 dry-run 或提交耗时样本');
  if (!runs.some((run) => run.runtimeVersion && run.machineProfile && run.blockRange?.end !== null)) {
    gaps.push('缺少包含 runtime、区块范围和机器配置的运行记录');
  }
  return gaps;
}

function renderMarkdown(report) {
  const lines = [
    '# Portaldot IntentFlow 公开验收报告',
    '',
    `- 状态：${report.acceptance.status}`,
    `- 网络：${report.network}`,
    `- 生成时间：${report.generatedAt}`,
    `- Git revision：${report.gitRevision ?? '不可用'}`,
    `- 节点浏览器：${report.explorer}`,
    '',
    '## 部署',
    '',
    '| 合约 | 地址 | 代码 hash | Metadata hash | 部署交易 | 区块 hash |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const item of report.deployments) lines.push(`| ${cell(item.contractKind)} | ${cell(item.address)} | ${cell(item.codeHash)} | ${cell(item.metadataHash)} | ${cell(item.deployTxHash)} | ${cell(item.deployBlockHash)} |`);
  if (!report.deployments.length) lines.push('| 未记录 | — | — | — | — | — |');
  const probe = report.capabilityProbe;
  lines.push('', '## 只读能力探测', '');
  if (probe) {
    lines.push(`- 来源：${cell(probe.source)}`, `- finalized 区块：${probe.finalizedBlock.number ?? '—'} / ${cell(probe.finalizedBlock.hash ?? '—')}`, `- Runtime：${cell(probe.runtime.spec_name ?? probe.runtime.specName ?? '—')} (${probe.runtime.spec_version ?? probe.runtime.specVersion ?? '—'})`, `- Metadata hash：${cell(probe.metadataHash ?? '—')}`);
  } else lines.push('- 未附带探测报告。');
  lines.push('', '## P3 部署与初始化交易', '', `已收录：${report.deploymentTransactions.length}`, '', '| 类型 | 交易 hash | finalized 区块 hash | 合约/目标 | 方法 |', '| --- | --- | --- | --- | --- |');
  for (const item of report.deploymentTransactions) lines.push(`| ${cell(item.kind)} | ${cell(item.txHash)} | ${cell(item.blockHash)} | ${cell(item.contract)} | ${cell(item.message)} |`);
  if (!report.deploymentTransactions.length) lines.push('| — | — | — | — | — |');
  lines.push('', '## 测试网交易', '', `成功 finalized 交易：${report.acceptance.requirements.finalizedTestnetTransactions.count}/10；报告收录 finalized 记录：${report.transactions.length}`, '', '| Intent | 交易 hash | 区块 | 状态 | 事件数 |', '| --- | --- | ---: | --- | ---: |');
  for (const item of report.transactions) lines.push(`| ${cell(item.intentId)} | ${cell(item.txHash)} | ${item.blockNumber ?? '—'} | ${cell(item.status)} | ${item.events.length} |`);
  if (!report.transactions.length) lines.push('| — | — | — | 未采集 | 0 |');
  lines.push('', '## 性能', '', '| 阶段 | 样本 | 最小 ms | 平均 ms | P50 ms | P95 ms | 最大 ms |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, metric] of [['Dry-run', report.performance.dryRun], ['提交', report.performance.submission]]) {
    lines.push(`| ${name} | ${metric.sampleCount} | ${metric.minMs ?? '—'} | ${metric.averageMs ?? '—'} | ${metric.p50Ms ?? '—'} | ${metric.p95Ms ?? '—'} | ${metric.maxMs ?? '—'} |`);
  }
  lines.push('', '### 运行环境', '');
  for (const run of report.runs) lines.push(`- ${run.network}: runtime ${run.runtimeVersion || '未记录'}，区块 ${run.blockRange.start ?? '—'}–${run.blockRange.end ?? '—'}，机器 ${run.machineProfile || '未记录'}`);
  if (!report.runs.length) lines.push('- 尚无运行环境记录。');
  lines.push('', '## 待完成项', '');
  if (!report.acceptance.gaps.length) lines.push('- 无');
  else for (const gap of report.acceptance.gaps) lines.push(`- ${gap}`);
  lines.push('', '事件内容以十六进制保存在 JSON 报告中，可按区块和 extrinsic index 交叉核验。报告不包含签名材料或 RPC 凭据。', '', '复现命令：`npm run p8:probe`、`npm run p8:acceptance -- --probe artifacts/p8-public-acceptance/probe-report.json`、`npm run p7:dashboard`。P2 只读部署预检：`npm run p2:deploy`。', '');
  return lines.join('\n');
}

function gitRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function uniqueBy(values, key) {
  const map = new Map();
  for (const value of values) map.set(key(value), value);
  return [...map.values()];
}

function hex(value) {
  if (typeof value === 'string') return value.startsWith('0x') ? value : `0x${value}`;
  if (Array.isArray(value)) return `0x${bytesHex(value)}`;
  if (value && typeof value === 'object' && Object.hasOwn(value, '0')) return hex(value[0]);
  return null;
}

function bytesHex(value) {
  if (!Array.isArray(value)) return '';
  return value.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('');
}

function safeText(value) {
  return redact(String(value ?? ''));
}

function publicValue(value) {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(private|mnemonic|secret|seed|password|token|credential|signed[_-]?payload|rpc[_-]?url)/i.test(key))
      .map(([key, nested]) => [key, publicValue(nested)]));
  }
  return typeof value === 'string' ? redact(value) : value;
}

function redact(value) {
  return String(value ?? '')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/(mnemonic|seed|secret|password|token|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]');
}

function cell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

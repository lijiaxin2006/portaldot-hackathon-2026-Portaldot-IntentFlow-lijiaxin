import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Abi } from '@polkadot/api-contract';
import { Keyring } from '@polkadot/keyring';
import { blake2AsU8a, cryptoWaitReady, decodeAddress } from '@polkadot/util-crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const has = (name) => process.argv.includes(name);
const endpoint = process.env.PORTALDOT_TESTNET_WS_URL ?? 'wss://test-node-v3.portaldot.dev';
const network = process.env.PORTALDOT_TESTNET_NETWORK ?? 'portaldot-testnet';
const deploymentPath = path.resolve(root, arg('--deployments', 'evidence/p3/p2-live-preflight-v2.json'));
const databasePath = path.resolve(root, arg('--database', process.env.INTENTFLOW_EVIDENCE_DB ?? 'data/intentflow.sqlite3'));
const outputPath = path.resolve(root, arg('--output', 'artifacts/p4-p8-acceptance'));
const broadcast = has('--broadcast');
const dryRunOnly = has('--dry-run-only') || !broadcast;
const singleHopOnly = has('--single-hop-only');
const successOnly = has('--success-only');
const successCount = Number(arg('--success-count', '10'));
if (!Number.isInteger(successCount) || successCount < 1 || successCount > 50) throw new Error('--success-count must be an integer from 1 to 50.');
if (broadcast && (!process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC || !process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS)) {
  throw new Error('Broadcast requires PORTALDOT_TEST_ACCOUNT_ADDRESS and PORTALDOT_TEST_ACCOUNT_MNEMONIC.');
}

const hex = (value) => `0x${Buffer.from(value).toString('hex')}`;
const bytes = (value) => Buffer.from(String(value).replace(/^0x/, ''), 'hex');
const sha256 = (value) => createHash('sha256').update(value).digest();
const accountBytes = (value) => Buffer.from(decodeAddress(value));
const le = (value, width) => {
  let remaining = BigInt(value);
  const output = Buffer.alloc(width);
  for (let i = 0; i < width; i += 1) {
    output[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error(`value does not fit in ${width} bytes`);
  return output;
};
const putAsset = (value) => Buffer.concat([Buffer.from([1]), accountBytes(value)]);
const routeHashFor = (blockNumber, blockHash, steps) => sha256(Buffer.concat([
  Buffer.from('intentflow-route-v1\0'), le(Buffer.byteLength(network), 4), Buffer.from(network),
  le(blockNumber, 8), bytes(blockHash), le(steps.length, 4),
  ...steps.flatMap((step) => [accountBytes(step.pool_id), putAsset(step.asset_in), putAsset(step.asset_out)]),
]));
const intentHashFor = (intent) => sha256(Buffer.concat([
  Buffer.from('intentflow-intent-v1\0'), bytes(intent.intent_id), accountBytes(intent.owner),
  putAsset(intent.asset_in), putAsset(intent.asset_out), le(intent.amount_in, 16),
  le(intent.amount_out_min, 16), le(intent.max_fee, 16), le(intent.deadline, 8),
]));
const commitmentFor = (intent, routeHash) => sha256(Buffer.concat([
  Buffer.from('intentflow-execution-commitment-v1\0'), intentHashFor(intent), routeHash,
]));
const callHashFor = (input, blockHash) => sha256(Buffer.concat([Buffer.from('intentflow-router-call-v1\0'), input, bytes(blockHash)]));

const deploymentSource = JSON.parse(await readFile(deploymentPath, 'utf8'));
const deploymentRows = Object.entries(deploymentSource.deployments ?? {}).map(([kind, value]) => ({
  kind,
  address: value.contract_address ?? value.address,
  codeHash: value.code_hash ?? value.codeHash,
  metadataHash: value.metadata_hash ?? value.metadataHash,
  deployTxHash: value.transaction_hash ?? value.deploy_tx_hash,
  deployBlockHash: value.finalized_block_hash ?? value.deploy_block_hash,
})).filter((value) => value.address && value.codeHash);
if (deploymentRows.length < 5) throw new Error(`Deployment report ${deploymentPath} does not contain five finalized contracts.`);

const artifact = async (name, api) => {
  const bundleBytes = await readFile(path.resolve(root, 'target/p2-contracts', `${name}.contract`));
  const wasm = await readFile(path.resolve(root, 'target/p2-contracts', `${name}.deployable.wasm`));
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  const abi = new Abi(bundle, api.registry.getChainProperties());
  return {
    name,
    abi,
    wasm,
    codeHash: hex(blake2AsU8a(wasm, 256)),
    metadataHash: hex(sha256(Buffer.from(JSON.stringify(abi.metadata)))),
  };
};

function message(abi, name) {
  const found = abi.messages.filter((item) => item.identifier.toString() === name || item.identifier.toString().endsWith(`::${name}`));
  if (found.length !== 1) throw new Error(`${name} resolved to ${found.length} messages.`);
  return found[0];
}

function chargedDeposit(value) {
  if (value?.isCharge) return BigInt(value.asCharge.toString());
  if (value?.Charge !== undefined) return BigInt(value.Charge.toString());
  return 0n;
}

function extractDispatchError(error, api) {
  if (!error) return null;
  if (error.isModule) {
    const decoded = api.registry.findMetaError(error.asModule);
    return `${decoded.section}.${decoded.name}`;
  }
  return error.toString();
}

async function resolveReportSigner(api, source) {
  const candidates = [
    source.steps?.acceptance_swap,
    ...Object.values(source.steps ?? {}),
    ...Object.values(source.deployments ?? {}),
  ].filter((item) => item?.transaction_hash && item?.finalized_block_hash);
  for (const item of candidates) {
    try {
      const block = await api.rpc.chain.getBlock(item.finalized_block_hash);
      const match = block.block.extrinsics.find((extrinsic) => extrinsic.hash.toHex().toLowerCase() === item.transaction_hash.toLowerCase());
      if (match?.isSigned) return match.signer.toString();
    } catch {
      // A single pruned historical block must not prevent trying the next P3 receipt.
    }
  }
  return null;
}

function jsonValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return hex(value);
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object') {
    if (typeof value.toJSON === 'function') return jsonValue(value.toJSON());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  }
  return value;
}

function unwrap(value) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, 'Ok')) return unwrap(value.Ok);
    if (Object.hasOwn(value, 'ok')) return unwrap(value.ok);
    if (Object.hasOwn(value, 'Some')) return unwrap(value.Some);
  }
  return value;
}

function decodeContractCallOutput(abi, item, raw) {
  try {
    const decoded = abi.registry.createTypeUnsafe(item.returnType.lookupName || item.returnType.type, [raw]);
    return { output: jsonValue(decoded), decodeFailure: null };
  } catch (error) {
    // Some ink! bundles expose the nested result types by lookup name while
    // the complete return type fails to construct on older registry versions.
    // Decode the discriminants explicitly and use the bundle's nested names.
    if (raw[0] === 0 && raw[1] === 0 && item.returnType?.sub?.[0]?.sub?.[0]?.lookupName) {
      try {
        const execution = abi.registry.createTypeUnsafe(item.returnType.sub[0].sub[0].lookupName, [raw.subarray(2)]);
        return { output: { ok: { ok: jsonValue(execution) } }, decodeFailure: null };
      } catch (nestedError) {
        return { output: null, decodeFailure: nestedError instanceof Error ? nestedError.message : String(nestedError) };
      }
    }
    if (raw[0] === 1 && item.returnType?.sub?.[0]?.sub?.[1]?.lookupName) {
      try {
        // A reverted ink! call prefixes the encoded contract error with the
        // revert flag byte. It is not the outer LangError variant.
        const contractError = abi.registry.createTypeUnsafe(item.returnType.sub[0].sub[1].lookupName, [raw.subarray(1)]);
        return { output: { err: jsonValue(contractError) }, decodeFailure: null };
      } catch (nestedError) {
        return { output: null, decodeFailure: nestedError instanceof Error ? nestedError.message : String(nestedError) };
      }
    }
    return { output: null, decodeFailure: error instanceof Error ? error.message : String(error) };
  }
}

async function callAt(apiAt, origin, destination, abi, name, params, decodeOutput = true) {
  const item = message(abi, name);
  const input = item.toU8a(params);
  const result = await apiAt.call.contractsApi.call(origin, destination, 0, null, null, input);
  if (result.result.isErr) return { success: false, input, gasRequired: result.gasRequired, output: null, failureReason: extractDispatchError(result.result.asErr, apiAt.registry) };
  let output = null;
  let decodeFailure = null;
  if (decodeOutput && item.returnType) {
    const decoded = decodeContractCallOutput(abi, item, result.result.asOk.data.toU8a(true));
    output = decoded.output;
    decodeFailure = decoded.decodeFailure;
  }
  const contractError = contractResultError(output);
  return { success: !contractError && !decodeFailure, input, gasRequired: result.gasRequired, output, rawOutput: result.result.asOk.data.toU8a(true), failureReason: contractError ?? decodeFailure, storageDeposit: chargedDeposit(result.storageDeposit) };
}

function contractResultError(output) {
  if (!output || typeof output !== 'object') return null;
  const outer = output.Ok ?? output.ok;
  if (output.Err ?? output.err) return String(output.Err ?? output.err);
  if (outer && typeof outer === 'object' && (outer.Err ?? outer.err)) return String(outer.Err ?? outer.err);
  return null;
}

async function submitAndFinalize(api, tx, pair) {
  const nonce = await api.rpc.system.accountNextIndex(pair.address);
  return new Promise((resolve, reject) => {
    let stop;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('timed out waiting for finalized transaction')), 180000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop?.();
      if (error) reject(error); else resolve(value);
    };
    tx.signAndSend(pair, { nonce, tip: 10_000_000_000_000n }, async (result) => {
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped || result.status.isFinalityTimeout) {
        finish(new Error(`transaction did not finalize: ${result.status.type}`));
        return;
      }
      if (!result.status.isFinalized) return;
      try {
        const events = result.events.map(({ event, phase }, eventIndex) => ({
          pallet: event.section,
          event: event.method,
          eventIndex,
          phase: phase.toString(),
          data: jsonValue(event.data),
          dataHex: event.data.toHex?.() ?? null,
          contract: event.section === 'contracts' && event.method === 'ContractEmitted' ? event.data[0].toString() : null,
        }));
        const failed = result.events.find(({ event }) => event.section === 'system' && event.method === 'ExtrinsicFailed');
        const success = result.events.some(({ event }) => event.section === 'system' && event.method === 'ExtrinsicSuccess');
        const blockHash = result.status.asFinalized.toHex();
        const header = await api.rpc.chain.getHeader(blockHash);
        const blockEvents = await api.at(blockHash);
        const extrinsicIndex = result.events[0]?.phase?.isApplyExtrinsic ? result.events[0].phase.asApplyExtrinsic.toNumber() : 0;
        finish(null, {
          txHash: result.txHash.toHex(), blockHash, blockNumber: header.number.toNumber(), extrinsicIndex,
          success, failureReason: failed ? extractDispatchError(failed.event.data[0], api) : null,
          events, gasUsed: { ref_time: '0', proof_size: '0' },
          _at: blockEvents,
        });
      } catch (error) { finish(error); }
    }).then((unsubscribe) => { stop = unsubscribe; if (settled) stop(); }).catch((error) => finish(error));
  });
}

function blockRef(number, hash) { return { number, hash }; }
function blockHashText(hash) { return hash.startsWith('0x') ? hash : `0x${hash}`; }
function amount(value) { return BigInt(String(value)); }
function quote(snapshot, assetIn, input) {
  if (input === 0n) return { output: 0n, fee: 0n };
  const inputIs0 = snapshot.asset0 === assetIn;
  const reserveIn = inputIs0 ? amount(snapshot.reserve0) : amount(snapshot.reserve1);
  const reserveOut = inputIs0 ? amount(snapshot.reserve1) : amount(snapshot.reserve0);
  const fee = input * BigInt(snapshot.feeBps);
  const afterFee = input * 10000n - fee;
  const output = (afterFee * reserveOut) / (reserveIn * 10000n + afterFee);
  const noFee = (input * reserveOut) / (reserveIn + input);
  return { output, fee: noFee > output ? noFee - output : 0n };
}

function quoteRoute(snapshots, steps, input) {
  let current = input;
  let fee = 0n;
  for (const step of steps) {
    const pool = snapshots.find((item) => item.poolId === step.pool_id);
    if (!pool) throw new Error(`missing pool ${step.pool_id}`);
    const hop = quote(pool, step.asset_in, current);
    fee += hop.fee;
    current = hop.output;
  }
  return { output: current, fee };
}

function makeIntent(owner, assetIn, assetOut, amountIn, minOut, maxFee, deadline, index, label) {
  const intentId = hex(sha256(Buffer.from(`intentflow-p4-p8-${label}-${index}-${Date.now()}-${Math.random()}`)));
  return { intent_id: intentId, owner, asset_in: assetIn, asset_out: assetOut, amount_in: amountIn, amount_out_min: minOut, max_fee: maxFee, deadline };
}

function sqlDatabase(pathname) {
  const database = new DatabaseSync(pathname);
  database.exec(`
    CREATE TABLE IF NOT EXISTS portaldot_runs (run_id TEXT PRIMARY KEY, network TEXT NOT NULL, runtime_version TEXT, start_block INTEGER, end_block INTEGER, code_revision TEXT, machine_profile TEXT, payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portaldot_deployments (network TEXT NOT NULL, contract_kind TEXT NOT NULL, address TEXT NOT NULL, code_hash TEXT NOT NULL, metadata_hash TEXT NOT NULL, deploy_tx_hash TEXT NOT NULL, deploy_block_hash TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (network, contract_kind));
    CREATE TABLE IF NOT EXISTS portaldot_pools (network TEXT NOT NULL, pool_address TEXT NOT NULL, token0 TEXT NOT NULL, token1 TEXT NOT NULL, fee_bps INTEGER NOT NULL, code_hash TEXT, observed_block INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (network, pool_address));
    CREATE TABLE IF NOT EXISTS portaldot_intents (intent_id TEXT PRIMARY KEY, owner TEXT NOT NULL, route_hash TEXT NOT NULL, amount_in TEXT NOT NULL, amount_out_min TEXT NOT NULL, deadline INTEGER NOT NULL, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portaldot_quotes (intent_id TEXT PRIMARY KEY, amount_out TEXT NOT NULL, fee TEXT NOT NULL, gas TEXT NOT NULL, score TEXT NOT NULL, risk_fields_json TEXT NOT NULL, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portaldot_executions (intent_id TEXT PRIMARY KEY, tx_hash TEXT, block_hash TEXT, status TEXT NOT NULL, amount_out TEXT, fee TEXT, event_hash TEXT, payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portaldot_evidence (intent_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, route_hash TEXT NOT NULL, simulation_hash TEXT, receipt_hash TEXT, payload_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS portaldot_executions_status_idx ON portaldot_executions(status);
  `);
  return database;
}

function insertEvidence(database, record) {
  const intentId = record.execution.intent_id;
  const payload = jsonStringify(record);
  const now = Date.now();
  const execution = record.execution;
  const receiptBlockHash = record.receipt?.block?.hash;
  const receiptBlockHashText = typeof receiptBlockHash === 'string'
    ? receiptBlockHash
    : receiptBlockHash?.[0] ?? null;
  database.prepare('INSERT OR REPLACE INTO portaldot_evidence (intent_id,input_hash,route_hash,simulation_hash,receipt_hash,payload_json,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)').run(intentId, record.input_hash, record.route_hash, record.simulation_hash, record.receipt_hash, payload, now, now);
  database.prepare('INSERT OR REPLACE INTO portaldot_intents (intent_id,owner,route_hash,amount_in,amount_out_min,deadline,payload_json) VALUES (?,?,?,?,?,?,?)').run(intentId, record.intent.owner, record.route_hash, String(record.intent.amount_in), String(record.intent.amount_out_min), record.intent.deadline.toString(), jsonStringify(record.intent));
  const quoteData = record.quote ?? { amount_out: '0', fee: '0', gas: '0', score: '0', risk_fields: {} };
  database.prepare('INSERT OR REPLACE INTO portaldot_quotes (intent_id,amount_out,fee,gas,score,risk_fields_json,payload_json) VALUES (?,?,?,?,?,?,?)').run(intentId, String(quoteData.amount_out), String(quoteData.fee), String(quoteData.gas), String(quoteData.score), jsonStringify(quoteData.risk_fields ?? {}), jsonStringify(quoteData));
  database.prepare('INSERT OR REPLACE INTO portaldot_executions (intent_id,tx_hash,block_hash,status,amount_out,fee,event_hash,payload_json) VALUES (?,?,?,?,?,?,?,?)').run(intentId, record.receipt?.tx_hash ?? null, receiptBlockHashText, execution.status, String(quoteData.amount_out), String(quoteData.fee), execution.event_hash, jsonStringify(execution));
}

function deploymentEvidence(database, rows) {
  const statement = database.prepare('INSERT OR REPLACE INTO portaldot_deployments (network,contract_kind,address,code_hash,metadata_hash,deploy_tx_hash,deploy_block_hash,payload_json) VALUES (?,?,?,?,?,?,?,?)');
  for (const row of rows) statement.run(network, row.kind, row.address, row.codeHash, row.metadataHash ?? '', row.deployTxHash ?? '', row.deployBlockHash ?? '', JSON.stringify({ network, contract_kind: row.kind, address: row.address, code_hash: row.codeHash, metadata_hash: row.metadataHash, deploy_tx_hash: row.deployTxHash, deploy_block_hash: row.deployBlockHash }));
}

function eventEvidence(receipt, block) {
  return (receipt?.events ?? []).map((event, index) => ({
    pallet: event.pallet,
    event: event.event,
    block,
    extrinsic_index: receipt.extrinsicIndex,
    event_index: index,
    contract: event.contract,
    topics: [],
    data: event.dataHex ? Array.from(bytes(event.dataHex)) : [],
  }));
}

function hashJson(value) {
  return hex(sha256(Buffer.from(jsonStringify(value))));
}

function jsonStringify(value, spacing) {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), spacing);
}

await cryptoWaitReady();
await mkdir(path.dirname(databasePath), { recursive: true });
await mkdir(outputPath, { recursive: true });
const database = sqlDatabase(databasePath);
const api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
await api.isReady;
const providedSignerAddress = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const keyring = broadcast ? new Keyring({ type: 'sr25519', ss58Format: 42 }) : null;
const pair = broadcast ? keyring.addFromUri(process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC) : null;
const signerAddress = providedSignerAddress ?? await resolveReportSigner(api, deploymentSource);
if (!signerAddress) throw new Error('Could not resolve the P3 signer address; set PORTALDOT_TEST_ACCOUNT_ADDRESS.');
if (broadcast && pair.address !== signerAddress) throw new Error('Injected signer does not derive PORTALDOT_TEST_ACCOUNT_ADDRESS.');
const origin = signerAddress;
const tokenA = deploymentRows.find((row) => row.kind === 'token_a')?.address;
const tokenB = deploymentRows.find((row) => row.kind === 'token_b')?.address;
const poolA = deploymentRows.find((row) => row.kind === 'pool_a')?.address;
const poolB = deploymentRows.find((row) => row.kind === 'pool_b')?.address;
const router = deploymentRows.find((row) => row.kind === 'intent_router')?.address;
if (!tokenA || !tokenB || !poolA || !poolB || !router) throw new Error('Deployment report is missing token, pool, or router address.');
const [tokenArtifact, poolArtifact, routerArtifact] = await Promise.all([
  artifact('intentflow_psp22_test_token', api), artifact('intentflow_amm_pool', api), artifact('intentflow_intent_router', api),
]);
const finalizedHash = await api.rpc.chain.getFinalizedHead();
const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
const runtime = { spec_name: api.runtimeVersion.specName.toString(), spec_version: api.runtimeVersion.specVersion.toNumber(), transaction_version: api.runtimeVersion.transactionVersion.toNumber() };
const metadata = await api.rpc.state.getMetadata(finalizedHash);
const runtimeMetadataHash = hex(sha256(bytes(metadata.toHex())));
const contractAddresses = { token_a: tokenA, token_b: tokenB, pool_a: poolA, pool_b: poolB, intent_router: router };
for (const row of deploymentRows) {
  const info = await api.query.contracts.contractInfoOf(row.address);
  if (info.isNone) throw new Error(`${row.kind} is absent from chain.`);
  if (info.unwrap().codeHash.toHex().toLowerCase() !== row.codeHash.toLowerCase()) throw new Error(`${row.kind} code hash differs from P3 evidence.`);
}
if (tokenArtifact.codeHash.toLowerCase() !== deploymentRows.find((row) => row.kind === 'token_a').codeHash.toLowerCase()) throw new Error('Token Wasm code hash does not match P3 evidence.');
if (poolArtifact.codeHash.toLowerCase() !== deploymentRows.find((row) => row.kind === 'pool_a').codeHash.toLowerCase()) throw new Error('Pool Wasm code hash does not match P3 evidence.');
if (routerArtifact.codeHash.toLowerCase() !== deploymentRows.find((row) => row.kind === 'intent_router').codeHash.toLowerCase()) throw new Error('Router Wasm code hash does not match P3 evidence.');

const startBlock = finalizedHeader.number.toNumber();
const startBlockHash = finalizedHash.toHex();
const runId = `p4-p8-${Date.now()}`;
const run = { run_id: runId, network, runtime_version: `${runtime.spec_name}/${runtime.spec_version}/tx${runtime.transaction_version}`, start_block: startBlock, end_block: null, start_block_hash: startBlockHash, end_block_hash: null, code_revision: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } })(), machine_profile: `${process.platform}/${process.arch}/node-${process.versions.node}`, created_at_ms: Date.now() };
database.prepare('INSERT OR REPLACE INTO portaldot_runs (run_id,network,runtime_version,start_block,end_block,code_revision,machine_profile,payload_json,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(runId, network, run.runtime_version, startBlock, null, run.code_revision, run.machine_profile, JSON.stringify(run), run.created_at_ms);
deploymentEvidence(database, deploymentRows);

const snapshots = [];
async function snapshotAt(blockHash, blockNumber) {
  const at = await api.at(blockHash);
  const read = async (poolAddress, name) => unwrap((await callAt(at, origin, poolAddress, poolArtifact.abi, name, [])).output);
  const rows = [];
  for (const [poolId, kind] of [[poolA, 'pool_a'], [poolB, 'pool_b']]) {
    const asset0 = (await read(poolId, 'token_0')).toString();
    const asset1 = (await read(poolId, 'token_1')).toString();
    const reserves = await read(poolId, 'reserves');
    const reserve0 = String(Array.isArray(reserves) ? reserves[0] : reserves?.[0] ?? reserves?.reserve_0);
    const reserve1 = String(Array.isArray(reserves) ? reserves[1] : reserves?.[1] ?? reserves?.reserve_1);
    const feeBps = Number(await read(poolId, 'fee_bps'));
    const row = { network, pool_id: { Contract: poolId }, poolId, kind, asset0, asset1, reserve0, reserve1, feeBps, observed_at: blockRef(blockNumber, blockHash.toHex()) };
    rows.push(row);
    database.prepare('INSERT OR REPLACE INTO portaldot_pools (network,pool_address,token0,token1,fee_bps,code_hash,observed_block,payload_json) VALUES (?,?,?,?,?,?,?,?)').run(network, poolId, JSON.stringify({ Contract: asset0 }), JSON.stringify({ Contract: asset1 }), feeBps, deploymentRows.find((item) => item.kind === kind)?.codeHash ?? null, blockNumber, JSON.stringify({ network, snapshot: { pool_id: { Contract: poolId }, kind: 'ConstantProduct', asset_0: { Contract: asset0 }, asset_1: { Contract: asset1 }, reserve_0: reserve0, reserve_1: reserve1, fee_bps: feeBps, observed_at: { number: blockNumber, hash: blockHash.toHex() }, code_hash: deploymentRows.find((item) => item.kind === kind)?.codeHash ?? null } }));
  }
  snapshots.push(...rows);
  return rows;
}

function makeRoute(blockNumber, blockHash, steps) { return { network, start_block: blockRef(blockNumber, blockHash), steps, route_hash: hex(routeHashFor(blockNumber, blockHash, steps)) }; }
function makeRecord({ intent, route, commitmentHash, quoteData, simulation, receipt, status, failureReason, deploymentKind = 'intent_router' }) {
  const events = eventEvidence(receipt, receipt ? blockRef(receipt.blockNumber, receipt.blockHash) : simulation.block);
  const record = {
    execution: { network, intent_id: intent.intent_id, route_hash: route.route_hash, commitment_hash: commitmentHash, simulation_hash: simulation ? simulation.hash : null, tx_hash: receipt?.txHash ?? null, block_hash: receipt?.blockHash ?? null, event_hash: events.length ? hashJson(events) : null, metadata_hash: runtimeMetadataHash, code_hash: deploymentRows.find((row) => row.kind === deploymentKind)?.codeHash ?? null, status },
    intent: { ...intent },
    route: { ...route, network, start_block: { number: route.start_block.number, hash: route.start_block.hash }, steps: route.steps.map((step) => ({ pool_id: step.pool_id, asset_in: step.asset_in, asset_out: step.asset_out })) },
    deployment: { network, contract_kind: deploymentKind, address: router, code_hash: deploymentRows.find((row) => row.kind === deploymentKind)?.codeHash, metadata_hash: deploymentRows.find((row) => row.kind === deploymentKind)?.metadataHash, deploy_tx_hash: deploymentRows.find((row) => row.kind === deploymentKind)?.deployTxHash, deploy_block_hash: deploymentRows.find((row) => row.kind === deploymentKind)?.deployBlockHash },
    quote: quoteData,
    input_hash: hashJson(intent), route_hash: route.route_hash, simulation_hash: simulation?.hash ?? null, receipt_hash: receipt ? hashJson(receipt) : null,
    simulation: simulation ? { call_hash: simulation.callHash, block: { number: simulation.block.number, hash: simulation.block.hash }, success: simulation.success, gas_required: simulation.gasRequired, output: simulation.output ?? [], events: [], failure_reason: simulation.failureReason } : null,
    receipt: receipt ? { tx_hash: receipt.txHash, block: { number: receipt.blockNumber, hash: receipt.blockHash }, extrinsic_index: receipt.extrinsicIndex, success: receipt.success, gas_used: receipt.gasUsed, failure_reason: receipt.failureReason } : null,
    events, failure_reason: failureReason ?? receipt?.failureReason ?? simulation?.failureReason ?? null, created_at_ms: Date.now(), simulation_duration_ms: simulation?.durationMs ?? null, submission_duration_ms: receipt?.durationMs ?? null,
  };
  insertEvidence(database, record);
  return record;
}

async function performCase(index, label, steps, kind, overrides = {}) {
  // The deployed Router accepts snapshots only two blocks old. A broadcast
  // can wait several finalized blocks, so use the current best block for the
  // execution commitment while keeping dry-run-only evidence finalized.
  const head = broadcast
    ? await api.rpc.chain.getBlockHash((await api.rpc.chain.getHeader()).number)
    : await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(head);
  const blockNumber = header.number.toNumber();
  const blockHash = head.toHex();
  const poolRows = await snapshotAt(head, blockNumber);
  const input = overrides.amountIn ?? 1_000_000_000_000n;
  const route = makeRoute(blockNumber, blockHash, steps);
  const quoted = quoteRoute(poolRows, steps, input);
  const intent = makeIntent(signerAddress ?? origin, steps[0].asset_in, steps.at(-1).asset_out, input, overrides.minOut ?? (quoted.output * 9950n / 10000n), overrides.maxFee ?? quoted.fee + 1n, overrides.deadline ?? BigInt(blockNumber + 8), index, label);
  const commitment = hex(commitmentFor(intent, bytes(route.route_hash)));
  const simulationStarted = Date.now();
  const apiAt = await api.at(head);
  const simulationResult = await callAt(apiAt, origin, router, routerArtifact.abi, 'execute', [
    { intent_id: bytes(intent.intent_id), owner: intent.owner, asset_in: { Contract: intent.asset_in }, asset_out: { Contract: intent.asset_out }, amount_in: intent.amount_in, amount_out_min: intent.amount_out_min, max_fee: intent.max_fee, deadline: intent.deadline },
    steps.map((step) => ({ pool_id: step.pool_id, asset_in: { Contract: step.asset_in }, asset_out: { Contract: step.asset_out } })), blockNumber, blockHash, bytes(commitment),
    ]);
  const simulation = { success: simulationResult.success, gasRequired: jsonValue(simulationResult.gasRequired), output: simulationResult.rawOutput ? Array.from(simulationResult.rawOutput) : [], failureReason: simulationResult.failureReason, block: blockRef(blockNumber, blockHash), durationMs: Date.now() - simulationStarted, callHash: hex(callHashFor(simulationResult.input, blockHash)) };
  simulation.hash = hashJson(simulation);
  const quoteData = { intent_id: intent.intent_id, route_hash: route.route_hash, commitment_hash: commitment, amount_in: input.toString(), amount_out: quoted.output.toString(), fee: quoted.fee.toString(), gas: String(simulation.gasRequired?.refTime ?? 0), score: quoted.output.toString(), risk_fields: { label, hops: steps.length, price_impact_bps: 0, stale_blocks: 0 } };
  if (!broadcast || dryRunOnly) {
    makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt: null, status: simulation.success ? 'Simulated' : 'Rejected', failureReason: simulation.failureReason });
    return { label, simulation, quote: quoted, route, intent };
  }
  const expectSuccess = kind !== 'failure';
  if (expectSuccess && !simulation.success) {
    makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt: null, status: 'Rejected', failureReason: simulation.failureReason });
    throw new Error(`${label} dry-run was rejected; refusing to broadcast a success case: ${simulation.failureReason ?? 'unknown failure'}.`);
  }
  if (kind === 'failure' && simulation.success) {
    makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt: null, status: 'Simulated', failureReason: null });
    throw new Error(`${label} dry-run unexpectedly succeeded; refusing to broadcast a protection case.`);
  }
  const item = message(routerArtifact.abi, 'execute');
  const txInput = item.toU8a([
    { intent_id: bytes(intent.intent_id), owner: intent.owner, asset_in: { Contract: intent.asset_in }, asset_out: { Contract: intent.asset_out }, amount_in: intent.amount_in, amount_out_min: intent.amount_out_min, max_fee: intent.max_fee, deadline: intent.deadline },
    steps.map((step) => ({ pool_id: step.pool_id, asset_in: { Contract: step.asset_in }, asset_out: { Contract: step.asset_out } })), blockNumber, blockHash, bytes(commitment),
  ]);
  const tx = api.tx.contracts.call(router, 0, simulationResult.gasRequired, null, txInput);
  const submissionStarted = Date.now();
  const receipt = await submitAndFinalize(api, tx, pair);
  receipt.durationMs = Date.now() - submissionStarted;
  const finalRecord = makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt, status: receipt.success ? 'Confirmed' : 'Rejected', failureReason: receipt.failureReason });
  return { label, simulation, receipt, quote: quoted, route, intent, record: finalRecord };
}

const stepsSingle = [{ pool_id: poolA, asset_in: tokenA, asset_out: tokenB }];
const stepsTwoHop = [{ pool_id: poolA, asset_in: tokenA, asset_out: tokenB }, { pool_id: poolB, asset_in: tokenB, asset_out: tokenA }];
const results = [];
if (broadcast) {
  const approveAmount = BigInt(successCount + 10) * 1_000_000_000_000n;
  const approvalAt = await api.at(await api.rpc.chain.getFinalizedHead());
  const approval = await callAt(approvalAt, origin, tokenA, tokenArtifact.abi, 'approve', [router, approveAmount]);
  if (!approval.success) throw new Error(`token approval dry-run failed: ${approval.failureReason}`);
  await submitAndFinalize(api, api.tx.contracts.call(tokenA, 0, approval.gasRequired, null, approval.input), pair);
}
for (let i = 0; i < successCount; i += 1) {
  const useTwoHop = !singleHopOnly && i % 2 === 1;
  results.push(await performCase(i, useTwoHop ? 'two-hop-success' : 'single-hop-success', useTwoHop ? stepsTwoHop : stepsSingle, useTwoHop ? 'two-hop' : 'single'));
}
const failureCases = successOnly ? [] : [
  ['slippage-protection', stepsSingle, { minOut: 2_000_000_000_000n }],
  ['fee-limit-protection', stepsSingle, { maxFee: 0n }],
  ['deadline-protection', stepsSingle, { deadline: 0n }],
  ['invalid-route-protection', [{ pool_id: poolA, asset_in: tokenA, asset_out: tokenB }, { pool_id: poolA, asset_in: tokenB, asset_out: tokenA }], {}],
  ['zero-amount-protection', stepsSingle, { amountIn: 0n, minOut: 0n, maxFee: 0n }],
];
for (const [label, steps, overrides] of failureCases) results.push(await performCase(successCount + results.length, label, steps, 'failure', overrides));
const endHash = await api.rpc.chain.getFinalizedHead();
const endHeader = await api.rpc.chain.getHeader(endHash);
run.end_block = endHeader.number.toNumber();
run.end_block_hash = endHash.toHex();
database.prepare('UPDATE portaldot_runs SET end_block=?,payload_json=? WHERE run_id=?').run(run.end_block, JSON.stringify(run), runId);
const summary = { schemaVersion: 1, generatedAt: new Date().toISOString(), network, endpointHost: new URL(endpoint).host, mode: broadcast ? 'broadcast' : 'dry-run', runtime, runtimeMetadataHash, deploymentPath: path.relative(root, deploymentPath), databasePath: path.relative(root, databasePath), run, counts: { successful: results.filter((item) => item.receipt?.success).length, rejected: results.filter((item) => item.receipt && !item.receipt.success).length, simulated: results.filter((item) => !item.receipt).length }, cases: results.map((item) => ({ label: item.label, success: item.receipt?.success ?? item.simulation.success, txHash: item.receipt?.txHash ?? null, blockNumber: item.receipt?.blockNumber ?? item.simulation.block.number, failureReason: item.receipt?.failureReason ?? item.simulation.failureReason ?? null, hops: item.route.steps.length, routeHash: item.route.route_hash })) };
await writeFile(path.join(outputPath, 'p4-p8-run.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
database.close();
await api.disconnect();
process.stdout.write(`P4-P8 single-chain acceptance ${summary.mode} complete: ${summary.counts.successful} successful, ${summary.counts.rejected} rejected, ${summary.counts.simulated} simulated.\n`);

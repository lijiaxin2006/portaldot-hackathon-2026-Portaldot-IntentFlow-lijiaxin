import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Abi } from '@polkadot/api-contract';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, decodeAddress, encodeAddress } from '@polkadot/util-crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const endpoint = () => process.env.PORTALDOT_TESTNET_WS_URL ?? 'wss://test-node-v3.portaldot.dev';
const deploymentPath = () => resolve(root, process.env.INTENTFLOW_DEPLOYMENTS ?? 'evidence/p3/p2-live-preflight-v2.json');
const databasePath = () => resolve(root, process.env.INTENTFLOW_EVIDENCE_DB ?? 'data/intentflow.sqlite3');
const network = () => process.env.PORTALDOT_TESTNET_NETWORK ?? 'portaldot-testnet';

function hex(value) {
  return `0x${Buffer.from(value).toString('hex')}`;
}

function bytes(value) {
  return Buffer.from(String(value).replace(/^0x/, ''), 'hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

function littleEndian(value, width) {
  let remaining = BigInt(value);
  const output = Buffer.alloc(width);
  for (let index = 0; index < width; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error(`Value does not fit in ${width} bytes.`);
  return output;
}

function accountBytes(address) {
  return Buffer.from(decodeAddress(address));
}

function canonicalAddress(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new IntentInputError(`${label} is required.`, 400);
  try {
    return encodeAddress(decodeAddress(value.trim()), 42);
  } catch {
    throw new IntentInputError(`${label} must be a valid SS58 address.`, 400);
  }
}

function accountKey(value) {
  return Buffer.from(decodeAddress(value)).toString('hex');
}

function assetBytes(address) {
  return Buffer.concat([Buffer.from([1]), accountBytes(address)]);
}

function routeHashFor(networkName, blockNumber, blockHash, steps) {
  return sha256(Buffer.concat([
    Buffer.from('intentflow-route-v1\0'),
    littleEndian(Buffer.byteLength(networkName), 4),
    Buffer.from(networkName),
    littleEndian(blockNumber, 8),
    bytes(blockHash),
    littleEndian(steps.length, 4),
    ...steps.flatMap((step) => [accountBytes(step.pool_id), assetBytes(step.asset_in), assetBytes(step.asset_out)]),
  ]));
}

function intentHashFor(intent) {
  return sha256(Buffer.concat([
    Buffer.from('intentflow-intent-v1\0'),
    bytes(intent.intent_id),
    accountBytes(intent.owner),
    assetBytes(intent.asset_in),
    assetBytes(intent.asset_out),
    littleEndian(intent.amount_in, 16),
    littleEndian(intent.amount_out_min, 16),
    littleEndian(intent.max_fee, 16),
    littleEndian(intent.deadline, 8),
  ]));
}

function commitmentFor(intent, routeHash) {
  return sha256(Buffer.concat([
    Buffer.from('intentflow-execution-commitment-v1\0'),
    intentHashFor(intent),
    routeHash,
  ]));
}

function callHashFor(input, blockHash) {
  return sha256(Buffer.concat([Buffer.from('intentflow-router-call-v1\0'), input, bytes(blockHash)]));
}

function jsonStringify(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

function jsonValue(value) {
  if (value === undefined || value === null) return null;
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

function message(abi, name) {
  const found = abi.messages.filter((item) => item.identifier.toString() === name || item.identifier.toString().endsWith(`::${name}`));
  if (found.length !== 1) throw new Error(`${name} resolved to ${found.length} messages.`);
  return found[0];
}

function extractDispatchError(error, api) {
  if (!error) return null;
  if (error.isModule) {
    const decoded = api.registry.findMetaError(error.asModule);
    return `${decoded.section}.${decoded.name}`;
  }
  return error.toString();
}

function chargedDeposit(value) {
  if (value?.isCharge) return BigInt(value.asCharge.toString());
  if (value?.Charge !== undefined) return BigInt(value.Charge.toString());
  return 0n;
}

function decodeContractCallOutput(abi, item, raw) {
  try {
    const decoded = abi.registry.createTypeUnsafe(item.returnType.lookupName || item.returnType.type, [raw]);
    return { output: jsonValue(decoded), decodeFailure: null };
  } catch (error) {
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
        const contractError = abi.registry.createTypeUnsafe(item.returnType.sub[0].sub[1].lookupName, [raw.subarray(1)]);
        return { output: { err: jsonValue(contractError) }, decodeFailure: null };
      } catch (nestedError) {
        return { output: null, decodeFailure: nestedError instanceof Error ? nestedError.message : String(nestedError) };
      }
    }
    return { output: null, decodeFailure: error instanceof Error ? error.message : String(error) };
  }
}

function contractResultError(output) {
  if (!output || typeof output !== 'object') return null;
  const outer = output.Ok ?? output.ok;
  if (output.Err ?? output.err) return String(output.Err ?? output.err);
  if (outer && typeof outer === 'object' && (outer.Err ?? outer.err)) return String(outer.Err ?? outer.err);
  return null;
}

async function callAt(apiAt, origin, destination, abi, name, params, decodeOutput = true) {
  const item = message(abi, name);
  const input = item.toU8a(params);
  const result = await apiAt.call.contractsApi.call(origin, destination, 0, null, null, input);
  if (result.result.isErr) {
    return {
      success: false,
      input,
      gasRequired: result.gasRequired,
      output: null,
      failureReason: extractDispatchError(result.result.asErr, apiAt.registry),
    };
  }
  let output = null;
  let decodeFailure = null;
  if (decodeOutput && item.returnType) {
    const decoded = decodeContractCallOutput(abi, item, result.result.asOk.data.toU8a(true));
    output = decoded.output;
    decodeFailure = decoded.decodeFailure;
  }
  const contractError = contractResultError(output);
  return {
    success: !contractError && !decodeFailure,
    input,
    gasRequired: result.gasRequired,
    output,
    rawOutput: result.result.asOk.data.toU8a(true),
    failureReason: contractError ?? decodeFailure,
    storageDeposit: chargedDeposit(result.storageDeposit),
  };
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
        finish(null, {
          txHash: result.txHash.toHex(),
          blockHash,
          blockNumber: header.number.toNumber(),
          extrinsicIndex: result.events[0]?.phase?.isApplyExtrinsic ? result.events[0].phase.asApplyExtrinsic.toNumber() : 0,
          success,
          failureReason: failed ? extractDispatchError(failed.event.data[0], api) : null,
          events,
          gasUsed: { ref_time: '0', proof_size: '0' },
        });
      } catch (error) {
        finish(error);
      }
    }).then((unsubscribe) => { stop = unsubscribe; if (settled) stop(); }).catch((error) => finish(error));
  });
}

function loadDeploymentSource() {
  return readFile(deploymentPath(), 'utf8').then((value) => JSON.parse(value));
}

function deploymentRows(source) {
  return Object.entries(source.deployments ?? {}).map(([kind, value]) => ({
    kind,
    address: value.contract_address ?? value.address,
    codeHash: value.code_hash ?? value.codeHash,
    metadataHash: value.metadata_hash ?? value.metadataHash,
    deployTxHash: value.transaction_hash ?? value.deploy_tx_hash,
    deployBlockHash: value.finalized_block_hash ?? value.deploy_block_hash,
  })).filter((value) => value.address && value.codeHash);
}

async function artifact(name, api) {
  const bundle = JSON.parse(await readFile(resolve(root, 'target/p2-contracts', `${name}.contract`), 'utf8'));
  const wasm = await readFile(resolve(root, 'target/p2-contracts', `${name}.deployable.wasm`));
  const abi = new Abi(bundle, api.registry.getChainProperties());
  return { name, abi, wasm };
}

function parsePositive(value, label, allowZero = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new IntentInputError(`${label} is required.`, 400);
  }
  if (!/^\d+$/.test(String(value))) throw new IntentInputError(`${label} must be an integer.`, 400);
  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > ((1n << 128n) - 1n)) {
    throw new IntentInputError(`${label} is outside the valid u128 range.`, 400);
  }
  return parsed;
}

function parseHops(value) {
  const hops = value === undefined ? 2 : Number(value);
  if (!Number.isInteger(hops) || hops < 1 || hops > 2) throw new IntentInputError('maxHops must be 1 or 2.', 400);
  return hops;
}

function quote(pool, assetIn, input) {
  const inputKey = accountKey(assetIn);
  const asset0Key = accountKey(pool.asset0);
  const asset1Key = accountKey(pool.asset1);
  let reserveIn;
  let reserveOut;
  if (inputKey === asset0Key) {
    reserveIn = BigInt(pool.reserve0);
    reserveOut = BigInt(pool.reserve1);
  } else if (inputKey === asset1Key) {
    reserveIn = BigInt(pool.reserve1);
    reserveOut = BigInt(pool.reserve0);
  } else {
    return null;
  }
  const fee = input * BigInt(pool.feeBps);
  const afterFee = input * 10_000n - fee;
  const output = (afterFee * reserveOut) / (reserveIn * 10_000n + afterFee);
  const noFee = (input * reserveOut) / (reserveIn + input);
  return { output, fee: noFee > output ? noFee - output : 0n };
}

function otherAsset(pool, asset) {
  const key = accountKey(asset);
  if (key === accountKey(pool.asset0)) return pool.asset1;
  if (key === accountKey(pool.asset1)) return pool.asset0;
  return null;
}

function enumerateRoutes(pools, assetIn, assetOut, maxHops) {
  const routes = [];
  for (const pool of pools) {
    if (otherAsset(pool, assetIn) === assetOut) {
      routes.push([{ pool_id: pool.poolId, asset_in: assetIn, asset_out: assetOut }]);
    }
  }
  if (maxHops < 2) return routes;
  for (const first of pools) {
    const middle = otherAsset(first, assetIn);
    if (!middle) continue;
    for (const second of pools) {
      if (second.poolId === first.poolId) continue;
      if (otherAsset(second, middle) === assetOut) {
        routes.push([
          { pool_id: first.poolId, asset_in: assetIn, asset_out: middle },
          { pool_id: second.poolId, asset_in: middle, asset_out: assetOut },
        ]);
      }
    }
  }
  return routes;
}

function quoteRoute(pools, steps, input) {
  let current = input;
  let fee = 0n;
  for (const step of steps) {
    const pool = pools.find((item) => item.poolId === step.pool_id);
    const hop = pool && quote(pool, step.asset_in, current);
    if (!hop) return null;
    fee += hop.fee;
    current = hop.output;
  }
  return { output: current, fee };
}

function chooseRoute(pools, assetIn, assetOut, amountIn, amountOutMin, maxFee, maxHops) {
  const quotedCandidates = enumerateRoutes(pools, assetIn, assetOut, maxHops)
    .map((steps) => ({ steps, quote: quoteRoute(pools, steps, amountIn) }))
    .filter((candidate) => candidate.quote);
  const candidates = quotedCandidates
    .filter((candidate) => candidate.quote.output >= amountOutMin && candidate.quote.fee <= maxFee)
    .sort((left, right) => {
      if (left.quote.output !== right.quote.output) return left.quote.output > right.quote.output ? -1 : 1;
      if (left.quote.fee !== right.quote.fee) return left.quote.fee < right.quote.fee ? -1 : 1;
      return left.steps.length - right.steps.length;
    });
  if (!candidates.length) {
    if (!quotedCandidates.length) {
      throw new IntentInputError(`No route exists for the selected asset pair within ${maxHops} hop(s).`, 422);
    }
    const bestOutput = quotedCandidates.reduce((best, candidate) => candidate.quote.output > best ? candidate.quote.output : best, 0n);
    const lowestFee = quotedCandidates.reduce((best, candidate) => candidate.quote.fee < best ? candidate.quote.fee : best, quotedCandidates[0].quote.fee);
    const reasons = [];
    if (bestOutput < amountOutMin) reasons.push(`minimum output ${amountOutMin} exceeds the best quote ${bestOutput}`);
    if (lowestFee > maxFee) reasons.push(`maximum fee ${maxFee} is below the lowest quote fee ${lowestFee}`);
    throw new IntentInputError(`No route satisfies the intent constraints: ${reasons.join('; ')}.`, 422);
  }
  return candidates[0];
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
  `);
  return database;
}

function hashJson(value) {
  return hex(sha256(Buffer.from(jsonStringify(value))));
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

function insertEvidence(database, record, deploymentRows) {
  const intentId = record.execution.intent_id;
  const payload = jsonStringify(record);
  const now = Date.now();
  const execution = record.execution;
  const receiptBlockHash = record.receipt?.block?.hash;
  const receiptBlockHashText = typeof receiptBlockHash === 'string' ? receiptBlockHash : receiptBlockHash?.[0] ?? null;
  database.prepare('INSERT OR REPLACE INTO portaldot_evidence (intent_id,input_hash,route_hash,simulation_hash,receipt_hash,payload_json,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?)').run(intentId, record.input_hash, record.route_hash, record.simulation_hash, record.receipt_hash, payload, now, now);
  database.prepare('INSERT OR REPLACE INTO portaldot_intents (intent_id,owner,route_hash,amount_in,amount_out_min,deadline,payload_json) VALUES (?,?,?,?,?,?,?)').run(intentId, record.intent.owner, record.route_hash, String(record.intent.amount_in), String(record.intent.amount_out_min), record.intent.deadline.toString(), jsonStringify(record.intent));
  const quoteData = record.quote;
  database.prepare('INSERT OR REPLACE INTO portaldot_quotes (intent_id,amount_out,fee,gas,score,risk_fields_json,payload_json) VALUES (?,?,?,?,?,?,?)').run(intentId, String(quoteData.amount_out), String(quoteData.fee), String(quoteData.gas), String(quoteData.score), jsonStringify(quoteData.risk_fields), jsonStringify(quoteData));
  database.prepare('INSERT OR REPLACE INTO portaldot_executions (intent_id,tx_hash,block_hash,status,amount_out,fee,event_hash,payload_json) VALUES (?,?,?,?,?,?,?,?)').run(intentId, record.receipt?.tx_hash ?? null, receiptBlockHashText, execution.status, String(quoteData.amount_out), String(quoteData.fee), execution.event_hash, jsonStringify(execution));
  const deploymentStatement = database.prepare('INSERT OR REPLACE INTO portaldot_deployments (network,contract_kind,address,code_hash,metadata_hash,deploy_tx_hash,deploy_block_hash,payload_json) VALUES (?,?,?,?,?,?,?,?)');
  for (const row of deploymentRows) deploymentStatement.run(network(), row.kind, row.address, row.codeHash, row.metadataHash ?? '', row.deployTxHash ?? '', row.deployBlockHash ?? '', JSON.stringify({ network: network(), contract_kind: row.kind, address: row.address, code_hash: row.codeHash, metadata_hash: row.metadataHash, deploy_tx_hash: row.deployTxHash, deploy_block_hash: row.deployBlockHash }));
}

function insertPoolSnapshots(database, pools, deploymentRows) {
  const statement = database.prepare('INSERT OR REPLACE INTO portaldot_pools (network,pool_address,token0,token1,fee_bps,code_hash,observed_block,payload_json) VALUES (?,?,?,?,?,?,?,?)');
  for (const pool of pools) {
    const codeHash = deploymentRows.find((row) => row.address === pool.poolId)?.codeHash ?? null;
    statement.run(
      network(),
      pool.poolId,
      JSON.stringify({ Contract: pool.asset0 }),
      JSON.stringify({ Contract: pool.asset1 }),
      pool.feeBps,
      codeHash,
      pool.observedAt.number,
      JSON.stringify({
        network: network(),
        snapshot: {
          pool_id: { Contract: pool.poolId },
          kind: 'ConstantProduct',
          asset_0: { Contract: pool.asset0 },
          asset_1: { Contract: pool.asset1 },
          reserve_0: pool.reserve0,
          reserve_1: pool.reserve1,
          fee_bps: pool.feeBps,
          observed_at: pool.observedAt,
          code_hash: codeHash,
        },
      }),
    );
  }
}

function makeRecord({ intent, route, commitmentHash, quoteData, simulation, receipt, status, failureReason, router, routerCodeHash, runtimeMetadataHash }) {
  const events = eventEvidence(receipt, receipt ? { number: receipt.blockNumber, hash: receipt.blockHash } : simulation.block);
  return {
    execution: { network: network(), intent_id: intent.intent_id, route_hash: route.route_hash, commitment_hash: commitmentHash, simulation_hash: simulation?.hash ?? null, tx_hash: receipt?.txHash ?? null, block_hash: receipt?.blockHash ?? null, event_hash: events.length ? hashJson(events) : null, metadata_hash: runtimeMetadataHash, code_hash: routerCodeHash, status },
    intent: { ...intent },
    route: { ...route, steps: route.steps.map((step) => ({ ...step })) },
    deployment: { network: network(), contract_kind: 'intent_router', address: router, code_hash: routerCodeHash },
    quote: quoteData,
    input_hash: hashJson(intent),
    route_hash: route.route_hash,
    simulation_hash: simulation?.hash ?? null,
    receipt_hash: receipt ? hashJson(receipt) : null,
    simulation: simulation ? { call_hash: simulation.callHash, block: simulation.block, success: simulation.success, gas_required: simulation.gasRequired, output: simulation.output ?? [], events: [], failure_reason: simulation.failureReason } : null,
    receipt: receipt ? { tx_hash: receipt.txHash, block: { number: receipt.blockNumber, hash: receipt.blockHash }, extrinsic_index: receipt.extrinsicIndex, success: receipt.success, gas_used: receipt.gasUsed, failure_reason: receipt.failureReason } : null,
    events,
    failure_reason: failureReason ?? receipt?.failureReason ?? simulation?.failureReason ?? null,
    created_at_ms: Date.now(),
    simulation_duration_ms: simulation?.durationMs ?? null,
    submission_duration_ms: receipt?.durationMs ?? null,
  };
}

async function readPools(apiAt, origin, poolAbi, poolRows, blockNumber, blockHash) {
  const pools = [];
  for (const row of poolRows) {
    const read = async (name) => {
      const result = await callAt(apiAt, origin, row.address, poolAbi, name, []);
      if (!result.success) throw new Error(`${row.kind}.${name} failed: ${result.failureReason ?? 'unknown error'}`);
      return unwrap(result.output);
    };
    const token0 = canonicalAddress(String(await read('token_0')), `${row.kind}.token_0`);
    const token1 = canonicalAddress(String(await read('token_1')), `${row.kind}.token_1`);
    const reserves = await read('reserves');
    const reserve0 = String(Array.isArray(reserves) ? reserves[0] : reserves?.[0] ?? reserves?.reserve_0);
    const reserve1 = String(Array.isArray(reserves) ? reserves[1] : reserves?.[1] ?? reserves?.reserve_1);
    const feeBps = Number(await read('fee_bps'));
    pools.push({ poolId: row.address, kind: row.kind, asset0: token0, asset1: token1, reserve0, reserve1, feeBps, observedAt: { number: blockNumber, hash: blockHash } });
  }
  return pools;
}

function inputIntent(request, owner, blockNumber) {
  const assetIn = canonicalAddress(request.assetIn, 'assetIn');
  const assetOut = canonicalAddress(request.assetOut, 'assetOut');
  if (accountKey(assetIn) === accountKey(assetOut)) throw new IntentInputError('assetIn and assetOut must be different.', 400);
  const amountIn = parsePositive(request.amountIn, 'amountIn');
  const amountOutMin = parsePositive(request.amountOutMin, 'amountOutMin', true);
  const maxFee = parsePositive(request.maxFee, 'maxFee', true);
  const deadline = request.deadline === undefined || request.deadline === null || String(request.deadline).trim() === ''
    ? BigInt(blockNumber + 8)
    : parsePositive(request.deadline, 'deadline', true);
  return {
    intent_id: hex(sha256(Buffer.from(`intentflow-user-intent-${Date.now()}-${Math.random()}-${owner}`))),
    owner,
    asset_in: assetIn,
    asset_out: assetOut,
    amount_in: amountIn,
    amount_out_min: amountOutMin,
    max_fee: maxFee,
    deadline,
  };
}

export class IntentInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'IntentInputError';
    this.status = status;
  }
}

export async function getIntentConfig() {
  const source = await loadDeploymentSource();
  const rows = deploymentRows(source);
  const byKind = (kind) => rows.find((row) => row.kind === kind)?.address ?? null;
  return {
    network: network(),
    endpointHost: new URL(endpoint()).hostname,
    owner: process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS ?? null,
    allowBroadcast: process.env.INTENTFLOW_ALLOW_BROADCAST === '1',
    assets: [
      { id: 'token_a', label: 'Token A', address: byKind('token_a') },
      { id: 'token_b', label: 'Token B', address: byKind('token_b') },
    ].filter((asset) => asset.address),
    pools: [
      { id: 'pool_a', address: byKind('pool_a') },
      { id: 'pool_b', address: byKind('pool_b') },
    ].filter((pool) => pool.address),
  };
}

export async function executeIntent(request) {
  if (!request || typeof request !== 'object') throw new IntentInputError('Intent body must be a JSON object.', 400);
  const broadcast = request.broadcast === true;
  if (broadcast && process.env.INTENTFLOW_ALLOW_BROADCAST !== '1') {
    throw new IntentInputError('Broadcast is disabled. Set INTENTFLOW_ALLOW_BROADCAST=1 for this server process.', 403);
  }
  if (!process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS?.trim()) {
    throw new IntentInputError('Dashboard server is missing PORTALDOT_TEST_ACCOUNT_ADDRESS. Set it before starting npm run p7:dashboard.', 503);
  }
  const owner = canonicalAddress(process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS, 'PORTALDOT_TEST_ACCOUNT_ADDRESS');
  if (broadcast && !process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC) {
    throw new IntentInputError('Broadcast requires PORTALDOT_TEST_ACCOUNT_MNEMONIC in the server environment.', 403);
  }
  await cryptoWaitReady();
  const source = await loadDeploymentSource();
  const rows = deploymentRows(source);
  const tokenA = rows.find((row) => row.kind === 'token_a');
  const tokenB = rows.find((row) => row.kind === 'token_b');
  const poolRows = rows.filter((row) => row.kind === 'pool_a' || row.kind === 'pool_b');
  const router = rows.find((row) => row.kind === 'intent_router');
  if (!tokenA || !tokenB || poolRows.length < 2 || !router) throw new IntentInputError('Deployment report does not contain the required contracts.', 503);

  const api = await ApiPromise.create({ provider: new WsProvider(endpoint()) });
  let database;
  try {
    await api.isReady;
    const initialFinalizedHash = await api.rpc.chain.getFinalizedHead();
    const runtime = { spec_name: api.runtimeVersion.specName.toString(), spec_version: api.runtimeVersion.specVersion.toNumber(), transaction_version: api.runtimeVersion.transactionVersion.toNumber() };
    const metadata = await api.rpc.state.getMetadata(initialFinalizedHash);
    const runtimeMetadataHash = hex(sha256(bytes(metadata.toHex())));
    const [tokenArtifact, poolArtifact, routerArtifact] = await Promise.all([
      artifact('intentflow_psp22_test_token', api),
      artifact('intentflow_amm_pool', api),
      artifact('intentflow_intent_router', api),
    ]);
    let pair = null;
    if (broadcast) {
      const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
      pair = keyring.addFromUri(process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC);
      if (pair.address !== owner) throw new IntentInputError('The configured mnemonic does not derive PORTALDOT_TEST_ACCOUNT_ADDRESS.', 403);
      const approvalAsset = canonicalAddress(request.assetIn, 'assetIn');
      const approvalAmount = parsePositive(request.amountIn, 'amountIn');
      const approval = await callAt(await api.at(initialFinalizedHash), owner, approvalAsset, tokenArtifact.abi, 'approve', [router.address, approvalAmount]);
      if (!approval.success) throw new IntentInputError(`Token approval dry-run failed: ${approval.failureReason ?? 'unknown error'}`, 422);
      await submitAndFinalize(api, api.tx.contracts.call(approvalAsset, 0, approval.gasRequired, null, approval.input), pair);
    }
    // Broadcast approval changes the chain head. Build the route and dry-run
    // only after approval so the two-block Router snapshot limit is preserved.
    const finalizedHash = broadcast ? await api.rpc.chain.getFinalizedHead() : initialFinalizedHash;
    const broadcastHead = broadcast
      ? await api.rpc.chain.getBlockHash((await api.rpc.chain.getHeader()).number)
      : finalizedHash;
    const executionHead = broadcast ? broadcastHead : finalizedHash;
    const executionHeader = await api.rpc.chain.getHeader(executionHead);
    const executionBlockNumber = executionHeader.number.toNumber();
    const executionBlockHash = executionHead.toHex();
    const apiAt = await api.at(executionHead);
    const pools = await readPools(apiAt, owner, poolArtifact.abi, poolRows, executionBlockNumber, executionBlockHash);
    const intent = inputIntent(request, owner, executionBlockNumber);
    const maxHops = parseHops(request.maxHops);
    const selected = chooseRoute(pools, intent.asset_in, intent.asset_out, intent.amount_in, intent.amount_out_min, intent.max_fee, maxHops);
    const routeHash = routeHashFor(network(), executionBlockNumber, executionBlockHash, selected.steps);
    const route = { network: network(), start_block: { number: executionBlockNumber, hash: executionBlockHash }, steps: selected.steps, route_hash: hex(routeHash) };
    const commitment = hex(commitmentFor(intent, routeHash));
    const simulationStarted = Date.now();
    const simulationResult = await callAt(apiAt, owner, router.address, routerArtifact.abi, 'execute', [
      { intent_id: bytes(intent.intent_id), owner: intent.owner, asset_in: { Contract: intent.asset_in }, asset_out: { Contract: intent.asset_out }, amount_in: intent.amount_in, amount_out_min: intent.amount_out_min, max_fee: intent.max_fee, deadline: intent.deadline },
      selected.steps.map((step) => ({ pool_id: step.pool_id, asset_in: { Contract: step.asset_in }, asset_out: { Contract: step.asset_out } })),
      executionBlockNumber,
      executionBlockHash,
      bytes(commitment),
    ]);
    const simulation = { success: simulationResult.success, gasRequired: jsonValue(simulationResult.gasRequired), output: simulationResult.rawOutput ? Array.from(simulationResult.rawOutput) : [], failureReason: simulationResult.failureReason, block: { number: executionBlockNumber, hash: executionBlockHash }, durationMs: Date.now() - simulationStarted, callHash: hex(callHashFor(simulationResult.input, executionBlockHash)) };
    simulation.hash = hashJson(simulation);
    const quoteData = { intent_id: intent.intent_id, route_hash: route.route_hash, commitment_hash: commitment, amount_in: intent.amount_in.toString(), amount_out: selected.quote.output.toString(), fee: selected.quote.fee.toString(), gas: String(simulation.gasRequired?.refTime ?? 0), score: selected.quote.output.toString(), risk_fields: { source: 'user_intent', hops: selected.steps.length, max_hops: maxHops, price_impact_bps: 0, stale_blocks: 0 } };
    const runId = `intent-${Date.now()}`;
    database = sqlDatabase(databasePath());
    database.prepare('INSERT OR REPLACE INTO portaldot_runs (run_id,network,runtime_version,start_block,end_block,code_revision,machine_profile,payload_json,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(runId, network(), `${runtime.spec_name}/${runtime.spec_version}/tx${runtime.transaction_version}`, executionBlockNumber, null, null, `${process.platform}/${process.arch}/node-${process.versions.node}`, JSON.stringify({ run_id: runId, network: network(), runtime_version: `${runtime.spec_name}/${runtime.spec_version}/tx${runtime.transaction_version}`, start_block: executionBlockNumber, end_block: null, start_block_hash: executionBlockHash, end_block_hash: null, machine_profile: `${process.platform}/${process.arch}/node-${process.versions.node}`, created_at_ms: Date.now() }), Date.now());
    insertPoolSnapshots(database, pools, rows);
    const finishRun = async () => {
      const endHash = await api.rpc.chain.getFinalizedHead();
      const endHeader = await api.rpc.chain.getHeader(endHash);
      database.prepare('UPDATE portaldot_runs SET end_block=?,payload_json=? WHERE run_id=?').run(endHeader.number.toNumber(), JSON.stringify({ run_id: runId, network: network(), runtime_version: `${runtime.spec_name}/${runtime.spec_version}/tx${runtime.transaction_version}`, start_block: executionBlockNumber, end_block: endHeader.number.toNumber(), start_block_hash: executionBlockHash, end_block_hash: endHash.toHex(), machine_profile: `${process.platform}/${process.arch}/node-${process.versions.node}`, created_at_ms: Date.now() }), runId);
    };
    const rejectedRecord = () => {
      const record = makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt: null, status: simulation.success ? 'Simulated' : 'Rejected', failureReason: simulation.failureReason, router: router.address, routerCodeHash: router.codeHash, runtimeMetadataHash });
      insertEvidence(database, record, rows);
      return record;
    };
    if (!simulation.success) {
      const record = rejectedRecord();
      await finishRun();
      return { mode: broadcast ? 'broadcast_requested' : 'dry_run', status: 'Rejected', reason: simulation.failureReason, record };
    }
    if (!broadcast) {
      const record = rejectedRecord();
      await finishRun();
      return { mode: 'dry_run', status: 'Simulated', record };
    }
    const item = message(routerArtifact.abi, 'execute');
    const txInput = item.toU8a([
      { intent_id: bytes(intent.intent_id), owner: intent.owner, asset_in: { Contract: intent.asset_in }, asset_out: { Contract: intent.asset_out }, amount_in: intent.amount_in, amount_out_min: intent.amount_out_min, max_fee: intent.max_fee, deadline: intent.deadline },
      selected.steps.map((step) => ({ pool_id: step.pool_id, asset_in: { Contract: step.asset_in }, asset_out: { Contract: step.asset_out } })),
      executionBlockNumber,
      executionBlockHash,
      bytes(commitment),
    ]);
    const submissionStarted = Date.now();
    const receipt = await submitAndFinalize(api, api.tx.contracts.call(router.address, 0, simulationResult.gasRequired, null, txInput), pair);
    receipt.durationMs = Date.now() - submissionStarted;
    const record = makeRecord({ intent, route, commitmentHash: commitment, quoteData, simulation, receipt, status: receipt.success ? 'Confirmed' : 'Rejected', failureReason: receipt.failureReason, router: router.address, routerCodeHash: router.codeHash, runtimeMetadataHash });
    insertEvidence(database, record, rows);
    await finishRun();
    return { mode: 'broadcast', status: receipt.success ? 'Confirmed' : 'Rejected', record };
  } finally {
    database?.close();
    await api.disconnect().catch(() => {});
  }
}

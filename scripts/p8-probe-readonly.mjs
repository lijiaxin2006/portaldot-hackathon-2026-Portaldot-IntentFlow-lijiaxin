import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ApiPromise, WsProvider } from '@polkadot/api';

const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
if (!endpoint) throw new Error('Set PORTALDOT_TESTNET_WS_URL in the environment.');
const url = new URL(endpoint);
if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('PORTALDOT_TESTNET_WS_URL must use ws:// or wss://.');

const outputPath = resolve(process.argv[2] ?? 'artifacts/p8-public-acceptance/probe-report.json');
let api;
try {
  const provider = new WsProvider(endpoint);
  api = await ApiPromise.create({ provider });
  await api.isReady;

  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(finalizedHash);
  const repeatedHash = await api.rpc.chain.getBlockHash(header.number);
  if (finalizedHash.toHex() !== repeatedHash.toHex()) {
    throw new Error('finalized block hash did not match the block-number lookup');
  }
  const [runtime, metadata, chain, genesisHash] = await Promise.all([
    api.rpc.state.getRuntimeVersion(finalizedHash),
    api.rpc.state.getMetadata(finalizedHash),
    api.rpc.system.chain(),
    api.rpc.chain.getBlockHash(0),
  ]);
  const contractPallet = metadata.asLatest.pallets.find((pallet) => pallet.name.toString() === 'Contracts');
  const contractTx = api.tx.contracts;
  const capabilities = {
    contractsModule: Boolean(contractPallet),
    dryRunApi: Boolean(api.call.contractsApi?.call),
    uploadCall: Boolean(contractTx?.uploadCode),
    instantiateCall: Boolean(contractTx?.instantiateWithCode || contractTx?.instantiate),
    eventQueries: Boolean(api.events.contracts?.ContractEmitted),
  };
  const report = {
    schemaVersion: 1,
    source: 'read_only_rpc_metadata',
    network: process.env.PORTALDOT_TESTNET_NETWORK ?? 'portaldot-testnet',
    endpointHost: url.hostname,
    observedAt: new Date().toISOString(),
    chain: chain.toString(),
    genesisHash: genesisHash.toHex(),
    finalizedBlock: {
      number: header.number.toNumber(),
      hash: finalizedHash.toHex(),
    },
    runtime: {
      spec_name: runtime.specName.toString(),
      spec_version: runtime.specVersion.toNumber(),
      transaction_version: runtime.transactionVersion.toNumber(),
    },
    metadataHash: createHash('sha256').update(metadata.toU8a()).digest('hex'),
    capabilities,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`Read-only capability probe written to ${outputPath}\n`);
} catch {
  process.stderr.write('Read-only capability probe failed; endpoint and credential values were not logged.\n');
  process.exitCode = 1;
} finally {
  await api?.disconnect().catch(() => {});
}

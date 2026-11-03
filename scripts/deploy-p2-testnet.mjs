import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Abi } from "@polkadot/api-contract";
import { Keyring } from "@polkadot/keyring";
import { blake2AsU8a, cryptoWaitReady, decodeAddress } from "@polkadot/util-crypto";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const getOption = (prefix, fallback) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
const broadcast = args.has("--broadcast");
const acceptanceSwap = args.has("--acceptance-swap");
const resume = args.has("--resume");
const planPath = path.resolve(getOption("--plan=", "config/p2-testnet-deployment.example.json"));
const reportPath = path.resolve(getOption("--report=", "evidence/p3/p2-deployment.json"));
const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
const address = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const mnemonic = broadcast ? process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC : undefined;
const apiId = "0x68b66ba122c93fa7";
const expectedApiVersion = 2;

if (!endpoint || !address) {
  throw new Error("Set PORTALDOT_TESTNET_WS_URL and PORTALDOT_TEST_ACCOUNT_ADDRESS in the environment.");
}
if (broadcast && (process.env.PORTALDOT_P3_BROADCAST !== "1" || !mnemonic)) {
  throw new Error("Broadcasting requires --broadcast, PORTALDOT_P3_BROADCAST=1, and PORTALDOT_TEST_ACCOUNT_MNEMONIC.");
}
if (acceptanceSwap && !broadcast) {
  throw new Error("--acceptance-swap is only available with --broadcast.");
}

const plan = JSON.parse(await readFile(planPath, "utf8"));
if (plan.network !== "portaldot-testnet") throw new Error("The deployment plan must target portaldot-testnet.");
if (acceptanceSwap && !plan.acceptance_swap?.enabled) {
  throw new Error("The selected plan has acceptance_swap.enabled=false.");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const hex = (bytes) => `0x${Buffer.from(bytes).toString("hex")}`;
const planHash = hex(sha256(Buffer.from(JSON.stringify(plan))));
const parseAmount = (value, label) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${label} must be an integer string.`);
  const amount = BigInt(value);
  if (amount <= 0n || amount > (1n << 128n) - 1n) throw new Error(`${label} is outside the positive u128 range.`);
  return amount;
};
const le = (value, width) => {
  let remaining = BigInt(value);
  const output = Buffer.alloc(width);
  for (let index = 0; index < width; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error(`Value does not fit in ${width} bytes.`);
  return output;
};
const accountBytes = (value) => Buffer.from(decodeAddress(value));
const redactSigner = (value) => {
  if (typeof value === "string") {
    if (value.includes(address)) return value.split(address).join("[configured-account]");
    try {
      if (accountBytes(value).equals(accountBytes(address))) return "[configured-account]";
    } catch {}
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSigner);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactSigner(nested)]));
  }
  return value;
};
const signerAccountHash = hex(sha256(Buffer.from(address, "utf8")));
let savedReport = null;
try {
  savedReport = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (resume && !savedReport) throw new Error("--resume requires an existing deployment report.");
if (!resume && savedReport) throw new Error("The deployment report already exists; use --resume or choose a new --report path.");
const previousReport = resume ? savedReport : null;
if (previousReport) {
  if (previousReport.network !== "portaldot-testnet" || previousReport.endpoint_host !== new URL(endpoint).host) {
    throw new Error("The resume report belongs to a different network endpoint.");
  }
  if (previousReport.plan_sha256 !== planHash) throw new Error("The deployment plan differs from the resume report.");
  if (previousReport.signer_account_sha256 !== signerAccountHash) throw new Error("The configured account differs from the resume report.");
  if (!previousReport.runtime?.genesis_hash) throw new Error("The resume report has no verified chain identity.");
}
const putAsset = (asset) => {
  const contract = asset?.Contract ?? asset?.contract;
  if (!contract) throw new Error("AssetId must contain a contract address.");
  return Buffer.concat([Buffer.from([1]), accountBytes(contract)]);
};
const compactLength = (length) => {
  if (length < 64) return Buffer.from([length << 2]);
  if (length < 16_384) {
    const encoded = (length << 2) | 1;
    return Buffer.from([encoded & 0xff, (encoded >> 8) & 0xff]);
  }
  throw new Error("Route network identifier is too long.");
};
const routeHashFor = (network, blockNumber, blockHash, steps) => sha256(Buffer.concat([
  Buffer.from("intentflow-route-v1\0"),
  le(Buffer.byteLength(network), 4),
  Buffer.from(network, "utf8"),
  le(blockNumber, 8),
  Buffer.from(blockHash.slice(2), "hex"),
  le(steps.length, 4),
  ...steps.flatMap((step) => [accountBytes(step.pool_id), putAsset(step.asset_in), putAsset(step.asset_out)]),
]));
const intentHashFor = (intent) => sha256(Buffer.concat([
  Buffer.from("intentflow-intent-v1\0"),
  Buffer.from(intent.intent_id.slice(2), "hex"),
  accountBytes(intent.owner),
  putAsset(intent.asset_in),
  putAsset(intent.asset_out),
  le(intent.amount_in, 16),
  le(intent.amount_out_min, 16),
  le(intent.max_fee, 16),
  le(intent.deadline, 8),
]));
const commitmentFor = (intent, routeHash) => sha256(Buffer.concat([
  Buffer.from("intentflow-execution-commitment-v1\0"),
  intentHashFor(intent),
  routeHash,
]));

function extractContractError(error, api) {
  if (!error) return null;
  if (error.isModule) {
    const decoded = api.registry.findMetaError(error.asModule);
    return `${decoded.section}.${decoded.name}`;
  }
  return error.toString();
}

function chargedDeposit(storageDeposit) {
  if (storageDeposit?.isCharge) return BigInt(storageDeposit.asCharge.toString());
  if (storageDeposit?.Charge !== undefined) return BigInt(storageDeposit.Charge.toString());
  return 0n;
}

async function saveReport(report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function eventRows(records, api) {
  return records.map(({ event }) => {
    let dispatchError;
    if (event.section === "system" && event.method === "ExtrinsicFailed") {
      dispatchError = extractContractError(event.data[0], api);
    }
    return {
      section: event.section,
      method: event.method,
      data: redactSigner(event.data.toHuman()),
      ...(dispatchError ? { dispatch_error: dispatchError } : {}),
    };
  });
}

function submitAndFinalize(tx, pair, nonce, api) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    let countedInBlock = false;
    const timer = setTimeout(() => finish(new Error("Timed out waiting for finalized transaction.")), 180_000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      if (error) reject(error);
      else resolve(value);
    };

    tx.signAndSend(pair, { nonce }, (result) => {
      const events = eventRows(result.events, api);
      if (!countedInBlock && (result.status.isInBlock || result.status.isFinalized)) {
        countedInBlock = true;
        report.broadcast_count += 1;
        report.run_broadcast_count += 1;
      }
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped || result.status.isFinalityTimeout) {
        finish(new Error(`Transaction did not finalize: ${result.status.type}.`));
        return;
      }
      if (result.dispatchError) {
        finish(new Error(`Transaction dispatch failed: ${extractContractError(result.dispatchError, api)}.`));
        return;
      }
      const failedEvent = events.find((event) => event.dispatch_error);
      if (failedEvent) {
        finish(new Error(`Transaction finalized with ${failedEvent.dispatch_error}.`));
        return;
      }
      if (!result.status.isFinalized) return;
      finish(null, {
        transaction_hash: result.txHash.toHex(),
        finalized_block_hash: result.status.asFinalized.toHex(),
        events,
        fee_paid: result.txFee?.toString() ?? null,
      });
    }).then((stop) => {
      unsubscribe = stop;
      if (settled) unsubscribe();
    }).catch((error) => finish(error));
  });
}

function makeContractArtifact(name, api) {
  const base = path.resolve("target/p2-contracts");
  const bundlePath = path.join(base, `${name}.contract`);
  const wasmPath = path.join(base, `${name}.deployable.wasm`);
  return Promise.all([readFile(bundlePath), readFile(wasmPath)]).then(([bundleBytes, wasm]) => {
    const bundle = JSON.parse(bundleBytes.toString("utf8"));
    const abi = new Abi(bundle, api.registry.getChainProperties());
    return {
      name,
      bundlePath,
      wasmPath,
      wasm,
      wasmHex: hex(wasm),
      codeHash: hex(blake2AsU8a(wasm, 256)),
      bundleSha256: hex(sha256(bundleBytes)),
      metadataHash: hex(sha256(Buffer.from(JSON.stringify(abi.metadata)))),
      abi,
    };
  });
}

function stableSalt(genesisHash, label) {
  return blake2AsU8a(Buffer.concat([
    Buffer.from("intentflow-p2-v1\0"),
    Buffer.from(genesisHash.slice(2), "hex"),
    Buffer.from(label, "utf8"),
  ]), 256).slice(0, 8);
}

function sortedTokens(tokenA, tokenB) {
  return Buffer.compare(accountBytes(tokenA), accountBytes(tokenB)) < 0
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

function constructorArgs(label, tokenA, tokenB) {
  if (label === "token_a") {
    const token = plan.contracts.token_a;
    return [token.name, token.symbol, token.decimals, parseAmount(token.initial_supply, "token_a.initial_supply")];
  }
  if (label === "token_b") {
    const token = plan.contracts.token_b;
    return [token.name, token.symbol, token.decimals, parseAmount(token.initial_supply, "token_b.initial_supply")];
  }
  if (label === "pool_a" || label === "pool_b") {
    return [...sortedTokens(tokenA, tokenB), plan.contracts[label].fee_bps];
  }
  return [];
}

async function preflightCodeUpload(api, at, origin, artifact, previousUpload) {
  const existingInfo = await at.query.contracts.codeInfoOf(artifact.codeHash);
  if (existingInfo && !existingInfo.isNone) {
    return {
      code_hash: artifact.codeHash,
      wasm_sha256: hex(sha256(artifact.wasm)),
      wasm_bytes: artifact.wasm.length,
      storage_deposit: "0",
      estimated_fee: "0",
      already_uploaded: true,
      tx: null,
      artifact,
    };
  }
  const simulation = await at.call.contractsApi.uploadCode(origin, artifact.wasmHex, null, "Enforced");
  if (simulation.isErr) {
    throw new Error(`upload_code dry-run failed: ${extractContractError(simulation.asErr, api)}.`);
  }
  if (simulation.asOk.codeHash.toHex().toLowerCase() !== artifact.codeHash.toLowerCase()) {
    throw new Error(`upload_code dry-run returned an unexpected code hash for ${artifact.name}.`);
  }
  const tx = api.tx.contracts.uploadCode(artifact.wasmHex, null, "Enforced");
  const fee = BigInt((await tx.paymentInfo(origin)).partialFee.toString());
  return {
    code_hash: artifact.codeHash,
    wasm_sha256: hex(sha256(artifact.wasm)),
    wasm_bytes: artifact.wasm.length,
    storage_deposit: simulation.asOk.deposit.toString(),
    estimated_fee: fee.toString(),
    already_uploaded: false,
    tx,
    artifact,
    ...(previousUpload ? { previous_upload: previousUpload } : {}),
  };
}

async function preflightDeployment(api, at, origin, artifact, label, constructorParams, genesisHash, previousDeployment, codeUpload) {
  const constructor = artifact.abi.findConstructor("new");
  const input = constructor.toU8a(constructorParams);
  const salt = stableSalt(genesisHash, label);
  const saltHex = hex(salt);
  const constructorInputHash = hex(sha256(input));
  if (previousDeployment) {
    if (
      previousDeployment.salt !== saltHex
      || previousDeployment.code_hash?.toLowerCase() !== artifact.codeHash.toLowerCase()
      || previousDeployment.wasm_sha256?.toLowerCase() !== hex(sha256(artifact.wasm)).toLowerCase()
      || previousDeployment.metadata_hash?.toLowerCase() !== artifact.metadataHash.toLowerCase()
      || previousDeployment.constructor_input_sha256 !== constructorInputHash
    ) {
      throw new Error(`${label} does not match the saved deployment preflight.`);
    }
    const priorAddress = previousDeployment.predicted_address;
    const priorInfo = priorAddress ? await at.query.contracts.contractInfoOf(priorAddress) : null;
    if (["pass", "finalized_unverified"].includes(previousDeployment.status) && (!priorInfo || priorInfo.isNone)) {
      throw new Error(`${label} is marked deployed in the resume report but is absent from the chain.`);
    }
    if (priorInfo && !priorInfo.isNone) {
      if (!previousDeployment.transaction_hash || !previousDeployment.finalized_block_hash) {
        throw new Error(`${label} exists on chain without a saved finalized deployment receipt.`);
      }
      if (previousDeployment.contract_address && previousDeployment.contract_address !== priorAddress) {
        throw new Error(`${label} saved contract address differs from its predicted address.`);
      }
      if (priorInfo.unwrap().codeHash.toHex().toLowerCase() !== artifact.codeHash.toLowerCase()) {
        throw new Error(`${label} resume address is occupied by a different contract code hash.`);
      }
      return {
        label,
        predicted_address: priorAddress,
        code_hash: artifact.codeHash,
        wasm_sha256: hex(sha256(artifact.wasm)),
        metadata_hash: artifact.metadataHash,
        wasm_bytes: artifact.wasm.length,
        gas_required: null,
        storage_deposit: "0",
        estimated_fee: "0",
        salt: saltHex,
        constructor_input_sha256: constructorInputHash,
        already_deployed: true,
        tx: null,
        artifact,
      };
    }
  }
  const simulation = await at.call.contractsApi.instantiate(
    origin,
    0,
    null,
    null,
    codeUpload?.already_uploaded ? { Existing: artifact.codeHash } : { Upload: artifact.wasmHex },
    input,
    hex(salt),
  );
  if (simulation.result.isErr) {
    const contractError = extractContractError(simulation.result.asErr, api);
    if (contractError === "contracts.StorageDepositNotEnoughFunds") {
      const balance = BigInt(report.fee_preflight?.account_free_balance ?? "0");
      const codeDeposit = BigInt(report.fee_preflight?.new_code_storage_deposits?.[artifact.codeHash] ?? "0");
      const shortfall = codeDeposit > balance ? codeDeposit - balance : 0n;
      throw new Error(
        `${label} constructor dry-run failed: ${contractError}. Free balance=${balance}; `
        + `new code storage deposit estimate=${codeDeposit}; shortfall=${shortfall}. `
        + "This excludes contract state deposits and transaction fees.",
      );
    }
    throw new Error(`${label} constructor dry-run failed: ${contractError}.`);
  }
  const predictedAddress = simulation.result.asOk.accountId.toString();
  if (
    previousDeployment?.predicted_address
    && previousDeployment.predicted_address !== predictedAddress
    && ["pass", "finalized_unverified"].includes(previousDeployment.status)
  ) {
    throw new Error(`${label} predicted address differs from the saved deployment preflight.`);
  }
  const combinedDeposit = chargedDeposit(simulation.storageDeposit);
  const codeDeposit = BigInt(codeUpload?.storage_deposit ?? "0");
  if (combinedDeposit < codeDeposit) {
    throw new Error(`${label} combined storage deposit is below its code upload deposit.`);
  }
  const stateDeposit = combinedDeposit - codeDeposit;
  const tx = api.tx.contracts.instantiate(0, simulation.gasRequired, null, artifact.codeHash, input, hex(salt));
  const fee = BigInt((await tx.paymentInfo(origin)).partialFee.toString());
  return {
    label,
    predicted_address: predictedAddress,
    code_hash: artifact.codeHash,
    wasm_sha256: hex(sha256(artifact.wasm)),
    metadata_hash: artifact.metadataHash,
    wasm_bytes: artifact.wasm.length,
    gas_required: simulation.gasRequired.toJSON(),
    storage_deposit: stateDeposit.toString(),
    combined_storage_deposit: combinedDeposit.toString(),
    code_storage_deposit: codeDeposit.toString(),
    estimated_fee: fee.toString(),
    salt: saltHex,
    constructor_input_sha256: constructorInputHash,
    constructor_input: hex(input),
    tx,
    artifact,
  };
}

async function refreshExistingDeployment(api, origin, prepared) {
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const at = await api.at(finalizedHash);
  const constructorInput = Buffer.from(prepared.constructor_input.slice(2), "hex");
  const simulation = await at.call.contractsApi.instantiate(
    origin,
    0,
    null,
    null,
    { Existing: prepared.code_hash },
    constructorInput,
    prepared.salt,
  );
  if (simulation.result.isErr) {
    throw new Error(`${prepared.label} Existing-code instantiate dry-run failed: ${extractContractError(simulation.result.asErr, api)}.`);
  }
  const predictedAddress = simulation.result.asOk.accountId.toString();
  if (predictedAddress !== prepared.predicted_address) {
    throw new Error(`${prepared.label} Existing-code dry-run changed the predicted address.`);
  }
  const tx = api.tx.contracts.instantiate(
    0,
    simulation.gasRequired,
    null,
    prepared.code_hash,
    constructorInput,
    prepared.salt,
  );
  return {
    ...prepared,
    gas_required: simulation.gasRequired.toJSON(),
    storage_deposit: chargedDeposit(simulation.storageDeposit).toString(),
    estimated_fee: BigInt((await tx.paymentInfo(origin)).partialFee.toString()).toString(),
    tx,
    existing_dry_run_finalized_block: finalizedHash.toHex(),
  };
}

async function dryRunCall(api, at, origin, addressTo, artifact, messageName, params) {
  const candidates = artifact.abi.messages.filter(({ identifier }) => {
    const name = identifier.toString();
    return name === messageName || name.endsWith(`::${messageName}`);
  });
  if (candidates.length !== 1) {
    throw new Error(`${messageName} resolved to ${candidates.length} ABI messages in ${artifact.name}.`);
  }
  const [message] = candidates;
  const input = message.toU8a(params);
  const simulation = await at.call.contractsApi.call(origin, addressTo, 0, null, null, input);
  if (simulation.result.isErr) {
    throw new Error(`${messageName} dry-run failed: ${extractContractError(simulation.result.asErr, api)}.`);
  }
  const output = message.returnType
    ? artifact.abi.registry.createTypeUnsafe(message.returnType.lookupName || message.returnType.type, [simulation.result.asOk.data.toU8a(true)])
    : null;
  if (output?.isErr) throw new Error(`${messageName} returned ${output.asErr.toString()}.`);
  const tx = api.tx.contracts.call(addressTo, 0, simulation.gasRequired, null, input);
  const fee = BigInt((await tx.paymentInfo(origin)).partialFee.toString());
  return {
    messageName,
    input,
    tx,
    estimated_fee: fee,
    storage_deposit: chargedDeposit(simulation.storageDeposit),
    gas_required: simulation.gasRequired.toJSON(),
    output: output?.toHuman?.() ?? null,
  };
}

async function ensureBudget(api, origin, required) {
  const account = await api.query.system.account(origin);
  const free = BigInt(account.data.free.toString());
  const existential = BigInt(api.consts.balances?.existentialDeposit?.toString?.() ?? "0");
  if (free < required + existential) {
    throw new Error(`Insufficient free balance for this stage: need at least ${(required + existential).toString()} base units, have ${free.toString()}.`);
  }
  return { free: free.toString(), existential_deposit: existential.toString() };
}

async function submitContractCall(api, pair, contractAddress, call, report, key) {
  const nonce = await api.rpc.system.accountNextIndex(pair.address);
  const receipt = await submitAndFinalize(call.tx, pair, nonce, api);
  report.steps[key] = {
    status: "pass",
    contract_address: contractAddress,
    message: call.messageName,
    estimated_fee: call.estimated_fee.toString(),
    storage_deposit: call.storage_deposit.toString(),
    ...receipt,
  };
  await saveReport(report);
}

const report = {
  schema_version: 1,
  network: "portaldot-testnet",
  endpoint_host: new URL(endpoint).host,
  observed_at_utc: new Date().toISOString(),
  signer_address_from_environment: true,
  signer_account_sha256: signerAccountHash,
  private_signing_material_used: broadcast || previousReport?.private_signing_material_used === true,
  private_signing_material_recorded: false,
  plan_path: path.relative(root, planPath),
  plan_sha256: planHash,
  resumed_from_report: resume,
  broadcast_count: previousReport?.broadcast_count ?? 0,
  run_broadcast_count: 0,
  run_kind: broadcast ? "broadcast" : "preflight_only",
  status: "running",
  code_uploads: previousReport?.code_uploads ?? {},
  deployments: previousReport?.deployments ?? {},
  steps: previousReport?.steps ?? {},
};

let api;
let activeStep = "setup";
try {
  await cryptoWaitReady();
  let pair;
  if (mnemonic) {
    const keyring = new Keyring({ type: "sr25519", ss58Format: 42 });
    pair = keyring.addFromUri(mnemonic);
    if (pair.address !== address || !Buffer.from(decodeAddress(pair.address)).equals(accountBytes(address))) {
      throw new Error("The injected signing key does not derive PORTALDOT_TEST_ACCOUNT_ADDRESS.");
    }
    report.signer_address_matches_configured_account = true;
  } else {
    report.signer_address_matches_configured_account = null;
  }

  api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
  await api.isReady;
  if (!api.query.contracts?.contractInfoOf) throw new Error("The connected runtime metadata does not expose Contracts::ContractInfoOf.");
  const contractsApi = api.runtimeVersion.apis.toJSON().find(([id]) => id.toLowerCase() === apiId);
  if (contractsApi?.[1] !== expectedApiVersion) {
    throw new Error(`Expected ContractsApi v${expectedApiVersion}, found ${contractsApi?.[1] ?? "missing"}.`);
  }
  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(finalizedHash);
  const at = await api.at(finalizedHash);
  const metadata = await api.rpc.state.getMetadata(finalizedHash);
  const genesisHash = api.genesisHash.toHex();
  if (previousReport && previousReport.runtime?.genesis_hash !== genesisHash) {
    throw new Error("The connected chain genesis hash differs from the resume report.");
  }
  if (new URL(endpoint).host !== plan.endpoint_host) {
    throw new Error(`Endpoint host does not match the deployment plan: expected ${plan.endpoint_host}.`);
  }
  report.runtime = {
    spec_name: api.runtimeVersion.specName.toString(),
    spec_version: api.runtimeVersion.specVersion.toNumber(),
    transaction_version: api.runtimeVersion.transactionVersion.toNumber(),
    metadata_sha256: hex(sha256(Buffer.from(metadata.toHex().slice(2), "hex"))),
    contracts_api_version: contractsApi[1],
    genesis_hash: genesisHash,
  };
  report.observed_finalized_block = { number: header.number.toNumber(), hash: finalizedHash.toHex() };

  const tokenArtifact = await makeContractArtifact("intentflow_psp22_test_token", api);
  const poolArtifact = await makeContractArtifact("intentflow_amm_pool", api);
  const routerArtifact = await makeContractArtifact("intentflow_intent_router", api);
  const codeUploadSpecs = [
    ["token", tokenArtifact],
    ["pool", poolArtifact],
    ["intent_router", routerArtifact],
  ];
  const preparedCodeUploads = Object.fromEntries(
    await Promise.all(codeUploadSpecs.map(async ([key, artifact]) => [
      key,
      await preflightCodeUpload(api, at, address, artifact, previousReport?.code_uploads?.[key]),
    ])),
  );
  report.artifacts = Object.fromEntries([tokenArtifact, poolArtifact, routerArtifact].map((artifact) => [artifact.name, {
    code_hash: artifact.codeHash,
    wasm_bytes: artifact.wasm.length,
    wasm_sha256: hex(sha256(artifact.wasm)),
    bundle_sha256: artifact.bundleSha256,
    metadata_sha256: artifact.metadataHash,
  }]));
  const preflightAccountBalance = BigInt((await api.query.system.account(address)).data.free.toString());
  const depositPerByte = BigInt(api.consts.contracts?.depositPerByte?.toString?.() ?? "0");
  const uniqueArtifacts = [...new Map(
    [tokenArtifact, poolArtifact, routerArtifact].map((artifact) => [artifact.codeHash, artifact]),
  ).values()];
  const codeStorageDeposits = Object.fromEntries(
    codeUploadSpecs.map(([key, artifact]) => [artifact.codeHash, preparedCodeUploads[key].storage_deposit]),
  );
  const newCodeStorageDepositEstimate = Object.values(codeStorageDeposits)
    .reduce((sum, deposit) => sum + BigInt(deposit), 0n);
  report.fee_preflight = {
    account_free_balance: preflightAccountBalance.toString(),
    deposit_per_byte: depositPerByte.toString(),
    unique_code_bytes: uniqueArtifacts.reduce((sum, artifact) => sum + artifact.wasm.length, 0),
    new_code_storage_deposits: codeStorageDeposits,
    new_code_storage_deposit_estimate: newCodeStorageDepositEstimate.toString(),
    balance_after_new_code_storage_estimate: (preflightAccountBalance - newCodeStorageDepositEstimate).toString(),
    estimate_note: "Assumes each unique code hash must be stored; excludes contract state deposits and transaction fees.",
  };
  report.code_uploads = Object.fromEntries(codeUploadSpecs.map(([key, artifact]) => [key, {
    code_hash: artifact.codeHash,
    wasm_sha256: hex(sha256(artifact.wasm)),
    wasm_bytes: artifact.wasm.length,
    storage_deposit: preparedCodeUploads[key].storage_deposit,
    estimated_fee: preparedCodeUploads[key].estimated_fee,
    status: preparedCodeUploads[key].already_uploaded ? "pass" : "pending",
    already_uploaded: preparedCodeUploads[key].already_uploaded,
  }]));
  await saveReport(report);
  const deploymentSpecs = [
    ["token_a", tokenArtifact],
    ["token_b", tokenArtifact],
  ];
  const preparedDeployments = {};
  activeStep = "deploy_preflight";
  for (const [label, artifact] of deploymentSpecs) {
    const params = constructorArgs(label);
    const prepared = await preflightDeployment(api, at, address, artifact, label, params, genesisHash, previousReport?.deployments?.[label], preparedCodeUploads.token);
    preparedDeployments[label] = prepared;
    report.deployments[label] = {
      ...report.deployments[label],
      ...prepared,
      ...(prepared.already_deployed ? { status: "pass", contract_address: prepared.predicted_address, resumed_existing: true } : { status: "pending" }),
      tx: undefined,
      artifact: undefined,
    };
  }
  const tokenA = preparedDeployments.token_a.predicted_address;
  const tokenB = preparedDeployments.token_b.predicted_address;
  for (const label of ["pool_a", "pool_b"]) {
    const prepared = await preflightDeployment(
      api,
      at,
      address,
      poolArtifact,
      label,
      constructorArgs(label, tokenA, tokenB),
      genesisHash,
      previousReport?.deployments?.[label],
      preparedCodeUploads.pool,
    );
    preparedDeployments[label] = prepared;
    report.deployments[label] = {
      ...report.deployments[label],
      ...prepared,
      ...(prepared.already_deployed ? { status: "pass", contract_address: prepared.predicted_address, resumed_existing: true } : { status: "pending" }),
      tx: undefined,
      artifact: undefined,
    };
  }
  const router = await preflightDeployment(
    api,
    at,
    address,
    routerArtifact,
    "intent_router",
    [],
    genesisHash,
    previousReport?.deployments?.intent_router,
    preparedCodeUploads.intent_router,
  );
  preparedDeployments.intent_router = router;
  report.deployments.intent_router = {
    ...report.deployments.intent_router,
    ...router,
    ...(router.already_deployed ? { status: "pass", contract_address: router.predicted_address, resumed_existing: true } : { status: "pending" }),
    tx: undefined,
    artifact: undefined,
  };
  const codeUploadBudget = Object.values(preparedCodeUploads).reduce(
    (sum, item) => sum + BigInt(item.storage_deposit) + BigInt(item.estimated_fee),
    0n,
  );
  const instanceBudget = Object.values(preparedDeployments).reduce(
    (sum, item) => sum + BigInt(item.storage_deposit) + BigInt(item.estimated_fee),
    0n,
  );
  const deploymentBudget = codeUploadBudget + instanceBudget;
  const deploymentBalance = await ensureBudget(api, address, deploymentBudget);
  report.fee_preflight = {
    account_free_balance: (await api.query.system.account(address)).data.free.toString(),
    code_upload_storage_and_fee_estimate: codeUploadBudget.toString(),
    instance_storage_and_fee_estimate: instanceBudget.toString(),
    deployment_storage_and_fee_estimate: deploymentBudget.toString(),
    deployment_budget_check: "pass",
    ...deploymentBalance,
    initializers: "deferred_until_deployment_is_finalized",
  };
  await saveReport(report);

  if (!broadcast) {
    report.status = "preflight_pass_no_broadcast";
    report.completed_at_utc = new Date().toISOString();
    await saveReport(report);
    console.log(JSON.stringify(report, null, 2));
  } else {
    activeStep = "deployment_broadcast";
    for (const [key, artifact] of codeUploadSpecs) {
      const preparedUpload = preparedCodeUploads[key];
      if (preparedUpload.already_uploaded || report.code_uploads[key]?.status === "pass") continue;
      activeStep = `code_upload_${key}`;
      const receipt = await submitAndFinalize(
        preparedUpload.tx,
        pair,
        await api.rpc.system.accountNextIndex(pair.address),
        api,
      );
      const codeStored = receipt.events.find((event) => event.section === "contracts" && event.method === "CodeStored");
      if (!codeStored || codeStored.data.codeHash?.toLowerCase() !== artifact.codeHash.toLowerCase()) {
        throw new Error(`${key} finalized upload did not report the expected code hash.`);
      }
      report.code_uploads[key] = {
        ...report.code_uploads[key],
        status: "pass",
        contract_code_hash: artifact.codeHash,
        ...receipt,
      };
      await saveReport(report);
    }
    for (const [label, artifact] of deploymentSpecs) {
      let prepared = preparedDeployments[label];
      if (prepared.already_deployed) continue;
      prepared = await refreshExistingDeployment(api, address, prepared);
      preparedDeployments[label] = prepared;
      const nonce = await api.rpc.system.accountNextIndex(pair.address);
      const receipt = await submitAndFinalize(prepared.tx, pair, nonce, api);
      report.deployments[label] = { ...report.deployments[label], status: "finalized_unverified", ...receipt };
      await saveReport(report);
      const instantiated = receipt.events.find((event) => event.section === "contracts" && event.method === "Instantiated");
      if (!instantiated) throw new Error(`${label} finalized without Contracts::Instantiated.`);
      const contractAddress = instantiated.data.contract;
      if (contractAddress !== prepared.predicted_address) throw new Error(`${label} instantiated address differs from its dry-run prediction.`);
      const info = await api.query.contracts.contractInfoOf(contractAddress);
      if (info.isNone || info.unwrap().codeHash.toHex().toLowerCase() !== prepared.code_hash.toLowerCase()) {
        throw new Error(`${label} on-chain code hash does not match the reviewed Wasm.`);
      }
      report.deployments[label] = { ...report.deployments[label], status: "pass", contract_address: contractAddress, ...receipt };
      await saveReport(report);
    }
    for (const label of ["pool_a", "pool_b"]) {
      let prepared = preparedDeployments[label];
      if (prepared.already_deployed) continue;
      prepared = await refreshExistingDeployment(api, address, prepared);
      preparedDeployments[label] = prepared;
      const nonce = await api.rpc.system.accountNextIndex(pair.address);
      const receipt = await submitAndFinalize(prepared.tx, pair, nonce, api);
      report.deployments[label] = { ...report.deployments[label], status: "finalized_unverified", ...receipt };
      await saveReport(report);
      const instantiated = receipt.events.find((event) => event.section === "contracts" && event.method === "Instantiated");
      if (!instantiated) throw new Error(`${label} finalized without Contracts::Instantiated.`);
      const contractAddress = instantiated.data.contract;
      if (contractAddress !== prepared.predicted_address) throw new Error(`${label} instantiated address differs from its dry-run prediction.`);
      const info = await api.query.contracts.contractInfoOf(contractAddress);
      if (info.isNone || info.unwrap().codeHash.toHex().toLowerCase() !== prepared.code_hash.toLowerCase()) {
        throw new Error(`${label} on-chain code hash does not match the reviewed Wasm.`);
      }
      report.deployments[label] = { ...report.deployments[label], status: "pass", contract_address: contractAddress, ...receipt };
      await saveReport(report);
    }
    {
      let prepared = preparedDeployments.intent_router;
      if (!prepared.already_deployed) {
        prepared = await refreshExistingDeployment(api, address, prepared);
        preparedDeployments.intent_router = prepared;
        const nonce = await api.rpc.system.accountNextIndex(pair.address);
        const receipt = await submitAndFinalize(prepared.tx, pair, nonce, api);
        report.deployments.intent_router = { ...report.deployments.intent_router, status: "finalized_unverified", ...receipt };
        await saveReport(report);
        const instantiated = receipt.events.find((event) => event.section === "contracts" && event.method === "Instantiated");
        if (!instantiated) throw new Error("intent_router finalized without Contracts::Instantiated.");
        const contractAddress = instantiated.data.contract;
        if (contractAddress !== prepared.predicted_address) throw new Error("intent_router address differs from its dry-run prediction.");
        const info = await api.query.contracts.contractInfoOf(contractAddress);
        if (info.isNone || info.unwrap().codeHash.toHex().toLowerCase() !== prepared.code_hash.toLowerCase()) {
          throw new Error("intent_router on-chain code hash does not match the reviewed Wasm.");
        }
        report.deployments.intent_router = { ...report.deployments.intent_router, status: "pass", contract_address: contractAddress, ...receipt };
        await saveReport(report);
      }
    }

    const deployed = Object.fromEntries(Object.entries(report.deployments).map(([key, value]) => [key, value.contract_address]));
    const deploymentAt = await api.at(await api.rpc.chain.getFinalizedHead());
    activeStep = "router_policy_preflight";
    const routerCalls = [
      ["router_allow_pool_a", routerArtifact, deployed.intent_router, "set_pool_allowed", [deployed.pool_a, true]],
      ["router_allow_pool_b", routerArtifact, deployed.intent_router, "set_pool_allowed", [deployed.pool_b, true]],
      ["router_authorize_deployer", routerArtifact, deployed.intent_router, "set_solver_authorized", [address, true]],
    ];
    const routerPrepared = [];
    for (const [key, artifact, destination, method, params] of routerCalls) {
      if (report.steps[key]?.status === "pass") continue;
      routerPrepared.push({ key, destination, call: await dryRunCall(api, deploymentAt, address, destination, artifact, method, params) });
    }
    const routerBudget = routerPrepared.reduce((sum, item) => sum + item.call.estimated_fee + item.call.storage_deposit, 0n);
    report.fee_preflight.router_policy_and_solver = { budget: routerBudget.toString(), ...(await ensureBudget(api, address, routerBudget)) };
    await saveReport(report);
    for (const item of routerPrepared) {
      await submitContractCall(api, pair, item.destination, item.call, report, item.key);
    }

    const tokenContracts = {
      token_a: { address: deployed.token_a, artifact: tokenArtifact },
      token_b: { address: deployed.token_b, artifact: tokenArtifact },
    };
    const liquidityCalls = [];
    for (const poolLabel of ["pool_a", "pool_b"]) {
      const amounts = plan.liquidity[poolLabel];
      const tokenAAmount = parseAmount(amounts.token_a, `${poolLabel}.token_a`);
      const tokenBAmount = parseAmount(amounts.token_b, `${poolLabel}.token_b`);
      const [token0, token1] = sortedTokens(deployed.token_a, deployed.token_b);
      const amount0 = token0 === deployed.token_a ? tokenAAmount : tokenBAmount;
      const amount1 = token0 === deployed.token_a ? tokenBAmount : tokenAAmount;
      for (const [tokenLabel, amount] of [["token_a", token0 === deployed.token_a ? amount0 : amount1], ["token_b", token0 === deployed.token_b ? amount0 : amount1]]) {
        const key = `${poolLabel}_approve_${tokenLabel}`;
        if (report.steps[key]?.status === "pass") continue;
        const token = tokenContracts[tokenLabel];
        liquidityCalls.push({
          key,
          destination: token.address,
          call: await dryRunCall(api, deploymentAt, address, token.address, token.artifact, "approve", [deployed[poolLabel], amount]),
        });
      }
    }
    activeStep = "token_approval_preflight";
    const approvalBudget = liquidityCalls.reduce((sum, item) => sum + item.call.estimated_fee + item.call.storage_deposit, 0n);
    report.fee_preflight.token_approvals = { budget: approvalBudget.toString(), ...(await ensureBudget(api, address, approvalBudget)) };
    await saveReport(report);
    for (const item of liquidityCalls) {
      await submitContractCall(api, pair, item.destination, item.call, report, item.key);
    }

    activeStep = "liquidity_preflight";
    const liquidityAt = await api.at(await api.rpc.chain.getFinalizedHead());
    const poolCalls = [];
    for (const poolLabel of ["pool_a", "pool_b"]) {
      const key = `${poolLabel}_add_liquidity`;
      if (report.steps[key]?.status === "pass") continue;
      const amounts = plan.liquidity[poolLabel];
      const tokenAAmount = parseAmount(amounts.token_a, `${poolLabel}.token_a`);
      const tokenBAmount = parseAmount(amounts.token_b, `${poolLabel}.token_b`);
      const [token0] = sortedTokens(deployed.token_a, deployed.token_b);
      const amount0 = token0 === deployed.token_a ? tokenAAmount : tokenBAmount;
      const amount1 = token0 === deployed.token_a ? tokenBAmount : tokenAAmount;
      const poolCall = await dryRunCall(
        api,
        liquidityAt,
        address,
        deployed[poolLabel],
        poolArtifact,
        "add_liquidity",
        [amount0, amount1, 1n, BigInt(liquidityAt.query.system.number ? (await liquidityAt.query.system.number()).toString() : "0") + 20n],
      );
      poolCalls.push({ key, destination: deployed[poolLabel], call: poolCall });
    }
    const poolBudget = poolCalls.reduce((sum, item) => sum + item.call.estimated_fee + item.call.storage_deposit, 0n);
    report.fee_preflight.liquidity_seed = { budget: poolBudget.toString(), ...(await ensureBudget(api, address, poolBudget)) };
    await saveReport(report);
    for (const item of poolCalls) {
      await submitContractCall(api, pair, item.destination, item.call, report, item.key);
    }

    if (acceptanceSwap && report.steps.acceptance_swap?.status !== "pass") {
      activeStep = "acceptance_swap_approval";
      const swapAmount = parseAmount(plan.acceptance_swap.amount_in, "acceptance_swap.amount_in");
      if (report.steps.acceptance_swap_approval?.status !== "pass") {
        const approvalAt = await api.at(await api.rpc.chain.getFinalizedHead());
        const approval = await dryRunCall(api, approvalAt, address, deployed.token_a, tokenArtifact, "approve", [deployed.intent_router, swapAmount]);
        const approvalReceipt = await submitAndFinalize(approval.tx, pair, await api.rpc.system.accountNextIndex(pair.address), api);
        report.steps.acceptance_swap_approval = { status: "pass", contract_address: deployed.token_a, ...approvalReceipt };
        await saveReport(report);
      }

      activeStep = "acceptance_swap_preflight";
      const steps = [
        { pool_id: deployed.pool_a, asset_in: { Contract: deployed.token_a }, asset_out: { Contract: deployed.token_b } },
      ];
      let preparedSwap;
      for (let attempt = 0; attempt < 3 && !preparedSwap; attempt += 1) {
        const snapshotHeader = await api.rpc.chain.getHeader();
        const snapshotHash = snapshotHeader.hash;
        const snapshotNumber = snapshotHeader.number.toNumber();
        const deadline = BigInt(snapshotNumber) + BigInt(plan.acceptance_swap.deadline_blocks);
        const intentId = hex(sha256(Buffer.concat([Buffer.from("intentflow-p2-acceptance-v1\0"), Buffer.from(genesisHash.slice(2), "hex"), Buffer.from(snapshotHash.toHex().slice(2), "hex")])));
        const intent = {
          intent_id: intentId,
          owner: address,
          asset_in: { Contract: deployed.token_a },
          asset_out: { Contract: deployed.token_b },
          amount_in: swapAmount,
          amount_out_min: parseAmount(plan.acceptance_swap.amount_out_min, "acceptance_swap.amount_out_min"),
          max_fee: parseAmount(plan.acceptance_swap.max_fee, "acceptance_swap.max_fee"),
          deadline,
        };
        const routeHash = routeHashFor(plan.network, snapshotNumber, snapshotHash.toHex(), steps);
        const commitment = commitmentFor(intent, routeHash);
        const executeCall = await dryRunCall(
          api,
          await api.at(snapshotHash),
          address,
          deployed.intent_router,
          routerArtifact,
          "execute",
          [intent, steps, BigInt(snapshotNumber), snapshotHash.toHex(), hex(commitment)],
        );
        const freshHead = await api.rpc.chain.getHeader();
        if (freshHead.hash.toHex() !== snapshotHash.toHex()) continue;
        preparedSwap = { intent, routeHash, commitment, executeCall, snapshotNumber, snapshotHash };
      }
      if (!preparedSwap) {
        throw new Error("The best-chain snapshot advanced during acceptance swap preflight; retry the broadcast.");
      }
      const { intent, routeHash, commitment, executeCall, snapshotNumber, snapshotHash } = preparedSwap;
      const receipt = await submitAndFinalize(executeCall.tx, pair, await api.rpc.system.accountNextIndex(pair.address), api);
      report.steps.acceptance_swap = {
        status: "pass",
        intent_id: intent.intent_id,
        route_hash: hex(routeHash),
        commitment_hash: hex(commitment),
        snapshot_block_number: snapshotNumber,
        snapshot_block_hash: snapshotHash.toHex(),
        quote: executeCall.output,
        ...receipt,
      };
      await saveReport(report);
    }

    const finalHead = await api.rpc.chain.getFinalizedHead();
    const finalHeader = await api.rpc.chain.getHeader(finalHead);
    report.observed_finalized_block = {
      number: finalHeader.number.toNumber(),
      hash: finalHead.toHex(),
    };
    report.status = acceptanceSwap ? "pass_deployed_seeded_and_swap_confirmed" : "pass_deployed_and_seeded";
    report.completed_at_utc = new Date().toISOString();
    await saveReport(report);
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  report.status = broadcast && report.broadcast_count > 0 ? "partial_broadcast" : "failed_or_blocked";
  report.failure = {
    stage: activeStep,
    message: redactSigner(error instanceof Error ? error.message : String(error)),
  };
  report.completed_at_utc = new Date().toISOString();
  await saveReport(report);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await api?.disconnect();
}

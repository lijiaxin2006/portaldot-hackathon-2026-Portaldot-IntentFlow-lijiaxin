import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { blake2AsU8a, cryptoWaitReady, decodeAddress } from "@polkadot/util-crypto";

const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
const address = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const mnemonic = process.env.PORTALDOT_TEST_ACCOUNT_MNEMONIC;
const wasmPath = process.argv[2] ?? "contracts/p0-probe/target/wasm32-unknown-unknown/release/portaldot_p0_probe.deployable.wasm";
const outputPath = process.argv[3] ?? "evidence/p0/lifecycle-run.json";
const tokenDecimals = 14;
const contractsApiId = "0x68b66ba122c93fa7";
const expectedContractsApiVersion = 2;
const expectedCodeHash = "0x07211a71bb0ea630a8d3e1171493c1c0348692487a19995db28a10602a01d085";
const resumeContractAddress = process.env.PORTALDOT_P0_RESUME_CONTRACT_ADDRESS;
const resumeReportPath = process.env.PORTALDOT_P0_RESUME_REPORT_PATH ?? outputPath;

if (!endpoint || !address || !mnemonic) {
  throw new Error("Set PORTALDOT_TESTNET_WS_URL, PORTALDOT_TEST_ACCOUNT_ADDRESS, and PORTALDOT_TEST_ACCOUNT_MNEMONIC in the environment.");
}

const report = {
  schema_version: 1,
  network: "portaldot-testnet",
  endpoint_id: new URL(endpoint).host,
  observed_at_utc: new Date().toISOString(),
  origin_address: null,
  account_address_injected_via_environment: true,
  origin_source: "PORTALDOT_TEST_ACCOUNT_ADDRESS environment variable",
  private_signing_material_used: true,
  private_signing_material_recorded: false,
  wasm_path: path.relative(process.cwd(), wasmPath),
  broadcast_count: 0,
  run_broadcast_count: 0,
  run_kind: "initial_lifecycle",
  status: "running",
  steps: {},
};
const previousReport = resumeContractAddress
  ? JSON.parse(await readFile(path.resolve(resumeReportPath), "utf8"))
  : null;
if (previousReport) {
  report.run_kind = previousReport.status === "pass_single_lifecycle"
    ? "repeat_existing_contract"
    : "resume_pending_step";
  report.source_report_path = path.relative(process.cwd(), resumeReportPath);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hexToBytes = (hex) => Buffer.from(hex.startsWith("0x") ? hex.slice(2) : hex, "hex");
const toBigInt = (value) => BigInt(value.toString());
const toToken = (value) => {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const unit = 10n ** BigInt(tokenDecimals);
  return `${amount / unit}.${(amount % unit).toString().padStart(tokenDecimals, "0")}`;
};

function redactOrigin(value) {
  if (typeof value === "string") return value === address ? "[test-account]" : value;
  if (Array.isArray(value)) return value.map(redactOrigin);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactOrigin(item)]));
  }
  return value;
}

function selectorFor(message) {
  return `0x${Buffer.from(blake2AsU8a(message, 256).subarray(0, 4)).toString("hex")}`;
}

function compactLength(length) {
  if (length < 64) return Buffer.from([length << 2]);
  if (length < 16_384) {
    const encoded = (length << 2) | 1;
    return Buffer.from([encoded & 0xff, (encoded >> 8) & 0xff]);
  }
  if (length < 1_073_741_824) {
    const encoded = Number((BigInt(length) << 2n) | 2n);
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(encoded);
    return bytes;
  }
  throw new Error("SCALE vector exceeds the supported compact encoding.");
}

function encodeBytes(bytes) {
  return Buffer.concat([compactLength(bytes.length), bytes]);
}

function chargedDeposit(storageDeposit) {
  return storageDeposit.isCharge ? toBigInt(storageDeposit.asCharge) : 0n;
}

function encodeInstantiateRuntimeInput(accountId, codeHash, constructorInput, salt) {
  return Buffer.concat([
    accountId,
    Buffer.alloc(16),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from([1]),
    hexToBytes(codeHash),
    encodeBytes(hexToBytes(constructorInput)),
    encodeBytes(hexToBytes(salt)),
  ]);
}

function eventsForReport(records, api) {
  return records.map(({ event, phase }) => {
    const raw = event.data.toU8a();
    let dispatchError;
    if (event.section === "system" && event.method === "ExtrinsicFailed") {
      const error = event.data[0];
      if (error.isModule) {
        const decoded = api.registry.findMetaError(error.asModule);
        dispatchError = `${decoded.section}.${decoded.name}`;
      } else {
        dispatchError = error.toString();
      }
    }
    return {
      phase: phase.isApplyExtrinsic ? phase.asApplyExtrinsic.toNumber() : phase.type,
      section: event.section,
      method: event.method,
      data: redactOrigin(event.data.toHuman()),
      data_sha256: sha256(Buffer.from(raw)),
      ...(dispatchError ? { dispatch_error: dispatchError } : {}),
    };
  });
}

function dispatchErrorName(dispatchError, api) {
  if (!dispatchError) return null;
  if (dispatchError.isModule) {
    const decoded = api.registry.findMetaError(dispatchError.asModule);
    return `${decoded.section}.${decoded.name}`;
  }
  return dispatchError.toString();
}

function submitAndFinalize(tx, pair, nonce, api) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for finalized transaction.")), 180_000);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
      if (error) reject(error);
      else resolve(value);
    };

    tx.signAndSend(pair, { nonce }, (result) => {
      const events = eventsForReport(result.events, api);
      if (result.status.isInvalid || result.status.isDropped || result.status.isUsurped || result.status.isFinalityTimeout) {
        finish(new Error(`Transaction did not finalize: ${result.status.type}.`));
        return;
      }
      if (result.dispatchError) {
        finish(new Error(`Transaction dispatch failed: ${dispatchErrorName(result.dispatchError, api)}.`));
        return;
      }
      if (events.some((event) => event.dispatch_error)) {
        finish(new Error(`Transaction finalized with ${events.find((event) => event.dispatch_error).dispatch_error}.`));
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

let api;
let activeStep = "setup";
let nextNonce;

async function saveReport() {
  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function run() {
  const wasm = await readFile(wasmPath);
  const wasmHex = `0x${wasm.toString("hex")}`;
  if (wasm.length !== 5000 || sha256(wasm) !== "2eb12ff2ca18063619943f96934fc7d6b40e03a8364a06795c6bb0d49e696271") {
    throw new Error("The local probe Wasm does not match the reviewed P0 artifact.");
  }
  report.probe = {
    wasm_bytes: wasm.length,
    wasm_sha256: sha256(wasm),
    expected_code_hash: expectedCodeHash,
    constructor_selector: selectorFor("new"),
    get_sequence_selector: selectorFor("get_sequence"),
    ping_selector: selectorFor("ping"),
    salt: previousReport?.probe?.salt ?? `0x${randomBytes(8).toString("hex")}`,
  };
  if (report.probe.constructor_selector !== "0x9bae9d5e") {
    throw new Error("The SDK-derived ink! constructor selector did not match the reviewed selector.");
  }

  await cryptoWaitReady();
  const keyring = new Keyring({ type: "sr25519", ss58Format: 42 });
  const pair = keyring.addFromUri(mnemonic);
  if (pair.address !== address || !Buffer.from(decodeAddress(pair.address)).equals(Buffer.from(decodeAddress(address)))) {
    throw new Error("The injected signing key does not derive the configured test account address.");
  }
  report.signer_address_matches_configured_account = true;

  api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
  await api.isReady;
  if (!api.query.contracts.contractInfoOf) throw new Error("The runtime metadata does not expose Contracts::ContractInfoOf.");

  const finalizedHash = await api.rpc.chain.getFinalizedHead();
  const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
  const at = await api.at(finalizedHash);
  const metadata = await api.rpc.state.getMetadata(finalizedHash);
  const contractsApi = api.runtimeVersion.apis.toJSON().find(([id]) => id.toLowerCase() === contractsApiId);
  const apiVersion = contractsApi?.[1] ?? null;
  if (apiVersion !== expectedContractsApiVersion) {
    throw new Error(`Expected ContractsApi v${expectedContractsApiVersion}, found ${apiVersion}.`);
  }

  report.initial_finalized_block = {
    number: finalizedHeader.number.toNumber(),
    hash: finalizedHash.toHex(),
  };
  report.runtime = {
    spec_name: api.runtimeVersion.specName.toString(),
    spec_version: api.runtimeVersion.specVersion.toNumber(),
    transaction_version: api.runtimeVersion.transactionVersion.toNumber(),
    metadata_version: Number(api.runtimeMetadata.version),
    metadata_sha256: sha256(Buffer.from(metadata.toHex().slice(2), "hex")),
    contracts_api_version: apiVersion,
  };

  const account = await api.query.system.account(address);
  let freeBalance = toBigInt(account.data.free);
  const uploadDryRun = await at.call.contractsApi.uploadCode(address, wasmHex, null, "Enforced");
  if (uploadDryRun.isErr) throw new Error(`Upload dry-run failed: ${dispatchErrorName(uploadDryRun.asErr, api)}.`);
  const codeHash = uploadDryRun.asOk.codeHash.toHex();
  const uploadDeposit = toBigInt(uploadDryRun.asOk.deposit);
  if (codeHash.toLowerCase() !== expectedCodeHash.toLowerCase()) throw new Error("Upload dry-run returned an unexpected code hash.");

  const constructorInput = `0x${Buffer.concat([hexToBytes(report.probe.constructor_selector)]).toString("hex")}`;
  const uploadTx = api.tx.contracts.uploadCode(wasmHex, null, "Enforced");
  const uploadFee = toBigInt((await uploadTx.paymentInfo(pair.address)).partialFee);
  let combinedInstantiateDryRun;
  if (resumeContractAddress) {
    if (previousReport.steps?.upload?.status !== "pass" || previousReport.steps?.instantiate?.status !== "pass") {
      throw new Error("The previous lifecycle report has no finalized upload and instantiate evidence to resume.");
    }
    if (previousReport.steps.instantiate.contract_address !== resumeContractAddress) {
      throw new Error("The resume address does not match the finalized address in the prior lifecycle report.");
    }
    if (uploadDeposit !== 0n) throw new Error("The resumed probe code is not present on chain yet.");
    if (freeBalance < uploadFee) throw new Error("The account balance does not cover the remaining upload fee preflight.");
    report.fee_preflight = {
      account_free_balance: freeBalance.toString(),
      account_free_balance_token: toToken(freeBalance),
      upload_code_storage_deposit: uploadDeposit.toString(),
      upload_extrinsic_partial_fee: uploadFee.toString(),
      budget_check: "pass_for_resumed_contract_call",
    };
  } else {
    combinedInstantiateDryRun = await at.call.contractsApi.instantiate(
      address,
      0,
      null,
      null,
      { Upload: wasmHex },
      constructorInput,
      report.probe.salt,
    );
    if (combinedInstantiateDryRun.result.isErr) {
      throw new Error(`Combined instantiate dry-run failed: ${dispatchErrorName(combinedInstantiateDryRun.result.asErr, api)}.`);
    }
    const combinedDeposit = chargedDeposit(combinedInstantiateDryRun.storageDeposit);
    const combinedFee = toBigInt((await api.tx.contracts.instantiateWithCode(
      0,
      combinedInstantiateDryRun.gasRequired,
      null,
      wasmHex,
      constructorInput,
      report.probe.salt,
    ).paymentInfo(pair.address)).partialFee);

    if (freeBalance < combinedDeposit + uploadFee + combinedFee) {
      throw new Error("The account balance does not cover the instantiate preflight plus upload and instantiate fees.");
    }
    report.fee_preflight = {
      account_free_balance: freeBalance.toString(),
      account_free_balance_token: toToken(freeBalance),
      upload_code_storage_deposit: uploadDeposit.toString(),
      upload_code_storage_deposit_token: toToken(uploadDeposit),
      combined_instantiate_storage_deposit: combinedDeposit.toString(),
      combined_instantiate_storage_deposit_token: toToken(combinedDeposit),
      upload_extrinsic_partial_fee: uploadFee.toString(),
      upload_extrinsic_partial_fee_token: toToken(uploadFee),
      instantiate_with_code_partial_fee: combinedFee.toString(),
      instantiate_with_code_partial_fee_token: toToken(combinedFee),
      estimated_remaining_after_combined_deposit_and_fees: (freeBalance - combinedDeposit - uploadFee - combinedFee).toString(),
      budget_check: "pass",
    };
  }
  report.steps.upload_dry_run = {
    status: "pass",
    code_hash: codeHash,
    deposit: uploadDeposit.toString(),
    finalized_block: report.initial_finalized_block,
  };
  report.steps.instantiate_with_code_dry_run = resumeContractAddress
    ? {
        status: "reused_finalized_instance",
        contract_address: resumeContractAddress,
      }
    : {
        status: "pass",
        predicted_contract_address: combinedInstantiateDryRun.result.asOk.accountId.toString(),
        gas_required: combinedInstantiateDryRun.gasRequired.toJSON(),
        storage_deposit: chargedDeposit(combinedInstantiateDryRun.storageDeposit).toString(),
        finalized_block: report.initial_finalized_block,
      };
  await saveReport();

  if (process.env.PORTALDOT_P0_PREFLIGHT_ONLY === "1") {
    report.status = "preflight_pass_no_broadcast";
    report.preflight_only = true;
    return;
  }

  let contractAddress;
  if (resumeContractAddress) {
    const resumeInfo = await api.query.contracts.contractInfoOf(resumeContractAddress);
    if (resumeInfo.isNone || resumeInfo.unwrap().codeHash.toHex().toLowerCase() !== expectedCodeHash.toLowerCase()) {
      throw new Error("The resume address is not a finalized instance of the expected P0 probe code.");
    }
    contractAddress = resumeContractAddress;
    report.steps.upload = previousReport.steps.upload;
    report.steps.instantiate = previousReport.steps.instantiate;
    report.steps.instantiate_dry_run = previousReport.steps.instantiate_dry_run;
    report.broadcast_count = previousReport.broadcast_count;
    report.resumed_from_previous_report = true;
    report.resumed_contract_address = resumeContractAddress;
    report.repeated_run_uses_existing_instance = report.run_kind === "repeat_existing_contract";
  } else {
    activeStep = "upload";
    const nonceBeforeUpload = await api.rpc.system.accountNextIndex(pair.address);
    const uploadReceipt = await submitAndFinalize(uploadTx, pair, nonceBeforeUpload, api);
    report.broadcast_count += 1;
    report.run_broadcast_count += 1;
    const codeStored = uploadReceipt.events.find((event) => event.section === "contracts" && event.method === "CodeStored");
    if (!codeStored) throw new Error("Finalized upload transaction did not emit Contracts::CodeStored.");
    uploadReceipt.code_stored_event = codeStored.data;
    const storedCodeHash = codeStored.data.codeHash?.toString?.();
    if (!storedCodeHash || storedCodeHash.toLowerCase() !== expectedCodeHash.toLowerCase()) {
      throw new Error("Finalized CodeStored event did not report the expected code hash.");
    }
    report.steps.upload = { status: "pass", ...uploadReceipt };
    await saveReport();

    activeStep = "instantiate_preflight";
    const uploadBlockHash = uploadReceipt.finalized_block_hash;
    const uploadedAt = await api.at(uploadBlockHash);
    const accountAfterUpload = await api.query.system.account(address);
    freeBalance = toBigInt(accountAfterUpload.data.free);
    const instantiateDryRun = await uploadedAt.call.contractsApi.instantiate(
      address,
      0,
      null,
      null,
      { Existing: codeHash },
      constructorInput,
      report.probe.salt,
    );
    if (instantiateDryRun.result.isErr) {
      throw new Error(`Instantiate dry-run failed: ${dispatchErrorName(instantiateDryRun.result.asErr, api)}.`);
    }
    const predictedAddress = instantiateDryRun.result.asOk.accountId.toString();
    const instantiateDeposit = chargedDeposit(instantiateDryRun.storageDeposit);
    if (freeBalance < instantiateDeposit) throw new Error("Free balance after upload does not cover the instantiate storage deposit.");
    const instantiateTx = api.tx.contracts.instantiate(
      0,
      instantiateDryRun.gasRequired,
      null,
      codeHash,
      constructorInput,
      report.probe.salt,
    );
    const instantiateFee = toBigInt((await instantiateTx.paymentInfo(pair.address)).partialFee);
    if (freeBalance < instantiateDeposit + instantiateFee) throw new Error("Free balance after upload does not cover instantiate deposit and fee.");
    const runtimeInput = encodeInstantiateRuntimeInput(
      Buffer.from(decodeAddress(address)),
      codeHash,
      constructorInput,
      report.probe.salt,
    );
    report.steps.instantiate_dry_run = {
      status: "pass",
      code_hash: codeHash,
      predicted_contract_address: predictedAddress,
      gas_required: instantiateDryRun.gasRequired.toJSON(),
      storage_deposit: instantiateDeposit.toString(),
      storage_deposit_token: toToken(instantiateDeposit),
      runtime_api_input_bytes: runtimeInput.length,
      runtime_api_input_sha256: sha256(runtimeInput),
      extrinsic_call_input_sha256: sha256(Buffer.from(instantiateTx.method.toU8a())),
      constructor_input: constructorInput,
      finalized_block_hash: uploadBlockHash,
    };
    await saveReport();

    activeStep = "instantiate";
    const nonceBeforeInstantiate = await api.rpc.system.accountNextIndex(pair.address);
    const instantiateReceipt = await submitAndFinalize(instantiateTx, pair, nonceBeforeInstantiate, api);
    report.broadcast_count += 1;
    report.run_broadcast_count += 1;
    const instantiated = instantiateReceipt.events.find((event) => event.section === "contracts" && event.method === "Instantiated");
    if (!instantiated) throw new Error("Finalized instantiate transaction did not emit Contracts::Instantiated.");
    const eventContractAddress = instantiated.data.contract?.toString?.();
    if (eventContractAddress !== predictedAddress) {
      throw new Error("Instantiated event address did not match the dry-run prediction.");
    }
    instantiateReceipt.contract_address = eventContractAddress;
    instantiateReceipt.instantiated_event = instantiated.data;
    report.steps.instantiate = { status: "pass", ...instantiateReceipt };
    contractAddress = eventContractAddress;
    await saveReport();
  }

  activeStep = "contract_read";
  const contractInfo = await api.query.contracts.contractInfoOf(contractAddress);
  if (contractInfo.isNone) throw new Error("Contracts::ContractInfoOf returned no deployed contract at the finalized address.");
  const info = contractInfo.unwrap();
  if (info.codeHash && info.codeHash.toHex().toLowerCase() !== expectedCodeHash.toLowerCase()) {
    throw new Error("On-chain contract info returned an unexpected code hash.");
  }
  const contractBlockHash = report.steps.instantiate.finalized_block_hash;
  const contractState = await api.at(contractBlockHash);
  const getSequenceInput = report.probe.get_sequence_selector;
  const getSequenceDryRun = await contractState.call.contractsApi.call(
    address,
    contractAddress,
    0,
    null,
    null,
    getSequenceInput,
  );
  if (getSequenceDryRun.result.isErr) throw new Error(`get_sequence dry-run failed: ${dispatchErrorName(getSequenceDryRun.result.asErr, api)}.`);
  const sequence = getSequenceDryRun.result.asOk.data.toHex();
  if (sequence.toLowerCase() !== "0x0000000000") throw new Error(`get_sequence returned unexpected bytes ${sequence}.`);
  const getSequenceRepeat = await contractState.call.contractsApi.call(
    address,
    contractAddress,
    0,
    null,
    null,
    getSequenceInput,
  );
  if (getSequenceRepeat.result.isErr || getSequenceRepeat.result.asOk.data.toHex() !== sequence) {
    throw new Error("Repeated get_sequence dry-run at the same finalized block was not deterministic.");
  }
  report.steps.contract_read = {
    status: "pass",
    contract_address: contractAddress,
    code_hash: info.codeHash?.toHex?.() ?? expectedCodeHash,
    message_selector: getSequenceInput,
    returned_data: sequence,
    gas_required: getSequenceDryRun.gasRequired.toJSON(),
    result_sha256: sha256(Buffer.from(getSequenceDryRun.toHex().slice(2), "hex")),
    repeated_at_same_block: true,
    repeated_result_matches: true,
    finalized_block_hash: contractBlockHash,
  };
  await saveReport();

  activeStep = "ping_preflight";
  const pingInput = report.probe.ping_selector;
  const pingDryRun = await contractState.call.contractsApi.call(
    address,
    contractAddress,
    0,
    null,
    null,
    pingInput,
  );
  if (pingDryRun.result.isErr) throw new Error(`ping dry-run failed: ${dispatchErrorName(pingDryRun.result.asErr, api)}.`);
  if (pingDryRun.result.asOk.data.toHex().toLowerCase() !== "0x0000000000") {
    throw new Error("ping dry-run returned an unexpected result.");
  }
  const pingTx = api.tx.contracts.call(
    contractAddress,
    0,
    pingDryRun.gasRequired,
    null,
    pingInput,
  );
  const pingFee = toBigInt((await pingTx.paymentInfo(pair.address)).partialFee);
  const accountBeforePing = await api.query.system.account(address);
  freeBalance = toBigInt(accountBeforePing.data.free);
  if (freeBalance < pingFee) throw new Error("Free balance does not cover the probe call fee.");
  report.steps.ping_dry_run = {
    status: "pass",
    contract_address: contractAddress,
    message_selector: pingInput,
    returned_data: pingDryRun.result.asOk.data.toHex(),
    gas_required: pingDryRun.gasRequired.toJSON(),
    extrinsic_call_input_sha256: sha256(Buffer.from(pingTx.method.toU8a())),
  };
  await saveReport();

  activeStep = "ping";
  const nonceBeforePing = await api.rpc.system.accountNextIndex(pair.address);
  const pingReceipt = await submitAndFinalize(pingTx, pair, nonceBeforePing, api);
  report.broadcast_count += 1;
  report.run_broadcast_count += 1;
  const emitted = pingReceipt.events.find((event) => event.section === "contracts" && event.method === "ContractEmitted");
  const called = pingReceipt.events.find((event) => event.section === "contracts" && event.method === "Called");
  if (!emitted || !called) throw new Error("Finalized ping transaction is missing Contracts::ContractEmitted or Contracts::Called.");
  pingReceipt.contract_emitted_event = emitted.data;
  pingReceipt.called_event = called.data;
  report.steps.ping = { status: "pass", ...pingReceipt };
  report.status = report.run_kind === "repeat_existing_contract"
    ? "pass_repeat_existing_contract"
    : "pass_single_lifecycle";
  report.completed_at_utc = new Date().toISOString();
}

try {
  await run();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "incomplete";
  report.failure = {
    stage: activeStep,
    message: error instanceof Error ? error.message : String(error),
  };
  console.error(`P0 lifecycle stopped at ${activeStep}: ${report.failure.message}`);
  process.exitCode = 1;
} finally {
  if (api) await api.disconnect();
  await saveReport();
}

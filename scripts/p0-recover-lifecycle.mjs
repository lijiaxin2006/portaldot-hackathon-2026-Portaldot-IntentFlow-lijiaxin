import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiPromise, WsProvider } from "@polkadot/api";

const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
const origin = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const contractAddress = process.argv[2];
const reportPath = process.argv[3] ?? "evidence/p0/lifecycle-run.json";
const wasmPath = process.argv[4] ?? "contracts/p0-probe/target/wasm32-unknown-unknown/release/portaldot_p0_probe.deployable.wasm";
const uploadPreflightHash = "0x7da614c419134543d5d76c37204063a8d1ee9a28b8a5c33f4cde1b7640c93234";
const uploadTxHash = "0xbcd0ac58f872132a4f6970fdc01fb814ac6070711fd72dcb0c4e3f735d917475";
const uploadBlockHash = "0xf966bd05d12d437668e1c0ebad782d1c28bf79d8da106e4c86432745ebee20f0";
const instantiateTxHash = "0xa5021f157378162c3a4b3e79b56e0715358c88853f8b7da0d574b6abbb53c085";
const instantiateBlockHash = "0x39777f55518f92249f177de66190497b0bf7a33b5768cd35444784c4a0acab1b";
const expectedCodeHash = "0x07211a71bb0ea630a8d3e1171493c1c0348692487a19995db28a10602a01d085";

if (!endpoint || !origin || !contractAddress) {
  throw new Error("Set PORTALDOT_TESTNET_WS_URL, PORTALDOT_TEST_ACCOUNT_ADDRESS, and pass the deployed contract address.");
}

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportFile = path.resolve(reportPath);
const wasm = await readFile(wasmPath);
const oldReport = JSON.parse(await readFile(reportFile, "utf8"));
const salt = oldReport.probe.salt;
let api;

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
      data_sha256: hash(Buffer.from(raw)),
      ...(dispatchError ? { dispatch_error: dispatchError } : {}),
    };
  });
}

function redactOrigin(value) {
  if (typeof value === "string") return value === origin ? "[test-account]" : value;
  if (Array.isArray(value)) return value.map(redactOrigin);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactOrigin(item)]));
  }
  return value;
}

async function receiptFor(txHash, blockHash, api) {
  const [block, header, historical] = await Promise.all([
    api.rpc.chain.getBlock(blockHash),
    api.rpc.chain.getHeader(blockHash),
    api.at(blockHash),
  ]);
  const extrinsicIndex = block.block.extrinsics.findIndex((extrinsic) => extrinsic.hash.toHex().toLowerCase() === txHash.toLowerCase());
  if (extrinsicIndex < 0) throw new Error(`Transaction ${txHash} is missing from finalized block ${blockHash}.`);
  const allEvents = await historical.query.system.events();
  const records = allEvents.filter((record) => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === extrinsicIndex);
  const events = eventsForReport(records, api);
  if (!events.some((event) => event.section === "system" && event.method === "ExtrinsicSuccess")) {
    const failure = events.find((event) => event.dispatch_error);
    throw new Error(`Finalized transaction did not succeed${failure ? `: ${failure.dispatch_error}` : ""}.`);
  }
  return {
    transaction_hash: txHash,
    finalized_block_hash: blockHash,
    finalized_block_number: header.number.toNumber(),
    extrinsic_index: extrinsicIndex,
    events,
    fee_paid: records
      .find((record) => record.event.section === "transactionPayment" && record.event.method === "TransactionFeePaid")
      ?.event.data[1]?.toString() ?? null,
  };
}

try {
  api = await ApiPromise.create({ provider: new WsProvider(endpoint) });
  await api.isReady;
  const uploadPreflight = await api.at(uploadPreflightHash);
  const uploadDryRun = await uploadPreflight.call.contractsApi.uploadCode(origin, `0x${wasm.toString("hex")}`, null, "Enforced");
  if (uploadDryRun.isErr || uploadDryRun.asOk.codeHash.toHex().toLowerCase() !== expectedCodeHash.toLowerCase()) {
    throw new Error("Historical upload dry-run could not be recovered from the pre-upload finalized block.");
  }
  const combinedDryRun = await uploadPreflight.call.contractsApi.instantiate(
    origin,
    0,
    null,
    null,
    { Upload: `0x${wasm.toString("hex")}` },
    "0x9bae9d5e",
    salt,
  );
  if (combinedDryRun.result.isErr || combinedDryRun.result.asOk.accountId.toString() !== contractAddress) {
    throw new Error("Historical instantiate-with-code dry-run did not reproduce the supplied contract address.");
  }

  const [uploadReceipt, instantiateReceipt, initialHeader, initialMetadata, initialRuntime] = await Promise.all([
    receiptFor(uploadTxHash, uploadBlockHash, api),
    receiptFor(instantiateTxHash, instantiateBlockHash, api),
    api.rpc.chain.getHeader(uploadPreflightHash),
    api.rpc.state.getMetadata(uploadPreflightHash),
    api.rpc.state.getRuntimeVersion(uploadPreflightHash),
  ]);
  const codeStored = uploadReceipt.events.find((event) => event.section === "contracts" && event.method === "CodeStored");
  const instantiated = instantiateReceipt.events.find((event) => event.section === "contracts" && event.method === "Instantiated");
  if (!codeStored || codeStored.data.codeHash?.toLowerCase() !== expectedCodeHash.toLowerCase()) {
    throw new Error("The finalized upload receipt does not include the expected CodeStored event.");
  }
  if (!instantiated || instantiated.data.contract !== contractAddress) {
    throw new Error("The finalized instantiate receipt does not include the expected Instantiated event.");
  }

  const uploadBlock = await api.at(uploadBlockHash);
  const instantiateDryRun = await uploadBlock.call.contractsApi.instantiate(
    origin,
    0,
    null,
    null,
    { Existing: expectedCodeHash },
    "0x9bae9d5e",
    salt,
  );
  if (instantiateDryRun.result.isErr || instantiateDryRun.result.asOk.accountId.toString() !== contractAddress) {
    throw new Error("The post-upload instantiate dry-run did not reproduce the finalized contract address.");
  }
  const contractInfo = await (await api.at(instantiateBlockHash)).query.contracts.contractInfoOf(contractAddress);
  if (contractInfo.isNone || contractInfo.unwrap().codeHash.toHex().toLowerCase() !== expectedCodeHash.toLowerCase()) {
    throw new Error("The finalized contract storage does not contain the expected code hash.");
  }

  const uploadFinalized = {
    status: "pass",
    ...uploadReceipt,
    code_stored_event: codeStored.data,
    recovered_from_finalized_block: true,
  };
  const instantiateFinalized = {
    status: "pass",
    ...instantiateReceipt,
    contract_address: contractAddress,
    instantiated_event: instantiated.data,
    recovered_from_finalized_block: true,
  };

  const recovered = {
    ...oldReport,
    origin_address: null,
    account_address_injected_via_environment: true,
    observed_at_utc: new Date().toISOString(),
    status: "incomplete_pending_contract_call",
    broadcast_count: 2,
    failure: null,
    initial_finalized_block: {
      number: initialHeader.number.toNumber(),
      hash: uploadPreflightHash,
    },
    runtime: {
      spec_name: initialRuntime.specName.toString(),
      spec_version: initialRuntime.specVersion.toNumber(),
      transaction_version: initialRuntime.transactionVersion.toNumber(),
      metadata_version: Number(api.runtimeMetadata.version),
      metadata_sha256: hash(Buffer.from(initialMetadata.toHex().slice(2), "hex")),
      contracts_api_version: 2,
    },
    fee_preflight: {
      account_free_balance_before_first_tx: "49700000000000000",
      upload_deposit: uploadDryRun.asOk.deposit.toString(),
      instantiate_with_code_deposit: combinedDryRun.storageDeposit.asCharge.toString(),
      budget_check: "pass",
    },
    probe: {
      ...oldReport.probe,
      code_hash: expectedCodeHash,
      contract_address: contractAddress,
    },
    resumed_from_chain_receipts: true,
    steps: {
      upload_dry_run: {
        status: "pass",
        code_hash: uploadDryRun.asOk.codeHash.toHex(),
        deposit: uploadDryRun.asOk.deposit.toString(),
        finalized_block: { number: initialHeader.number.toNumber(), hash: uploadPreflightHash },
      },
      instantiate_with_code_dry_run: {
        status: "pass",
        predicted_contract_address: combinedDryRun.result.asOk.accountId.toString(),
        gas_required: combinedDryRun.gasRequired.toJSON(),
        storage_deposit: combinedDryRun.storageDeposit.asCharge.toString(),
        finalized_block: { number: initialHeader.number.toNumber(), hash: uploadPreflightHash },
      },
      upload: uploadFinalized,
      instantiate_dry_run: {
        status: "pass",
        code_hash: expectedCodeHash,
        predicted_contract_address: instantiateDryRun.result.asOk.accountId.toString(),
        gas_required: instantiateDryRun.gasRequired.toJSON(),
        storage_deposit: instantiateDryRun.storageDeposit.asCharge.toString(),
        finalized_block_hash: uploadBlockHash,
      },
      instantiate: instantiateFinalized,
      contract_read: { status: "pending_resume" },
      ping_dry_run: { status: "pending_resume" },
      ping: { status: "not_broadcast" },
    },
  };

  await writeFile(reportFile, `${JSON.stringify(recovered, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: recovered.status,
    upload: {
      transaction_hash: uploadReceipt.transaction_hash,
      finalized_block_hash: uploadReceipt.finalized_block_hash,
      code_hash: expectedCodeHash,
    },
    instantiate: {
      transaction_hash: instantiateReceipt.transaction_hash,
      finalized_block_hash: instantiateReceipt.finalized_block_hash,
      contract_address: contractAddress,
    },
    broadcast_count: recovered.broadcast_count,
    report_path: reportPath,
  }, null, 2));
} finally {
  if (api) await api.disconnect();
}

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
const address = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const wasmPath = process.argv[2] ?? "contracts/p0-probe/target/wasm32-unknown-unknown/release/portaldot_p0_probe.deployable.wasm";
const outputPath = process.argv[3] ?? "evidence/p0/instantiate-preflight.json";
const contractsApiId = "0x68b66ba122c93fa7";
const contractsApiVersion = 2;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

if (!endpoint || !address) {
  throw new Error("Set PORTALDOT_TESTNET_WS_URL and PORTALDOT_TEST_ACCOUNT_ADDRESS in the environment.");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeBase58(input) {
  let value = 0n;
  for (const char of input) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid SS58 address.");
    value = value * 58n + BigInt(digit);
  }

  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  let leadingZeroes = 0;
  while (input[leadingZeroes] === "1") leadingZeroes += 1;
  bytes = Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);
  return bytes;
}

function encodeBase58(bytes) {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let output = "";
  while (value > 0n) {
    const digit = Number(value % 58n);
    output = alphabet[digit] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

function decodeAccountId(ss58Address) {
  const bytes = decodeBase58(ss58Address);
  if (bytes.length !== 35 || bytes[0] !== 42) {
    throw new Error("Expected a 32-byte SS58 account using prefix 42.");
  }

  const payload = bytes.subarray(0, 33);
  const checksum = createHash("blake2b512")
    .update(Buffer.concat([Buffer.from("SS58PRE"), payload]))
    .digest()
    .subarray(0, 2);
  if (!checksum.equals(bytes.subarray(33))) throw new Error("SS58 checksum mismatch.");
  return bytes.subarray(1, 33);
}

function encodeAccountId(accountId) {
  const payload = Buffer.concat([Buffer.from([42]), accountId]);
  const checksum = createHash("blake2b512")
    .update(Buffer.concat([Buffer.from("SS58PRE"), payload]))
    .digest()
    .subarray(0, 2);
  return encodeBase58(Buffer.concat([payload, checksum]));
}

function scaleCompactLength(length) {
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
  throw new Error("Input vector exceeds the supported SCALE compact encoding.");
}

function encodeBytes(bytes) {
  return Buffer.concat([scaleCompactLength(bytes.length), bytes]);
}

function readU128(bytes, offset) {
  let value = 0n;
  for (let index = 15; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  return value;
}

function readScaleCompact(bytes, offset) {
  const first = bytes[offset];
  const mode = first & 3;
  let value;
  let prefixBytes;

  if (mode === 0) {
    value = BigInt(first >> 2);
    prefixBytes = 1;
  } else if (mode === 1) {
    value = BigInt(bytes.readUInt16LE(offset) >> 2);
    prefixBytes = 2;
  } else if (mode === 2) {
    value = BigInt(bytes.readUInt32LE(offset) >>> 2);
    prefixBytes = 4;
  } else {
    const byteCount = (first >> 2) + 4;
    value = 0n;
    for (let index = byteCount - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[offset + 1 + index]);
    }
    prefixBytes = byteCount + 1;
  }

  return { value, offset: offset + prefixBytes };
}

function readScaleBytes(bytes, offset) {
  const first = bytes[offset];
  const mode = first & 3;
  let length;
  let prefixBytes;

  if (mode === 0) {
    length = first >> 2;
    prefixBytes = 1;
  } else if (mode === 1) {
    length = bytes.readUInt16LE(offset) >> 2;
    prefixBytes = 2;
  } else if (mode === 2) {
    length = bytes.readUInt32LE(offset) >>> 2;
    prefixBytes = 4;
  } else {
    const byteCount = (first >> 2) + 4;
    let value = 0n;
    for (let index = byteCount - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[offset + 1 + index]);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("SCALE byte vector is too large to decode.");
    length = Number(value);
    prefixBytes = byteCount + 1;
  }

  const start = offset + prefixBytes;
  const end = start + length;
  if (end > bytes.length) throw new Error("Truncated SCALE byte vector in runtime result.");
  return { value: bytes.subarray(start, end), offset: end };
}

function decodeInstantiateResult(rawResult) {
  const bytes = Buffer.from(rawResult.slice(2), "hex");
  if (bytes.length < 38) throw new Error("ContractsApi_instantiate returned a truncated result.");

  let offset = 0;
  const readWeight = () => {
    const refTime = readScaleCompact(bytes, offset);
    offset = refTime.offset;
    const proofSize = readScaleCompact(bytes, offset);
    offset = proofSize.offset;
    return { ref_time: refTime.value.toString(), proof_size: proofSize.value.toString() };
  };
  const gasConsumed = readWeight();
  const gasRequired = readWeight();

  const depositKindIndex = bytes[offset];
  offset += 1;
  const storageDeposit = {
    kind: depositKindIndex === 0 ? "refund" : depositKindIndex === 1 ? "charge" : "unknown",
    amount: readU128(bytes, offset).toString(),
  };
  offset += 16;

  const debugMessage = readScaleBytes(bytes, offset);
  offset = debugMessage.offset;
  const resultVariant = bytes[offset];
  offset += 1;

  if (resultVariant !== 0) {
    return {
      status: "execution_error",
      result_variant: resultVariant,
      error_bytes: `0x${bytes.subarray(offset).toString("hex")}`,
      gas_consumed: gasConsumed,
      gas_required: gasRequired,
      storage_deposit: storageDeposit,
      debug_message: debugMessage.value.toString("utf8"),
    };
  }

  if (offset + 4 > bytes.length) throw new Error("Truncated ExecReturnValue flags.");
  const flags = bytes.readUInt32LE(offset);
  offset += 4;
  const returnData = readScaleBytes(bytes, offset);
  offset = returnData.offset;
  if (offset + 32 > bytes.length) throw new Error("Truncated contract account ID in runtime result.");
  const accountId = bytes.subarray(offset, offset + 32);

  return {
    status: flags & 1 ? "constructor_reverted" : "success",
    result_variant: resultVariant,
    return_flags: flags,
    return_data_bytes: returnData.value.length,
    return_data_sha256: sha256(returnData.value),
    predicted_contract_address: encodeAccountId(accountId),
    gas_consumed: gasConsumed,
    gas_required: gasRequired,
    storage_deposit: storageDeposit,
    debug_message: debugMessage.value.toString("utf8"),
  };
}

const wasm = await readFile(wasmPath);
const accountId = decodeAccountId(address);
const constructorSelector = Buffer.from("9bae9d5e", "hex");
const compactCodeLength = scaleCompactLength(wasm.length);
const constructorInput = encodeBytes(constructorSelector);
const salt = encodeBytes(Buffer.alloc(0));
const input = Buffer.concat([
  accountId,
  Buffer.alloc(16),
  Buffer.from([0]),
  Buffer.from([0]),
  Buffer.from([0]),
  compactCodeLength,
  wasm,
  constructorInput,
  salt,
]);

const ws = new WebSocket(endpoint);
const pending = new Map();
let nextId = 0;

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message ?? "JSON-RPC request failed."));
  else request.resolve(message.result);
});

ws.addEventListener("error", () => {
  for (const request of pending.values()) request.reject(new Error("WebSocket connection failed."));
  pending.clear();
});

function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`JSON-RPC request timed out: ${method}`));
    }, 30_000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

const opened = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("WebSocket connection timed out.")), 15_000);
  ws.addEventListener("open", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  ws.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("WebSocket connection failed."));
  }, { once: true });
});

const report = {
  schema_version: 1,
  network: "portaldot-testnet",
  endpoint_id: new URL(endpoint).host,
  observed_at_utc: new Date().toISOString(),
  origin_source: "PORTALDOT_TEST_ACCOUNT_ADDRESS environment variable",
  private_signing_material_used: false,
  probe: {
    wasm_path: path.relative(process.cwd(), wasmPath),
    wasm_bytes: wasm.length,
    wasm_sha256: sha256(wasm),
    code_variant: "Upload",
    code_vec_length_prefix: `0x${compactCodeLength.toString("hex")}`,
    constructor_selector: `0x${constructorSelector.toString("hex")}`,
    constructor_input_bytes: constructorInput.length,
    salt_bytes: salt.length - scaleCompactLength(0).length,
  },
  runtime_api: {
    name: "ContractsApi_instantiate",
    id: contractsApiId,
    expected_version: contractsApiVersion,
  },
  request: {
    scale_bytes: input.length,
    sha256: sha256(input),
    value: "0",
    gas_limit: "None",
    storage_deposit_limit: "None",
    broadcast_count: 0,
  },
};

try {
  await opened;
  const blockHash = await rpc("chain_getFinalizedHead");
  const [header, runtime, metadata] = await Promise.all([
    rpc("chain_getHeader", [blockHash]),
    rpc("state_getRuntimeVersion", [blockHash]),
    rpc("state_getMetadata", [blockHash]),
  ]);

  const contractsApi = runtime.apis?.find(([id]) => id.toLowerCase() === contractsApiId);
  report.observed_finalized_block = {
    number: Number.parseInt(header.number, 16),
    hash: blockHash,
  };
  report.runtime = {
    spec_name: runtime.specName,
    spec_version: runtime.specVersion,
    transaction_version: runtime.transactionVersion,
    metadata_sha256: sha256(Buffer.from(metadata.slice(2), "hex")),
    contracts_api_version: contractsApi?.[1] ?? null,
  };

  if (!contractsApi || contractsApi[1] !== contractsApiVersion) {
    report.instantiate_dry_run = {
      status: "not_run_api_version_mismatch",
      observed_contracts_api_version: contractsApi?.[1] ?? null,
    };
  } else {
    const rawResult = await rpc(
      "state_call",
      ["ContractsApi_instantiate", `0x${input.toString("hex")}`, blockHash],
    );
    report.instantiate_dry_run = {
      raw_result: rawResult,
      finalized_block_number: report.observed_finalized_block.number,
      finalized_block_hash: blockHash,
    };
    try {
      const decoded = decodeInstantiateResult(rawResult);
      report.instantiate_dry_run.status = decoded.status;
      report.instantiate_dry_run.decoded = decoded;
    } catch (error) {
      report.instantiate_dry_run.status = "decode_error";
      report.instantiate_dry_run.decode_error = error instanceof Error ? error.message : String(error);
    }
  }
} catch (error) {
  report.instantiate_dry_run = {
    status: "rpc_error",
    error: error instanceof Error ? error.message : String(error),
  };
} finally {
  ws.close();
}

const absoluteOutputPath = path.resolve(outputPath);
await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

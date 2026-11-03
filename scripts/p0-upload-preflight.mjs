import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.PORTALDOT_TESTNET_WS_URL;
const address = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const wasmPath = process.argv[2] ?? "contracts/p0-probe/target/wasm32-unknown-unknown/release/portaldot_p0_probe.deployable.wasm";
const outputPath = process.argv[3] ?? "evidence/p0/upload-preflight.json";

if (!endpoint || !address) {
  throw new Error("Set PORTALDOT_TESTNET_WS_URL and PORTALDOT_TEST_ACCOUNT_ADDRESS in the environment.");
}

function decodeAccountId(ss58Address) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of ss58Address) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid SS58 address.");
    value = value * 58n + BigInt(digit);
  }

  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  let leadingZeroes = 0;
  while (ss58Address[leadingZeroes] === "1") leadingZeroes += 1;
  bytes = Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);

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
  throw new Error("Wasm length exceeds the supported SCALE compact encoding.");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const wasm = await readFile(wasmPath);
const compactLength = scaleCompactLength(wasm.length);
const accountId = decodeAccountId(address);
const input = Buffer.concat([
  accountId,
  compactLength,
  wasm,
  Buffer.from([0, 0]),
]).toString("hex");
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
    }, 20_000);
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

try {
  await opened;
  const blockHash = await rpc("chain_getFinalizedHead");
  const [header, runtime, metadata, rawResult] = await Promise.all([
    rpc("chain_getHeader", [blockHash]),
    rpc("state_getRuntimeVersion", [blockHash]),
    rpc("state_getMetadata", [blockHash]),
    rpc("state_call", ["ContractsApi_upload_code", `0x${input}`, blockHash]),
  ]);

  const succeeded = rawResult.toLowerCase().startsWith("0x00");
  const report = {
    schema_version: 1,
    network: "portaldot-testnet",
    observed_at_utc: new Date().toISOString(),
    observed_finalized_block: {
      number: Number.parseInt(header.number, 16),
      hash: blockHash,
    },
    runtime: {
      spec_name: runtime.specName,
      spec_version: runtime.specVersion,
      transaction_version: runtime.transactionVersion,
      metadata_sha256: sha256(Buffer.from(metadata.slice(2), "hex")),
    },
    origin_source: "PORTALDOT_TEST_ACCOUNT_ADDRESS environment variable",
    private_signing_material_used: false,
    probe: {
      wasm_path: path.relative(process.cwd(), wasmPath),
      wasm_bytes: wasm.length,
      wasm_sha256: sha256(wasm),
      scale_vec_length_prefix: `0x${compactLength.toString("hex")}`,
    },
    upload_code_dry_run: {
      status: succeeded ? "pass" : "dispatch_error",
      raw_result: rawResult,
      finalized_block_number: Number.parseInt(header.number, 16),
      finalized_block_hash: blockHash,
      metadata_sha256: sha256(Buffer.from(metadata.slice(2), "hex")),
    },
    broadcast_count: 0,
  };

  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws.close();
}

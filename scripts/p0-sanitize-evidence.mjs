import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const address = process.env.PORTALDOT_TEST_ACCOUNT_ADDRESS;
const files = process.argv.slice(2);

if (!address || files.length === 0) {
  throw new Error("Set PORTALDOT_TEST_ACCOUNT_ADDRESS and pass one or more JSON report paths.");
}

function redact(value) {
  if (typeof value === "string") return value === address ? "[test-account]" : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  }
  return value;
}

for (const file of files) {
  const absolutePath = path.resolve(file);
  const report = JSON.parse(await readFile(absolutePath, "utf8"));
  report.origin_address = null;
  report.account_address_injected_via_environment = true;
  await writeFile(absolutePath, `${JSON.stringify(redact(report), null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ sanitized_reports: files.length }));

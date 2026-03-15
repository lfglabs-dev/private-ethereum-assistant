import fs from "node:fs/promises";
import { groth16 } from "snarkjs";

const [, , inputPath, wasmPath, zkeyPath, outputPath] = process.argv;

const stringifyRailgunJson = (value) =>
  JSON.stringify(value, (_key, entryValue) =>
    typeof entryValue === "bigint" ? entryValue.toString() : entryValue,
  );

if (!inputPath || !wasmPath || !zkeyPath || !outputPath) {
  console.error(
    "Usage: node scripts/railgun-fullprove.mjs <inputs.json> <circuit.wasm> <circuit.zkey> <proof.json>",
  );
  process.exit(1);
}

try {
  const formattedInputs = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const proof = await groth16.fullProve(
    formattedInputs,
    wasmPath,
    zkeyPath,
    { debug: () => {} },
  );
  await fs.writeFile(outputPath, stringifyRailgunJson(proof));
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}

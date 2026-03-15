import fs from "node:fs/promises";
import { groth16 } from "snarkjs";

const [, , vkeyPath, publicSignalsPath, proofPath, outputPath] = process.argv;

const stringifyRailgunJson = (value) =>
  JSON.stringify(value, (_key, entryValue) =>
    typeof entryValue === "bigint" ? entryValue.toString() : entryValue,
  );

if (!vkeyPath || !publicSignalsPath || !proofPath || !outputPath) {
  console.error(
    "Usage: node scripts/railgun-verify.mjs <vkey.json> <public-signals.json> <proof.json> <result.json>",
  );
  process.exit(1);
}

try {
  const vkey = JSON.parse(await fs.readFile(vkeyPath, "utf8"));
  const publicSignals = JSON.parse(await fs.readFile(publicSignalsPath, "utf8"));
  const proof = JSON.parse(await fs.readFile(proofPath, "utf8"));
  const verified = await groth16.verify(vkey, publicSignals, proof);
  await fs.writeFile(outputPath, stringifyRailgunJson({ verified }));
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}

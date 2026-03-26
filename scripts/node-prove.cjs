/**
 * Node.js helper: runs groth16.fullProve and writes the result to a file.
 * Called as a subprocess from the Bun-based app to avoid Bun's worker
 * thread stack size limitation during FFT operations.
 *
 * Usage: node scripts/node-prove.cjs <inputsPath> <wasmPath> <zkeyPath> <resultPath>
 */
const path = require("path");
const fs = require("fs");

// Patch web-worker for Node.js 22+ where Event.target/currentTarget are read-only
const webWorkerPath = path.join(__dirname, "..", "node_modules", "web-worker", "cjs", "node.js");
const webWorkerSrc = fs.readFileSync(webWorkerPath, "utf-8");
if (webWorkerSrc.includes("event.target = event.currentTarget = this")) {
  fs.writeFileSync(
    webWorkerPath,
    webWorkerSrc.replace(
      /event\.target = event\.currentTarget = this/g,
      "try { event.target = event.currentTarget = this; } catch(e) { try { Object.defineProperty(event, 'target', { value: this, configurable: true }); } catch(e2) {} try { Object.defineProperty(event, 'currentTarget', { value: this, configurable: true }); } catch(e3) {} }"
    )
  );
  console.error("[node-prove] patched web-worker for Node.js 22+");
}

const snarkjs = require("snarkjs");

async function main() {
  const [,, inputsPath, wasmPath, zkeyPath, resultPath] = process.argv;

  console.error("[node-prove] reading inputs from", inputsPath);
  const inputs = JSON.parse(fs.readFileSync(inputsPath, "utf-8"));

  console.error("[node-prove] starting groth16.fullProve...");
  const startTime = Date.now();
  const { proof } = await snarkjs.groth16.fullProve(inputs, wasmPath, zkeyPath);
  console.error("[node-prove] proof complete in", Math.round((Date.now() - startTime) / 1000), "s");

  const json = JSON.stringify(proof);
  console.error("[node-prove] writing result, length:", json.length);
  fs.writeFileSync(resultPath, json);
  console.error("[node-prove] result written to", resultPath);

  // Terminate curve worker threads so the process can exit
  if (globalThis.curve_bn128) {
    await globalThis.curve_bn128.terminate();
    console.error("[node-prove] curve terminated");
  }
}

main().catch((e) => {
  console.error("[node-prove] FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});

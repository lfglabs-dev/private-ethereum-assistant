/**
 * Post-install patches for dependency module resolution issues.
 *
 * @kohaku-eth/railgun ships ESM (`dist/index.js`) that uses a `require()` shim
 * incompatible with both Turbopack and Node's strict ESM loader. We force the
 * CJS entry (`dist/index.cjs`) for all conditions so the server external loads
 * correctly.
 *
 * brotli has no `exports` map, so Node ESM cannot resolve `brotli/decompress`
 * (a bare specifier without `.js`). We add the missing `exports` entries.
 *
 * web-worker defines a custom Event constructor that produces plain objects,
 * but Bun's native EventTarget.dispatchEvent requires real Event instances.
 * We patch web-worker to use native Events throughout.
 */

import fs from "node:fs";
import path from "node:path";

function patchPackageJson(
  packageDir: string,
  patcher: (pkg: Record<string, unknown>) => boolean,
) {
  const pkgPath = path.join("node_modules", packageDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  if (patcher(pkg)) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

// Force @kohaku-eth/railgun to resolve its main export to the CJS entry
// for both `import` and `require` conditions.
patchPackageJson("@kohaku-eth/railgun", (pkg) => {
  const exports = pkg.exports as Record<string, Record<string, string>> | undefined;
  if (!exports?.["."]?.import) {
    return false;
  }

  if (exports["."].import.endsWith(".cjs")) {
    return false; // already patched
  }

  exports["."].import = "./dist/index.cjs";
  exports["."].default = "./dist/index.cjs";
  return true;
});

// Add exports map to brotli so Node ESM resolves `brotli/decompress`.
patchPackageJson("brotli", (pkg) => {
  if (pkg.exports) {
    return false; // already patched
  }

  pkg.exports = {
    ".": "./index.js",
    "./decompress": "./decompress.js",
    "./compress": "./compress.js",
  };
  return true;
});

// Patch web-worker so its Event constructor produces native Event instances.
// Bun's native EventTarget.dispatchEvent (which takes precedence in worker
// threads despite the prototype chain hack) requires real Event objects.
// The custom Event function (plain object) must be replaced with one that
// returns a native Event, and the error handler must wrap errors properly.
function patchFile(filePath: string, search: string, replacement: string) {
  const fullPath = path.join("node_modules", filePath);
  if (!fs.existsSync(fullPath)) {
    return;
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  if (content.includes(replacement)) {
    return; // already patched
  }
  if (!content.includes(search)) {
    return; // source changed, skip
  }
  fs.writeFileSync(fullPath, content.replace(search, replacement));
}

// Replace the custom Event constructor with one that returns native Events.
// The original creates plain objects which Bun's dispatchEvent rejects.
patchFile(
  "web-worker/cjs/node.js",
  `function Event(type, target) {
  this.type = type;
  this.timeStamp = Date.now();
  this.target = this.currentTarget = this.data = null;
}`,
  `function Event(type, target) {
  const e = new globalThis.Event(type);
  e.data = null;
  return e;
}`,
);

// Worker thread error handler: wrap raw Error in a proper Event
patchFile(
  "web-worker/cjs/node.js",
  `threads.parentPort.on('error', err => {
    err.type = 'Error';
    self.dispatchEvent(err);
  });`,
  `threads.parentPort.on('error', err => {
    const errorEvent = new Event('error');
    errorEvent.error = err;
    errorEvent.message = err.message;
    self.dispatchEvent(errorEvent);
  });`,
);

// Host side error handler: wrap raw Error in a proper Event
patchFile(
  "web-worker/cjs/node.js",
  `worker.on('error', error => {
        error.type = 'error';
        this.dispatchEvent(error);
      });`,
  `worker.on('error', error => {
        const errorEvent = new Event('error');
        errorEvent.error = error;
        errorEvent.message = error.message;
        this.dispatchEvent(errorEvent);
      });`,
);

// Patch @kohaku-eth/railgun prove() to run snarkjs in single-thread mode.
// Bun's worker threads have a smaller default stack size than Node.js, causing
// "Maximum call stack size exceeded" during the FFT operations in groth16 proof
// generation. Passing singleThread avoids spawning web workers entirely.
patchFile(
  "@kohaku-eth/railgun/dist/index.cjs",
  `await snarkjs.groth16.fullProve(inputs, artifact.wasm, artifact.zkey)`,
  `await snarkjs.groth16.fullProve(inputs, artifact.wasm, artifact.zkey, undefined, undefined, { singleThread: true })`,
);

patchFile(
  "@kohaku-eth/railgun/dist/index.js",
  `await groth16.fullProve(inputs, artifact.wasm, artifact.zkey)`,
  `await groth16.fullProve(inputs, artifact.wasm, artifact.zkey, undefined, undefined, { singleThread: true })`,
);

// Fix: Replace test circuit artifacts URL with production IPFS artifacts.
// The lucemans/railguntemp repo hosts test artifacts from a different Phase 2
// ceremony than what's deployed on-chain. Production artifacts come from the
// official Railgun IPFS at QmUsmnK4PFc7zDp2cmC4wBZxYLjNyRgWfs5GNcJJ2uLcpU.
// We replace the default fetcher to load from local files (downloaded from IPFS)
// with a mapping from SDK path format (e.g. "2x2/zkey.br") to the local files.
patchFile(
  "@kohaku-eth/railgun/dist/index.cjs",
  `rgHttpFetcher("https://raw.githubusercontent.com/lucemans/railguntemp/refs/heads/master/package/")`,
  `((basePath) => {
    const _fs = require('fs');
    const _path = require('path');
    const circuitsDir = _path.join(process.cwd(), 'data', 'circuits');
    return async (filePath) => {
      // filePath looks like "2x2/zkey.br" or "2x2/vkey.json"
      const localPath = _path.join(circuitsDir, filePath);
      if (_fs.existsSync(localPath)) {
        return Buffer.from(_fs.readFileSync(localPath));
      }
      // Fallback to IPFS for any missing artifacts
      const parts = filePath.split('/');
      const variant = parts[0].split('x').map(n => n.padStart(2, '0')).join('x');
      const fileName = parts.slice(1).join('/');
      const ipfsRoot = 'https://ipfs-lb.com/ipfs/QmUsmnK4PFc7zDp2cmC4wBZxYLjNyRgWfs5GNcJJ2uLcpU';
      let url;
      if (fileName === 'zkey.br') url = ipfsRoot + '/circuits/' + variant + '/zkey.br';
      else if (fileName === 'wasm.br') url = ipfsRoot + '/prover/snarkjs/' + variant + '.wasm.br';
      else if (fileName === 'vkey.json') url = ipfsRoot + '/circuits/' + variant + '/vkey.json';
      else url = ipfsRoot + '/circuits/' + variant + '/' + fileName;
      console.log('[circuits] IPFS fallback:', url);
      const resp = await fetch(url);
      return Buffer.from(await resp.arrayBuffer());
    };
  })()`,
);

// Fix: loadCachedMerkleTrees does not set maxLeafIndex when restoring trees
// from serialized state. This causes rebuildSparseTree() to wipe the tree
// (it returns early when maxLeafIndex < 0), making all Merkle proofs invalid.
// The fix scans level 0 to find the highest occupied leaf index.
patchFile(
  "@kohaku-eth/railgun/dist/index.cjs",
  `    merkleTree.nullifiers = cached.nullifiers.map(hexStringToArray);
    trees[i] = merkleTree;`,
  `    merkleTree.nullifiers = cached.nullifiers.map(hexStringToArray);
    // Fix: set maxLeafIndex from loaded tree data so rebuildSparseTree
    // doesn't wipe the tree (maxLeafIndex defaults to -1 in constructor)
    const leaves = merkleTree.tree[0];
    for (let k = leaves.length - 1; k >= 0; k--) {
      if (leaves[k]) {
        merkleTree.maxLeafIndex = k;
        break;
      }
    }
    trees[i] = merkleTree;`,
);

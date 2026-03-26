#!/usr/bin/env bun
/**
 * Generate compressed Railgun snapshots (indexer + account state).
 *
 * This script syncs the indexer to the latest block (resuming from existing
 * local state if available), then serializes and compresses both the Merkle
 * trees and account state into data/.
 *
 * Usage:
 *   bun run scripts/generate-snapshot.ts                  # indexer only
 *   dotenvx run -f .env.tianjin -- bun run scripts/generate-snapshot.ts  # indexer + account
 */
import { createPublicClient, http, keccak256, stringToHex } from "viem";
import { arbitrum } from "viem/chains";
import {
  createRailgunAccount,
  createRailgunIndexer,
  RAILGUN_CONFIG_BY_CHAIN_ID,
  type RailgunNetworkConfig,
} from "@kohaku-eth/railgun";
import { viem as viemProvider } from "@kohaku-eth/provider/viem";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ARBITRUM_CHAIN_ID = "42161";

// Register Arbitrum config (same as main app)
if (!RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID]) {
  (RAILGUN_CONFIG_BY_CHAIN_ID as Record<string, RailgunNetworkConfig>)[ARBITRUM_CHAIN_ID] = {
    NAME: "Arbitrum",
    RAILGUN_ADDRESS: "0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9",
    GLOBAL_START_BLOCK: 56109834,
    CHAIN_ID: 42161n,
    RELAY_ADAPT_ADDRESS: "0x5aD95C537b002770a39dea342c4bb2b68B1497aA",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    FEE_BASIS_POINTS: 25n,
  };
}

const STORAGE_DIR = path.join(process.cwd(), ".context", "railgun");
const OUTPUT_DIR = path.join(process.cwd(), "data");

function createFileStorageLayer(filePath: string) {
  return {
    async get() {
      try {
        const data = await fs.promises.readFile(filePath, "utf-8");
        return JSON.parse(data);
      } catch {
        return undefined;
      }
    },
    async set(data: unknown) {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data));
    },
  };
}

async function main() {
  const client = createPublicClient({
    chain: arbitrum,
    transport: http("https://arb1.arbitrum.io/rpc"),
  });
  const provider = viemProvider(client);
  const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID]!;

  // Use existing local state as checkpoint if available
  const indexerStorage = createFileStorageLayer(
    path.join(STORAGE_DIR, "indexer-state.json"),
  );

  console.log("Creating indexer (will resume from checkpoint if available)...");
  const indexer = await createRailgunIndexer({
    network: networkConfig,
    provider,
    storage: indexerStorage,
    startBlock: 334510000, // First tree #1 event
  });

  const startBlock = indexer.getEndBlock();
  const currentBlock = Number(await client.getBlockNumber());
  console.log(`Syncing from block ${startBlock} to ${currentBlock} (${currentBlock - startBlock} blocks)...`);

  const syncStart = Date.now();
  try {
    await Promise.race([
      indexer.sync({ logProgress: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Sync timed out after 30 minutes")), 1800_000),
      ),
    ]);
    console.log(`Sync complete in ${Math.round((Date.now() - syncStart) / 1000)}s`);
  } catch (e) {
    console.log(`Sync ended: ${(e as Error).message} after ${Math.round((Date.now() - syncStart) / 1000)}s`);
    console.log("Generating snapshot from partial sync state...");
  }

  // --- Indexer snapshot ---
  const state = indexer.getSerializedState();
  const json = JSON.stringify(state);
  console.log(`Serialized indexer state: ${(json.length / 1024 / 1024).toFixed(2)} MB (endBlock: ${state.endBlock})`);

  const compressed = Bun.gzipSync(Buffer.from(json));
  console.log(`Compressed indexer: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);

  const sha256 = createHash("sha256").update(json).digest("hex");

  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(OUTPUT_DIR, "railgun-snapshot.json.gz"), compressed);

  const meta: Record<string, unknown> = {
    endBlock: state.endBlock,
    generatedAt: new Date().toISOString(),
    sha256,
    sdkVersion: "0.0.1-alpha.8",
  };

  // --- Account snapshot (if SEED_PHRASE is available) ---
  const seedPhrase = process.env.SEED_PHRASE?.trim();
  if (seedPhrase) {
    console.log("\nSEED_PHRASE detected, generating account snapshot...");
    const accountStorage = createFileStorageLayer(
      path.join(STORAGE_DIR, "account-state.json"),
    );

    const account = await createRailgunAccount({
      credential: { type: "mnemonic", mnemonic: seedPhrase, accountIndex: 0 },
      indexer,
      storage: accountStorage,
    });

    const accountState = account.getSerializedState();
    const accountJson = JSON.stringify(accountState);
    const accountCompressed = Bun.gzipSync(Buffer.from(accountJson));
    const accountSha256 = createHash("sha256").update(accountJson).digest("hex");

    await fs.promises.writeFile(
      path.join(OUTPUT_DIR, "railgun-account-snapshot.json.gz"),
      accountCompressed,
    );

    const fingerprint = keccak256(stringToHex(`railgun-wallet:${seedPhrase}`));
    meta.accountSha256 = accountSha256;
    meta.walletFingerprint = fingerprint;

    console.log(`  Account snapshot: ${(accountCompressed.length / 1024).toFixed(0)} KB`);
    console.log(`  Wallet fingerprint: ${fingerprint.slice(0, 16)}...`);
  } else {
    console.log("\nNo SEED_PHRASE — skipping account snapshot.");
  }

  await fs.promises.writeFile(
    path.join(OUTPUT_DIR, "railgun-snapshot-meta.json"),
    JSON.stringify(meta, null, 2),
  );

  console.log("\nSnapshot generated:");
  console.log(`  data/railgun-snapshot.json.gz (${(compressed.length / 1024).toFixed(0)} KB)`);
  console.log(`  data/railgun-snapshot-meta.json`);
  console.log(`  endBlock: ${state.endBlock}`);
  console.log(`  sha256: ${sha256}`);
}

main().catch(console.error);

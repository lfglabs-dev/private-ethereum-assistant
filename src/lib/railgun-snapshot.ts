import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndexerLoadData } from "./railgun-snapshot-types";

const SNAPSHOT_DIR = path.join(process.cwd(), "data");
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, "railgun-snapshot.json.gz");
const ACCOUNT_SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, "railgun-account-snapshot.json.gz");
const META_PATH = path.join(SNAPSHOT_DIR, "railgun-snapshot-meta.json");

export type SnapshotMeta = {
  endBlock: number;
  generatedAt: string;
  sha256: string;
  sdkVersion: string;
  accountSha256?: string;
  walletFingerprint?: string;
};

export type { IndexerLoadData };

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Load and decompress the bundled Merkle tree snapshot.
 * Returns null if the snapshot files are missing or corrupt.
 */
export async function loadBundledSnapshot(): Promise<IndexerLoadData | null> {
  if (!(await fileExists(SNAPSHOT_PATH)) || !(await fileExists(META_PATH))) {
    return null;
  }

  try {
    const metaRaw = await fs.promises.readFile(META_PATH, "utf8");
    const meta: SnapshotMeta = JSON.parse(metaRaw);

    const compressed = await fs.promises.readFile(SNAPSHOT_PATH);
    const decompressed = Bun.gunzipSync(compressed);
    const json = Buffer.from(decompressed).toString("utf8");

    // Verify SHA-256 integrity
    const hash = createHash("sha256").update(json).digest("hex");
    if (hash !== meta.sha256) {
      console.warn(
        `[railgun-snapshot] SHA-256 mismatch: expected ${meta.sha256}, got ${hash}`,
      );
      return null;
    }

    const data = JSON.parse(json) as IndexerLoadData;
    return data;
  } catch (e) {
    console.warn("[railgun-snapshot] Failed to load snapshot:", (e as Error).message);
    return null;
  }
}

/**
 * Load the bundled account state snapshot if it matches the wallet fingerprint.
 * Returns the raw parsed JSON (CachedAccountStorage shape) or null.
 */
export async function loadBundledAccountSnapshot(
  walletFingerprint: string,
): Promise<object | null> {
  if (!(await fileExists(ACCOUNT_SNAPSHOT_PATH)) || !(await fileExists(META_PATH))) {
    return null;
  }

  try {
    const metaRaw = await fs.promises.readFile(META_PATH, "utf8");
    const meta: SnapshotMeta = JSON.parse(metaRaw);

    // Only use account snapshot if wallet fingerprint matches
    if (!meta.walletFingerprint || meta.walletFingerprint !== walletFingerprint) {
      return null;
    }

    if (!meta.accountSha256) return null;

    const compressed = await fs.promises.readFile(ACCOUNT_SNAPSHOT_PATH);
    const decompressed = Bun.gunzipSync(compressed);
    const json = Buffer.from(decompressed).toString("utf8");

    const hash = createHash("sha256").update(json).digest("hex");
    if (hash !== meta.accountSha256) {
      console.warn(
        `[railgun-snapshot] Account SHA-256 mismatch: expected ${meta.accountSha256}, got ${hash}`,
      );
      return null;
    }

    return JSON.parse(json) as object;
  } catch (e) {
    console.warn("[railgun-snapshot] Failed to load account snapshot:", (e as Error).message);
    return null;
  }
}

/**
 * Load just the snapshot metadata (without decompressing the full snapshot).
 */
export async function loadSnapshotMeta(): Promise<SnapshotMeta | null> {
  if (!(await fileExists(META_PATH))) {
    return null;
  }
  try {
    const raw = await fs.promises.readFile(META_PATH, "utf8");
    return JSON.parse(raw) as SnapshotMeta;
  } catch {
    return null;
  }
}

/**
 * Check if the bundled snapshot is needed (no local state, or snapshot is fresher).
 */
export async function isSnapshotNeeded(indexerStoragePath: string): Promise<boolean> {
  const meta = await loadSnapshotMeta();
  if (!meta) return false; // No snapshot available

  if (!(await fileExists(indexerStoragePath))) {
    return true; // No local state — use snapshot
  }

  try {
    const raw = await fs.promises.readFile(indexerStoragePath, "utf8");
    const local = JSON.parse(raw) as { endBlock?: number };
    if (!local.endBlock) return true;
    return meta.endBlock > local.endBlock;
  } catch {
    return true; // Corrupt local state — use snapshot
  }
}

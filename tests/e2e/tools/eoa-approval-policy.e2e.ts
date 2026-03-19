import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createTools } from "@/lib/tools";
import {
  approveAndSendPreparedEoaTransfer,
  rejectPreparedEoaTransfer,
} from "@/lib/tools/eoa-tx";
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  collectAsyncIterable,
  createE2ERuntimeConfig,
  executeTool,
  executeToolStream,
  getWalletAddress,
  getWalletPrivateKey,
} from "../helpers/config";
import { verificationClient } from "../helpers/verification-client";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const walletAddress = await getWalletAddress();
const TEST_AMOUNT = "0.000001";

type TransactionPreviewResult = {
  kind: "transaction_preview";
  status: "awaiting_confirmation" | "awaiting_local_approval" | "aborted";
  confirmationId?: string;
  approval?: {
    required: boolean;
    summary: {
      recipient: string;
      asset: string;
      amount: string;
      network: string;
      estimatedGas: string;
    };
  };
};

type TransactionProgressUpdate = {
  kind: "transaction_progress";
  status: string;
  txHash?: `0x${string}`;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectPreview(result: unknown): asserts result is TransactionPreviewResult {
  if (!isRecord(result) || result.kind !== "transaction_preview") {
    throw new Error("Expected a transaction preview result.");
  }
}

function expectProgress(result: unknown): asserts result is TransactionProgressUpdate {
  if (!isRecord(result) || result.kind !== "transaction_progress") {
    throw new Error("Expected a transaction progress update.");
  }
}

async function createApprovalPolicyTools(nativeThreshold: string) {
  const runtimeConfig = await createE2ERuntimeConfig(ARBITRUM_CONFIG);
  return createTools(ARBITRUM_CONFIG, {
    ...runtimeConfig,
    wallet: {
      ...runtimeConfig.wallet,
      approvalPolicy: {
        ...runtimeConfig.wallet.approvalPolicy,
        enabled: true,
        nativeThreshold,
        erc20Threshold: "0.0000001",
      },
    },
  });
}

describe("EOA approval policy E2E", () => {
  test("below-threshold sends keep the normal confirmation flow", async () => {
    const tools = await createApprovalPolicyTools("1");
    const preview = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: TEST_AMOUNT,
    });

    expectPreview(preview);
    expect(preview.status).toBe("awaiting_confirmation");
    expect(preview.approval?.required).toBe(false);
  });

  test("above-threshold sends require local approval and expose an exact summary", async () => {
    const tools = await createApprovalPolicyTools("0.0000001");
    const preview = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: TEST_AMOUNT,
    });

    expectPreview(preview);
    expect(preview.status).toBe("awaiting_local_approval");
    expect(preview.confirmationId?.length).toBeGreaterThan(0);
    expect(preview.approval?.required).toBe(true);
    expect(preview.approval?.summary.recipient).toContain(walletAddress);
    expect(preview.approval?.summary.asset).toBe("ETH");
    expect(preview.approval?.summary.amount).toBe(`${TEST_AMOUNT} ETH`);
    expect(preview.approval?.summary.network).toBe("Arbitrum One");
    expect(preview.approval?.summary.estimatedGas).toContain("gas");

    const gatedSend = await collectAsyncIterable(
      executeToolStream(tools.send_eoa_transfer, {
        confirmationId: preview.confirmationId!,
      }),
    );
    expectPreview(gatedSend[0]);
    expect(gatedSend[0].status).toBe("awaiting_local_approval");
  });

  test("approved high-value sends broadcast only after local approval", async () => {
    const tools = await createApprovalPolicyTools("0.0000001");
    const preview = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: TEST_AMOUNT,
    });

    expectPreview(preview);
    if (!preview.confirmationId) {
      throw new Error("Expected a confirmationId for the approval-required transfer.");
    }

    const updates = await collectAsyncIterable(
      approveAndSendPreparedEoaTransfer(
        preview.confirmationId,
        await getWalletPrivateKey(),
      ),
    );
    const finalUpdate = updates.at(-1);

    expectProgress(finalUpdate);
    expect(finalUpdate.status).toBe("confirmed");
    expect(finalUpdate.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  test("rejected high-value sends abort cleanly without broadcasting", async () => {
    const tools = await createApprovalPolicyTools("0.0000001");
    const preview = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: TEST_AMOUNT,
    });

    expectPreview(preview);
    if (!preview.confirmationId) {
      throw new Error("Expected a confirmationId for the approval-required transfer.");
    }

    const nonceBefore = await verificationClient.getTransactionCount({
      address: walletAddress,
      blockTag: "pending",
    });
    const rejected = rejectPreparedEoaTransfer(preview.confirmationId);
    const nonceAfter = await verificationClient.getTransactionCount({
      address: walletAddress,
      blockTag: "pending",
    });

    expect(rejected.status).toBe("aborted");
    expect((rejected.message ?? "").toLowerCase()).toContain("not signed or broadcast");
    expect(nonceAfter).toBe(nonceBefore);

    const sendAfterReject = await collectAsyncIterable(
      executeToolStream(tools.send_eoa_transfer, {
        confirmationId: preview.confirmationId,
      }),
    );
    expectPreview(sendAfterReject[0]);
    expect(sendAfterReject[0].status).toBe("aborted");
  });
});

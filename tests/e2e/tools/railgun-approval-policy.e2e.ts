import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { approveRailgunAction, rejectRailgunAction } from "@/lib/railgun"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  createE2ERuntimeConfig,
  executeTool,
  getWalletAddress,
} from "../helpers/config"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 3)

const walletAddress = await getWalletAddress()
const baseRuntimeConfig = await createE2ERuntimeConfig(ARBITRUM_CONFIG, "railgun")
const runtimeConfig = {
  ...baseRuntimeConfig,
  railgun: {
    ...baseRuntimeConfig.railgun,
    shieldApprovalThreshold: "0.0000005",
    transferApprovalThreshold: "0.0000005",
    unshieldApprovalThreshold: "0.0000005",
  },
}
const tools = createTools(ARBITRUM_CONFIG, runtimeConfig)
const SHIELD_AMOUNT = "0.000001"
const TRANSFER_AMOUNT = "0.0000006"
const UNSHIELD_AMOUNT = "0.0000006"

type RailgunApprovalResult = {
  railgun: true
  status: "awaiting_local_approval"
  operation: "shield" | "transfer" | "unshield"
  railgunAddress: string
  token: string
  amount: string
  recipient?: string
  summary: string
  privacyImpact: string
  message: string
  approval: {
    id: string
    threshold: string
    status: "awaiting_local_approval"
    submitted: false
  }
}

type RailgunCancelledResult = {
  railgun: true
  status: "cancelled"
  message: string
  approval: {
    id: string
    status: "cancelled"
    submitted: false
  }
}

type RailgunSuccessResult = {
  railgun: true
  status: "success"
  operation: "shield"
  txHash: string
  explorerUrl: string
  summary: string
  privacyImpact: string
}

type RailgunErrorResult = {
  railgun: true
  status: "error"
  operation: "shield" | "transfer" | "unshield"
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFundingConstraint(result: unknown, operation: RailgunErrorResult["operation"]) {
  return (
    isRecord(result) &&
    result.railgun === true &&
    result.status === "error" &&
    result.operation === operation &&
    typeof result.message === "string" &&
    /insufficient|fund/i.test(result.message)
  )
}

function expectAwaitingApproval(
  result: unknown,
  operation: RailgunApprovalResult["operation"],
): asserts result is RailgunApprovalResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "awaiting_local_approval" ||
    result.operation !== operation ||
    !isRecord(result.approval) ||
    typeof result.approval.id !== "string" ||
    typeof result.summary !== "string" ||
    typeof result.privacyImpact !== "string"
  ) {
    throw new Error(`Expected a pending approval result for Railgun ${operation}.`)
  }
}

function expectCancelledResult(result: unknown): asserts result is RailgunCancelledResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "cancelled" ||
    !isRecord(result.approval) ||
    result.approval.status !== "cancelled"
  ) {
    throw new Error("Expected a cancelled Railgun approval result.")
  }
}

function expectShieldSuccess(result: unknown): asserts result is RailgunSuccessResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "success" ||
    result.operation !== "shield" ||
    typeof result.txHash !== "string" ||
    typeof result.explorerUrl !== "string"
  ) {
    throw new Error("Expected a successful approved Railgun shield result.")
  }
}

describe("Railgun approval policy E2E", () => {
  let fundingConstrained = false
  let shieldApproval: unknown
  let approvedShield: unknown
  let transferApproval: unknown
  let transferRejected: unknown
  let unshieldApproval: unknown
  let unshieldRejected: unknown

  beforeAll(async () => {
    shieldApproval = await executeTool(tools.railgun_shield, {
      token: "ETH",
      amount: SHIELD_AMOUNT,
    })
    expectAwaitingApproval(shieldApproval, "shield")

    approvedShield = await approveRailgunAction(shieldApproval.approval.id)
    if (isFundingConstraint(approvedShield, "shield")) {
      fundingConstrained = true
      return
    }

    transferApproval = await executeTool(tools.railgun_transfer, {
      recipient: shieldApproval.railgunAddress,
      token: "ETH",
      amount: TRANSFER_AMOUNT,
    })
    expectAwaitingApproval(transferApproval, "transfer")
    transferRejected = rejectRailgunAction(transferApproval.approval.id)

    unshieldApproval = await executeTool(tools.railgun_unshield, {
      recipient: walletAddress,
      token: "ETH",
      amount: UNSHIELD_AMOUNT,
    })
    expectAwaitingApproval(unshieldApproval, "unshield")
    unshieldRejected = rejectRailgunAction(unshieldApproval.approval.id)
  })

  test("shield requests local approval with an exact summary and privacy impact", () => {
    expectAwaitingApproval(shieldApproval, "shield")
    expect(shieldApproval.summary).toContain(`Shield ${SHIELD_AMOUNT} ETH`)
    expect(shieldApproval.summary).toContain("public wallet")
    expect(shieldApproval.privacyImpact.toLowerCase()).toContain("public")
    expect(shieldApproval.approval.threshold).toBe("0.0000005")
    expect(shieldApproval.message.toLowerCase()).toContain("local approval")
  })

  test("approving a pending shield completes the Railgun action", () => {
    if (fundingConstrained) {
      expect(isFundingConstraint(approvedShield, "shield")).toBe(true)
      return
    }

    expectShieldSuccess(approvedShield)
    expect(approvedShield.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(approvedShield.explorerUrl).toContain("arbiscan.io")
    expect(approvedShield.summary).toContain(`Shield ${SHIELD_AMOUNT} ETH`)
    expect(approvedShield.privacyImpact.toLowerCase()).toContain("public")
  })

  test("private transfers above the threshold require approval with privacy details", () => {
    if (fundingConstrained) {
      expect(isFundingConstraint(approvedShield, "shield")).toBe(true)
      return
    }

    expectAwaitingApproval(transferApproval, "transfer")
    expect(transferApproval.summary).toContain(`Privately transfer ${TRANSFER_AMOUNT} ETH`)
    expect(transferApproval.summary).toContain(transferApproval.recipient ?? "")
    expect(transferApproval.privacyImpact.toLowerCase()).toContain("private")
  })

  test("rejecting a pending private transfer prevents submission", () => {
    if (fundingConstrained) {
      expect(isFundingConstraint(approvedShield, "shield")).toBe(true)
      return
    }

    expectCancelledResult(transferRejected)
    expect(transferRejected.message.toLowerCase()).toContain("rejected")
    expect("txHash" in transferRejected).toBe(false)
  })

  test("unshields above the threshold require approval with exit-from-privacy messaging", () => {
    if (fundingConstrained) {
      expect(isFundingConstraint(approvedShield, "shield")).toBe(true)
      return
    }

    expectAwaitingApproval(unshieldApproval, "unshield")
    expect(unshieldApproval.summary).toContain(`Unshield ${UNSHIELD_AMOUNT} ETH`)
    expect(unshieldApproval.summary).toContain(walletAddress)
    expect(unshieldApproval.privacyImpact.toLowerCase()).toContain("privacy pool")
    expect(unshieldApproval.privacyImpact.toLowerCase()).toContain("public")
  })

  test("rejecting a pending unshield leaves the action cancelled without submission", () => {
    if (fundingConstrained) {
      expect(isFundingConstraint(approvedShield, "shield")).toBe(true)
      return
    }

    expectCancelledResult(unshieldRejected)
    expect(unshieldRejected.message.toLowerCase()).toContain("no railgun transaction was signed")
    expect("txHash" in unshieldRejected).toBe(false)
  })
})

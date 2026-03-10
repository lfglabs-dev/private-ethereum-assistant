import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { erc20Abi } from "viem"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  ARBITRUM_USDC_ADDRESS,
  E2E_TEST_TIMEOUT_MS,
  executeTool,
  getWalletAddress,
} from "../helpers/config"
import {
  findRecentTransactionHash,
  verificationClient,
} from "../helpers/verification-client"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const tools = createTools(ARBITRUM_CONFIG)
const walletAddress = getWalletAddress()

describe("read-chain E2E", () => {
  test("get_balance returns the real native ETH balance on Arbitrum", async () => {
    const result = await executeTool(tools.get_balance, {
      address: walletAddress,
    })

    expect(result.nativeBalance?.symbol).toBe("ETH")
    expect(result.nativeBalance?.formattedBalance.length).toBeGreaterThan(0)
    expect(result.blockNumber).toBeGreaterThan(0)

    const verifiedBalance = await verificationClient.getBalance({
      address: walletAddress,
    })
    expect(result.nativeBalance?.rawBalance).toBe(verifiedBalance.toString())
  })

  test("get_balance returns the real USDC balance on Arbitrum", async () => {
    const result = await executeTool(tools.get_balance, {
      address: walletAddress,
      tokenAddress: ARBITRUM_USDC_ADDRESS,
    })

    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0]?.symbol).toBe("USDC")
    expect(result.tokens[0]?.decimals).toBe(6)

    const verifiedBalance = await verificationClient.readContract({
      address: ARBITRUM_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    })
    expect(result.tokens[0]?.rawBalance).toBe(verifiedBalance.toString())
  })

  test("get_balance returns a valid snapshot for an otherwise unused address", async () => {
    const result = await executeTool(tools.get_balance, {
      address: "0x0000000000000000000000000000000000000001",
    })

    expect(result.address).toBe("0x0000000000000000000000000000000000000001")
    expect(result.nativeBalance?.symbol).toBe("ETH")
    expect(BigInt(result.nativeBalance?.rawBalance ?? "0")).toBeGreaterThanOrEqual(
      BigInt(0)
    )
    expect(result.errors).toEqual([])
  })

  test("get_transaction returns details for a recent Arbitrum transaction", async () => {
    const hash = await findRecentTransactionHash()
    const result = await executeTool(tools.get_transaction, { hash })
    const receipt = await verificationClient.getTransactionReceipt({ hash })

    expect(result.hash).toBe(hash)
    expect(result.from.startsWith("0x")).toBe(true)
    expect(result.to?.startsWith("0x")).toBe(true)
    expect(result.status).toBe(receipt.status === "success" ? "Success" : "Failed")
    expect(result.blockNumber).toBeGreaterThan(0)
  })
})

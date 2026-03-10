import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  executeTool,
  retry,
} from "../helpers/config"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const tools = createTools(ARBITRUM_CONFIG)

describe("Safe E2E", () => {
  test("get_safe_info returns owners, threshold, and ETH balance", async () => {
    const result = await retry(() => executeTool(tools.get_safe_info, {}))

    expect(result.address.startsWith("0x")).toBe(true)
    expect(result.owners.length).toBeGreaterThan(0)
    expect(result.threshold).toBeGreaterThan(0)
    expect(result.balance).toContain("ETH")
  })

  test("get_pending_transactions returns the Safe queue payload", async () => {
    const result = await retry(() => executeTool(tools.get_pending_transactions, {}))

    if ("status" in result && result.status === "error") {
      throw new Error(result.message)
    }

    expect(Array.isArray(result.transactions)).toBe(true)
    expect(result.safeAddress.startsWith("0x")).toBe(true)
    expect(result.safeUILink).toContain("app.safe.global")
  })
})

import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createDefaultRuntimeConfig } from "@/lib/runtime-config"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  executeTool,
  retry,
} from "../helpers/config"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const safeRuntimeConfig = {
  ...createDefaultRuntimeConfig(),
  network: ARBITRUM_CONFIG,
  actor: {
    type: "safe" as const,
  },
}
const tools = createTools(ARBITRUM_CONFIG, safeRuntimeConfig)

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

  test("propose_transaction creates an ETH transfer proposal or a manual Safe action", async () => {
    const info = await retry(() => executeTool(tools.get_safe_info, {}))
    const recipient = info.owners[0]

    const result = await retry(() =>
      executeTool(tools.propose_transaction, {
        to: recipient,
        value: "0.0001",
      })
    )

    expect(["proposed", "manual_creation_required"]).toContain(result.status)
    expect(result.safeUILink).toContain("app.safe.global")
    expect(result.transaction?.to).toBe(recipient)
    expect(result.transaction?.value).toBe("0.0001 ETH")
  })

  test("propose_transaction rejects unresolved ENS names", async () => {
    const result = await retry(() =>
      executeTool(tools.propose_transaction, {
        to: "vitalik.eth",
        value: "0.001",
      })
    )

    expect(result.status).toBe("error")
    expect(String(result.message).toLowerCase()).toMatch(
      /resolve ens|resolved 0x|valid 0x/
    )
  })
})

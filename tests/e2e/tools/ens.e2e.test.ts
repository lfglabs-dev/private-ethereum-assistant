import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import { ARBITRUM_CONFIG, E2E_TEST_TIMEOUT_MS, executeTool } from "../helpers/config"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const tools = createTools(ARBITRUM_CONFIG)
const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

describe("ENS E2E", () => {
  test("resolve_ens resolves vitalik.eth", async () => {
    const result = await executeTool(tools.resolve_ens, {
      name: "vitalik.eth",
    })
    if ("results" in result) {
      throw new Error("Expected a single ENS resolution result.")
    }

    expect(result.address).toBe(VITALIK_ADDRESS)
    expect(result.error).toBeNull()
    expect(result.errorCode).toBeNull()
  })

  test("resolve_ens supports batch resolution with a missing name", async () => {
    const result = await executeTool(tools.resolve_ens, {
      names: ["vitalik.eth", "nonexistent-gibberish-99999.eth"],
    })
    if (!("results" in result)) {
      throw new Error("Expected a batch ENS resolution result.")
    }

    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.address).toBe(VITALIK_ADDRESS)
    expect(result.results[1]?.errorCode).toBe("name_not_found")
  })

  test("reverse_resolve_ens returns vitalik.eth for Vitalik's address", async () => {
    const result = await executeTool(tools.reverse_resolve_ens, {
      address: VITALIK_ADDRESS,
    })

    expect(result.name).toBe("vitalik.eth")
    expect(result.error).toBeNull()
    expect(result.errorCode).toBeNull()
  })

  test("resolve_ens returns a validation error for malformed names", async () => {
    const result = await executeTool(tools.resolve_ens, {
      name: "invalid..eth",
    })
    if ("results" in result) {
      throw new Error("Expected a single ENS resolution result.")
    }

    expect(result.address).toBeNull()
    expect(result.errorCode).toBe("invalid_name")
  })
})

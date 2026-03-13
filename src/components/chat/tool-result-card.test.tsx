import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ToolResultCard } from "./tool-result-card"

describe("ToolResultCard", () => {
  test("renders verified token rows with icons and badges", () => {
    const html = renderToStaticMarkup(
      <ToolResultCard
        result={{
          address: "0x0000000000000000000000000000000000000001",
          blockNumber: 123,
          nativeBalance: null,
          errors: [],
          tokenCandidates: [],
          tokens: [
            {
              chainId: 8453,
              chainName: "Base",
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
              rawBalance: "1000000",
              formattedBalance: "1",
              iconUrl:
                "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/logo.png",
              source: "verified",
            },
          ],
        }}
      />,
    )

    expect(html).toContain("USD Coin")
    expect(html).toContain("verified")
    expect(html).toContain("Base")
    expect(html).toContain("token icon")
    expect(html).toContain("1 USDC")
  })

  test("renders disambiguation candidates and on-chain labels", () => {
    const html = renderToStaticMarkup(
      <ToolResultCard
        result={{
          address: "0x0000000000000000000000000000000000000001",
          blockNumber: 123,
          nativeBalance: null,
          errors: ['"USDC" matches multiple verified tokens on Base.'],
          tokenCandidates: [
            {
              chainId: 8453,
              chainName: "Base",
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              symbol: "USDC",
              name: "USD Coin",
              source: "verified",
            },
          ],
          tokens: [
            {
              chainId: 8453,
              chainName: "Base",
              address: "0x4200000000000000000000000000000000000006",
              symbol: "WETH",
              name: "Wrapped Ether",
              decimals: 18,
              rawBalance: "0",
              formattedBalance: "0",
              source: "onchain",
            },
          ],
        }}
      />,
    )

    expect(html).toContain("Multiple verified matches found")
    expect(html).toContain("on-chain")
    expect(html).toContain("Wrapped Ether")
    expect(html).toContain("Confirm the contract address")
  })
})

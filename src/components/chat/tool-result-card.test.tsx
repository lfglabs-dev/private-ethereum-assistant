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

  test("renders railgun freshness and background indexing badges", () => {
    const balanceHtml = renderToStaticMarkup(
      <ToolResultCard
        result={{
          railgun: true,
          status: "success",
          operation: "balance",
          network: "Arbitrum",
          railgunAddress: "0zk1example",
          scan: {},
          balances: [{ tokenAddress: "0x1", symbol: "ETH", amount: "1.2", rawAmount: "1200000000000000000" }],
          freshness: {
            source: "cache",
            updatedAt: "2026-03-15T00:00:00.000Z",
            ageMs: 15_000,
            refreshing: true,
          },
        }}
      />,
    )

    const actionHtml = renderToStaticMarkup(
      <ToolResultCard
        result={{
          railgun: true,
          status: "success",
          operation: "shield",
          network: "Arbitrum",
          railgunAddress: "0zk1example",
          token: "ETH",
          amount: "0.1",
          summary: "Shielded",
          privacyImpact: "public deposit",
          privacyNote: "Deposit is public.",
          txHash: "0x1234",
          explorerUrl: "https://arbiscan.io/tx/0x1234",
          stages: [],
          scan: {},
          balanceIndexing: "pending",
        }}
      />,
    )

    expect(balanceHtml).toContain("Snapshot")
    expect(balanceHtml).toContain("Refreshing in background")
    expect(actionHtml).toContain("Private balance indexing in background")
  })

  test("renders actor-aware swap plans", () => {
    const html = renderToStaticMarkup(
      <ToolResultCard
        result={{
          kind: "swap_result",
          status: "manual_action_required",
          actor: "safe",
          adapter: "cow",
          summary: "Swap 1 ETH for USDC through the Safe actor",
          message: "Continue in the Safe UI for approval and signing.",
          chain: {
            id: 8453,
            name: "Base",
          },
          quote: {
            sellAmount: "1",
            buyAmount: "2500",
            feeAmount: "0.001",
            validTo: "2026-03-15T12:00:00.000Z",
            verified: true,
            slippageBps: 50,
          },
          plan: {
            type: "swap",
            actor: "safe",
            adapter: "cow",
            executionPath: "safe_manual",
            chain: {
              id: 8453,
              name: "Base",
            },
            sell: {
              amount: "1",
              symbol: "ETH",
              name: "Ether",
              address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              kind: "native",
              source: "native",
            },
            buy: {
              amount: "2500",
              symbol: "USDC",
              name: "USD Coin",
              address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              iconUrl:
                "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/logo.png",
              kind: "erc20",
              source: "verified",
            },
            quote: {
              sellAmount: "1",
              buyAmount: "2500",
              feeAmount: "0.001",
              validTo: "2026-03-15T12:00:00.000Z",
              verified: true,
              slippageBps: 50,
            },
            steps: [
              {
                key: "quote",
                label: "Fetch CoW quote",
                status: "complete",
                detail: "2500 USDC estimated output.",
              },
              {
                key: "proposal",
                label: "Continue in Safe",
                status: "pending",
                detail: "Open the Safe UI and use the native CoW swap flow with this quote context.",
              },
            ],
          },
          execution: {
            safeAddress: "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
            safeUILink: "https://app.safe.global/transactions/queue?safe=base:0x4581812Df7500277e3fC72CF93f766DBBd32d371",
          },
        }}
      />,
    )

    expect(html).toContain("Swap 1 ETH for USDC through the Safe actor")
    expect(html).toContain("manual action required")
    expect(html).toContain("You pay")
    expect(html).toContain("You receive")
    expect(html).toContain("-1 ETH")
    expect(html).toContain("+2500 USDC")
    expect(html).toContain("ETH native token icon")
    expect(html).toContain("Ether")
    expect(html).toContain("USD Coin")
    expect(html).toContain("verified quote")
    expect(html).toContain("USDC token icon")
    expect(html).toContain("Continue in Safe")
  })

  test("renders swap execution links", () => {
    const html = renderToStaticMarkup(
      <ToolResultCard
        result={{
          kind: "swap_result",
          status: "executed",
          actor: "eoa",
          adapter: "cow",
          summary: "Swap 1 ETH for USDC on Arbitrum One",
          message: "The swap order was signed and submitted to CoW.",
          chain: {
            id: 42161,
            name: "Arbitrum One",
          },
          quote: {
            sellAmount: "1",
            buyAmount: "2500",
            feeAmount: "0.001",
            validTo: "2026-03-15T12:00:00.000Z",
            verified: true,
            slippageBps: 50,
          },
          plan: {
            type: "swap",
            actor: "eoa",
            adapter: "cow",
            executionPath: "eoa_direct",
            chain: {
              id: 42161,
              name: "Arbitrum One",
            },
            sell: {
              amount: "1",
              symbol: "ETH",
              name: "Ether",
              address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              kind: "native",
              source: "native",
            },
            buy: {
              amount: "2500",
              symbol: "USDC",
              name: "USD Coin",
              address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
              iconUrl:
                "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0xaf88d065e77c8cC2239327C5EDb3A432268e5831/logo.png",
              kind: "erc20",
              source: "verified",
            },
            quote: {
              sellAmount: "1",
              buyAmount: "2500",
              feeAmount: "0.001",
              validTo: "2026-03-15T12:00:00.000Z",
              verified: true,
              slippageBps: 50,
            },
            steps: [],
          },
          execution: {
            orderId:
              "0x43af55e378e215d0bf9a43c540aa10d663498984ad8f9ab5e7d8e0e2ab8f3fefba3cb449bd2b4adddbc894d8697f5170800eadecffffffff",
            txHash: "0xorder",
            approvalTxHash: "0x0e33970c07bd300801cfc1345901769cb6db8516b8d792bb9129919a68a0d6ff",
          },
        }}
      />,
    )

    expect(html).toContain("View order")
    expect(html).toContain("View transaction")
    expect(html).toContain("https://explorer.cow.fi/arb1/orders/")
    expect(html).toContain("https://arbiscan.io/tx/0x0e33970c07bd300801cfc1345901769cb6db8516b8d792bb9129919a68a0d6ff")
  })
})

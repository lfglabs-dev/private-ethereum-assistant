import { createPublicClient, http, type Hex } from "viem"
import { arbitrum } from "viem/chains"
import { ARBITRUM_CONFIG } from "./config"

export const verificationClient = createPublicClient({
  chain: arbitrum,
  transport: http(ARBITRUM_CONFIG.rpcUrl),
})

export async function findRecentTransactionHash(maxBlocksToScan = 40) {
  const latestBlockNumber = await verificationClient.getBlockNumber()

  for (
    let offset = BigInt(0);
    offset < BigInt(maxBlocksToScan);
    offset += BigInt(1)
  ) {
    const block = await verificationClient.getBlock({
      blockNumber: latestBlockNumber - offset,
      includeTransactions: true,
    })

    const transaction = block.transactions.find((candidate) => candidate.to != null)
    if (transaction) {
      return transaction.hash as Hex
    }
  }

  throw new Error(`Could not find a recent Arbitrum transaction in ${maxBlocksToScan} blocks.`)
}

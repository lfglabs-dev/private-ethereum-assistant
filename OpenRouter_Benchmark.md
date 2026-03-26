# OpenRouter Cloud Model Benchmark
Date: 2026-03-25 | OpenRouter | Private Ethereum Assistant

## Summary Table
| Model | Avg Response (s) | Tool Accuracy | Text Quality | Viable? |
|-------|------------------|---------------|--------------|---------|
| qwen/qwen3.5-27b | 19.05s | 8/11 | 10/11 | No |

## Detailed Results
### qwen/qwen3.5-27b

| # | Mode | Test | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |
|---|------|------|--------|------|-----------------|---------------|------------------|-------|------------------|
| 1 | EOA | Swap | Swap 0.0001 ETH for USDC | 11.28s | prepare_swap | Yes | Yes | none | **Swap Quote Summary:**  - **Sell:** 0.0001 ETH - **Buy:** ~0.209122 USDC - **Network:** Arbitrum One - **Fee:** 0.000004 ETH - **Approval Required:** No - **Quote Valid Until:** March 25, 2026  This … |
| 2 | EOA | Send ETH | Send 0.001 ETH to prendrelelead.eth | 28.05s | resolve_ens, send_token | Yes | Yes | none | **Transaction Summary:**  - **Amount:** 0.001 ETH - **To:** prendrelelead.eth (0x90Bc0b43fA89027B2f2df93fA7028357370a026a) - **Network:** Arbitrum One - **From:** 0x578CF10a24D6d0343633B25D435B1fd290d… |
| 3 | EOA | Send ERC-20 | Send 0.5 USDC to prendrelelead.eth | 12.56s | resolve_ens, send_token | Yes | Yes | none | Transaction prepared! Here are the details:  **Send 0.5 USDC to prendrelelead.eth** - Recipient: prendrelelead.eth (0x90Bc0b43fA89027B2f2df93fA7028357370a026a) - Network: Arbitrum One - Amount: 0.5 US… |
| 4 | EOA | Balance | What is the ETH balance of my wallet? | 5.95s | get_balance | Yes | Yes | none | Your wallet (0x4581812Df7500277e3fC72CF93f766DBBd32d371) currently has **0 ETH** on Arbitrum One. |
| 5 | Safe | Swap | Swap 0.0001 ETH for USDC from the Safe | 16.07s | swap_tokens, get_safe_info | Yes | No | Address 0x578CF10a24D6d0343633B25D435B1fd290d2EF26 is not a signer of Safe 0x4581812Df7500277e3fC72CF93f766DBBd32d371 | I attempted to execute the swap, but it failed because no signer key is currently configured for the Safe. The swap requires a signer to submit the transaction to the Safe Transaction Service.  **Safe… |
| 6 | Safe | Send ETH | Send 0.001 ETH from the Safe to prendrelelead.eth | 24.31s | resolve_ens, propose_transaction | Yes | Yes | none | The transaction to send 0.001 ETH to prendrelelead.eth (0x90Bc0b43fA89027B2f2df93fA7028357370a026a) has been created, but it couldn't be auto-signed because the current signer isn't configured for thi… |
| 7 | Safe | Send ERC-20 | Send 0.5 USDC from the Safe to prendrelelead.eth | 36.33s | resolve_ens, propose_transaction | Yes | Yes | none | I've proposed a transaction to send 0.5 USDC from the Safe to prendrelelead.eth (0x90Bc...026a).  **Transaction Details:** - **From:** Safe 0x4581812Df7500277e3fC72CF93f766DBBd32d371 - **To:** prendre… |
| 8 | Safe | Balance | What is the ETH balance of the Safe? | 6.14s | get_safe_info | No | Yes | none | The Safe (0x4581812Df7500277e3fC72CF93f766DBBd32d371) has an ETH balance of **0.005 ETH**. |
| 9 | Railgun | Shield | Shield 0.001 ETH into Railgun | 42.88s | railgun_shield | Yes | Yes | none | ✅ **Shielding Complete**  **Transaction Details:** - **Amount:** 0.001 ETH - **Network:** Arbitrum One - **Status:** Confirmed - **Tx Hash:** `0xcc4af7a9c4191832c747a7119fd128fbb509b7ecfa348edc49253dd… |
| 10 | Railgun | Send private | Send 0.0005 private ETH to myself | 18.91s | railgun_balance, railgun_unshield | No | Yes | none | I can see you have 0.001 ETH in your private Railgun balance, which is enough to send 0.0005 ETH. However, the transaction requires some setup first:  **Railgun Setup Required:** 1. Set a BIP39 seed p… |
| 11 | Railgun | Unshield | Unshield the remaining ETH from Railgun | 7.11s | railgun_balance | No | Yes | none | I can see you have 0.001 ETH shielded in Railgun on Arbitrum.  To unshield this to a public address, I need to know where you'd like to receive it. Please provide:  **Recipient address** (0x...) or **… |

## Conclusions
- Best overall model in this run: qwen/qwen3.5-27b.
- Tool-use score favored exact matches to the plan's expected tool sequence for each prompt.
- Viability here means at least 75% tool-routing wins and 75% text-quality wins across all 11 prompts.
# MacBook Air M1 16GB — Local LLM Benchmark
Date: 2026-03-18 | Ollama | Private Ethereum Assistant

## Hardware
- CPU: Apple M1
- Memory: 16GB
- macOS: 26.3.1

## Summary Table
| Model | Avg Response (s) | Tool Accuracy | Text Quality | Viable? |
|-------|------------------|---------------|--------------|---------|
| qwen2.5:3b | 11.81s | 2/4 | 3/4 | No |
| llama3.2:3b | 10.91s | 3/4 | 1/4 | No |
| gemma3:4b | 0.15s | 0/4 | 0/4 | No |

## Detailed Results
### qwen2.5:3b

| Prompt # | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |
|----------|--------|------|-----------------|---------------|------------------|-------|------------------|
| 1 | What is the address of vitalik.eth? | 20.15s | reverse_resolve_ens | No | No | none | The address of the ENS name `vitalik.eth` is `0x0000000000000000000000000000000 |
| 2 | What is the ETH balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045? | 8.04s | get_balance | Yes | Yes | none | The ETH balance of the address `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` is `0.059994863739028677 ETH`. Let me know if you need any more details or have another address you'd like to check. |
| 3 | Explain what Railgun is in one sentence. | 1.54s | none | Yes | Yes | none | Railgun is a privacy protocol for Ethereum that allows users to shield their assets so that transactions are off-chain, making them private and harder to trace. |
| 4 | Send 0.001 ETH to fricoben.eth | 17.53s | prepare_eoa_transfer | No | Yes | none | The transaction to send 0.001 ETH to `fricoben.eth` (0x8CE19266498AcC8cE67e8D33ae479cE7932a9fE6) has been prepared for you. Here are the details:  - Sender: `0x000000000001c30d5Bf2c1aB85384CFb21A5894a` - Recipient (as re |

### llama3.2:3b

| Prompt # | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |
|----------|--------|------|-----------------|---------------|------------------|-------|------------------|
| 1 | What is the address of vitalik.eth? | 22.08s | resolve_ens | Yes | No | Invalid input for tool resolve_ens: Type validation failed: Value: {"names":"[\"vitalik.eth\"]"}. Error message: [   {     "expected": "array",     "code": "invalid_type",     "path": [       "names"     ],     "message": "Invalid input: expected array, received string"   } ] | To resolve the ENS name "vitalik.eth", I will try it as a single-element array:  {"name": "resolve_ens", "parameters": {"names": "[\"vitalik\.eth\"]"}} |
| 2 | What is the ETH balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045? | 9.55s | get_balance | Yes | Yes | none | The ETH balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 is 0.059994863739028677 ETH. |
| 3 | Explain what Railgun is in one sentence. | 5.14s | none | Yes | No | none | { "name": "resolve_ens", "parameters": {"names": "[\"vitalik\.eth\"]"}} |
| 4 | Send 0.001 ETH to fricoben.eth | 6.88s | prepare_eoa_transfer | No | No | none | It looks like you need to resolve the ENS name "fricoben.eth" first. Let's resolve it to an Ethereum address.   You can resolve the ENS name "fricoben.eth" by using the `resolve_ens` tool. Please wait for the result... � |

### gemma3:4b

| Prompt # | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |
|----------|--------|------|-----------------|---------------|------------------|-------|------------------|
| 1 | What is the address of vitalik.eth? | 0.24s | none | No | No | registry.ollama.ai/library/gemma3:4b does not support tools | Error: registry.ollama.ai/library/gemma3:4b does not support tools |
| 2 | What is the ETH balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045? | 0.12s | none | No | No | registry.ollama.ai/library/gemma3:4b does not support tools | Error: registry.ollama.ai/library/gemma3:4b does not support tools |
| 3 | Explain what Railgun is in one sentence. | 0.12s | none | No | No | registry.ollama.ai/library/gemma3:4b does not support tools | Error: registry.ollama.ai/library/gemma3:4b does not support tools |
| 4 | Send 0.001 ETH to fricoben.eth | 0.12s | none | No | No | registry.ollama.ai/library/gemma3:4b does not support tools | Error: registry.ollama.ai/library/gemma3:4b does not support tools |


## Conclusions
- Best overall model in this run: llama3.2:3b.
- Tool-use score favored exact matches to the plan's expected tool sequence for each prompt.
- Viability here means at least 3/4 tool-routing wins and 3/4 text-quality wins in the real agent flow.

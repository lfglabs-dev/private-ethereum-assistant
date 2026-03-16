# Private Ethereum Assistant

Private Ethereum Assistant is a local-first Next.js chat app for interacting with EVM chains in natural language.

It can:
- read balances, transactions, and ENS data on the selected network
- prepare and send normal wallet transactions from a configured EOA
- inspect and propose Safe transactions
- run Railgun test flows on Arbitrum

## Runtime configuration

The app uses UI onboarding for runtime settings, with secrets saved server-side.

Stored in browser local storage:
- selected LLM provider
- local model base URL
- provider-specific model names
- selected RPC and chain ID
- Safe address, Safe RPC, and chain ID
- wallet approval thresholds
- Railgun RPC, POI nodes, explorer URL, mnemonic, and timing settings

Stored in `.env.local` on the machine running the app:
- `EOA_PRIVATE_KEY`
- `SAFE_SIGNER_PRIVATE_KEY`
- `SAFE_API_KEY`

Security note:
- `.env.local` private keys are still sensitive
- use dedicated low-value wallets
- `Delete all` in settings clears browser prefs only

## LLM providers

The app supports two interchangeable runtime backends:

### OpenRouter

Use `OpenRouter` when you want the practical default backend.

Runtime behavior:
- base URL is `https://openrouter.ai/api/v1`
- auth uses the developer/test key from `.env.tianjin`
- the recommended model is `qwen/qwen3.5-27b`
- prompts and tool outputs leave the machine for inference

### Local

Use `Local` for Ollama, LM Studio, or any other OpenAI-compatible local endpoint.

Runtime behavior:
- enter the local base URL in onboarding or settings
- choose the local model name separately from the OpenRouter model
- no repo env editing is needed to switch back and forth

## Getting started

1. Install dependencies:

```bash
bun install
```

2. Start the app with the developer/test secrets from `.env.tianjin`:

```bash
dotenvx run -f .env.tianjin -- bun dev
```

3. Open the app.

4. Complete onboarding in the UI.

Recommended first-run path:
- choose `Local`
- use your local model name
- enter your EOA private key in the `Keys` step
- confirm or edit the default Safe, network, and Railgun values

## Safe and Railgun notes

### Safe

- Safe config is independent from the selected read/send network
- the app can inspect the configured Safe without a signer key
- proposing from the app requires a Safe owner key and `SAFE_API_KEY` only if you want automatic signing/submission
- leaving the Safe signer key blank keeps the flow manual in the Safe UI

### Railgun

- Railgun settings are edited in the same runtime settings UI
- the default Railgun network remains Arbitrum
- leaving the Railgun mnemonic blank derives one from the configured EOA key for testing
- shielding is public; later Railgun transfers can be private

## Testing

Unit tests are intentionally limited to schema and serialization logic:

```bash
bun test
```

Browser E2E uses the onboarding flow and OpenRouter:

```bash
dotenvx run -f .env.tianjin -- bun test:e2e:browser
```

The browser suite verifies:
- first-run onboarding
- OpenRouter-backed chat success
- provider switching between `OpenRouter` and `Local`
- persistence across reload
- edit flow
- delete-all flow

Tool-level E2E tests remain available separately:

```bash
dotenvx run -f .env.tianjin -- bun test:e2e:tools
```

## Troubleshooting

If OpenRouter requests fail:
- confirm you started the app with `dotenvx run -f .env.tianjin`
- confirm `.env.tianjin` contains a valid `OPEN_ROUTER_KEY`

If Local requests fail:
- confirm your local model server is running
- confirm the Local base URL includes the correct `/v1` path when required
- confirm the configured local model name matches the model exposed by your server

If onboarding keeps reappearing:
- check whether the browser profile blocks local storage
- open DevTools and confirm local storage is available for the app origin

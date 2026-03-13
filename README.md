# Private Ethereum Assistant

Private Ethereum Assistant is a local-first Next.js chat app for interacting with EVM chains in natural language.

It can:
- read balances, transactions, and ENS data on the selected network
- prepare and send normal wallet transactions from a configured EOA
- inspect and propose Safe transactions
- run Railgun test flows on Arbitrum

## Runtime configuration

The app now uses a browser-first onboarding flow.

What changed:
- first visit shows onboarding inside the app
- user runtime settings are stored in browser local storage
- `.env.local` is no longer required for normal app use
- provider switching between `OpenRouter` and `Local` happens in the UI
- Safe, EOA, network, and Railgun settings are edited in the same settings drawer later

What is stored in the browser:
- selected LLM provider
- local model base URL
- provider-specific model names
- selected RPC and chain ID
- Safe address, Safe RPC, and optional Safe signer private key
- EOA private key
- Railgun RPC, POI nodes, explorer URL, mnemonic, and timing settings

Security note:
- browser-stored private keys are sensitive
- use dedicated low-value wallets
- use `Delete all` in settings if the browser profile is shared

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

3. Open the app in a fresh browser profile.

4. Complete onboarding in the UI.

Recommended first-run path:
- choose `OpenRouter`
- use model `qwen/qwen3.5-27b`
- enter your EOA private key
- confirm or edit the default Safe, network, and Railgun values

## Safe and Railgun notes

### Safe

- Safe config is independent from the selected read/send network
- the app can inspect the configured Safe without a signer key
- proposing from the app requires a Safe owner key only if you want automatic signing/submission
- leaving the Safe signer key blank keeps the flow manual in the Safe UI

### Railgun

- Railgun settings are edited in the same browser runtime config
- the default Railgun network remains Arbitrum
- leaving the Railgun mnemonic blank derives one from the configured EOA key for testing
- shielding is public; later Railgun transfers can be private

## Testing

Unit tests are intentionally limited to schema and serialization logic:

```bash
bun test
```

Browser E2E uses the browser-first onboarding flow and OpenRouter:

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

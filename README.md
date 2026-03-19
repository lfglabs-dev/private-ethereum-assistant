# Private Ethereum Assistant

Private Ethereum Assistant is a local-first Next.js chat app for interacting with EVM chains in natural language.

It can:
- read balances, transactions, and ENS data on the selected network
- prepare and send normal wallet transactions from a configured EOA (Externally Owned Account — a standard Ethereum wallet controlled by a private key)
- inspect and propose Safe (multisig) transactions
- run Railgun privacy test flows on Arbitrum

## Prerequisites

Install the following before starting:

| Tool | What it does | Install |
|------|-------------|---------|
| [Bun](https://bun.sh) | JavaScript runtime and package manager | `curl -fsSL https://bun.sh/install \| bash` |
| [Ollama](https://ollama.com) | Local LLM server (Normal mode only) | Download from ollama.com or `brew install ollama` |
| [dotenvx](https://dotenvx.com) | Encrypted env loader for OpenRouter config (Developer mode only) | `brew install dotenvx/brew/dotenvx` |

The project runs on macOS. On Linux, everything works except the automatic browser-open step (you will need to open `http://localhost:3000` manually).

## Getting started

Install dependencies first (one-time):

```bash
bun install --frozen-lockfile
```

Then choose **one** of the two modes below.

### Normal mode (recommended for first-time users)

Normal mode runs the LLM locally via Ollama. No external API keys are needed.

1. Start the app:

```bash
bun run local
```

2. The launcher will automatically:
   - start Ollama if it is not already running
   - pull the default model (`llama3.2:3b`) if not already downloaded
   - build the macOS Keychain helper if needed
   - start the Next.js dev server on `http://localhost:3000`
   - open the browser

3. Complete the onboarding wizard in the browser:
   - **Provider:** select `Local`
   - **Base URL:** `http://localhost:11434/v1` (pre-filled for Ollama)
   - **Model:** `llama3.2:3b`
   - **Keys:** paste your EOA private key (the hex private key of the Ethereum wallet you want the assistant to use)

You can change any of these later in the settings panel.

### Developer mode

Developer mode uses OpenRouter (a cloud LLM gateway) instead of a local model. It loads developer-only secrets from the repo file `.env.tianjin` via dotenvx, including `APP_MODE`, `OPEN_ROUTER_KEY`, `EOA_PRIVATE_KEY`, and any optional Safe credentials present there. You need the dotenvx decryption key (ask a team member if you don't have it).

1. Start the app:

```bash
dotenvx run -f .env.tianjin -- bun run dev -- --developer-mode
```

2. Open `http://localhost:3000` in your browser.

3. Start using the app. Developer-mode wallet and Safe secrets come from `.env.tianjin`; standard mode secrets are still stored in the macOS Keychain.

## Runtime configuration

The app uses a UI onboarding wizard for runtime settings. Secrets are saved server-side.

**Stored in browser local storage** (non-sensitive preferences):
- selected LLM provider and model names
- local model base URL
- selected RPC endpoint and chain ID
- Safe address, Safe RPC, and chain ID
- wallet approval thresholds
- Railgun RPC, POI (Proof of Innocence) nodes, explorer URL, mnemonic, and timing settings

**Stored in the macOS Keychain on the machine**:
- `EOA_PRIVATE_KEY` — the Ethereum wallet private key
- `SAFE_SIGNER_PRIVATE_KEY` — the Safe multisig signer key (optional)
- `SAFE_API_KEY` — Safe Transaction Service API key (optional)

**Security notes:**
- Secrets never enter browser storage
- Use dedicated low-value wallets for local testing
- "Delete all" in settings clears browser preferences only, not Keychain entries

## LLM providers

The app supports two interchangeable backends. You can switch between them at any time in settings.

### OpenRouter

Cloud-based inference via [OpenRouter](https://openrouter.ai). Use this when you want the practical default backend (Developer mode).

- Base URL: `https://openrouter.ai/api/v1`
- Auth: uses the developer/test key from `.env.tianjin`
- Recommended model: `qwen/qwen3.5-27b`
- Prompts and tool outputs leave your machine for inference
- Ollama is not required

### Local

Fully offline inference via Ollama, LM Studio, or any OpenAI-compatible local server.

- The launcher (`bun run local`) manages Ollama automatically when using the default `localhost:11434` endpoint
- If you use a different local server, make sure it is running before starting the app
- Enter your server's base URL and model name in onboarding or settings
- No repo env editing is needed to switch between Local and OpenRouter

## Safe and Railgun

### Safe (multisig wallet)

[Safe](https://safe.global) is a smart-contract wallet requiring multiple signatures to execute transactions.

- Safe config is independent from the selected read/send network
- The app can inspect a configured Safe without a signer key
- Proposing transactions requires a Safe owner key; `SAFE_API_KEY` is only needed for automatic signing/submission to the Safe Transaction Service
- Leaving the Safe signer key blank keeps the flow manual (you confirm in the Safe UI)

### Railgun (privacy)

[Railgun](https://railgun.org) enables private transfers on EVM chains using zero-knowledge proofs.

- Railgun settings are edited in the same settings UI
- The default Railgun network is Arbitrum
- Leaving the Railgun mnemonic blank derives one from your configured EOA key (for testing only)
- Shielding (depositing into Railgun) is a public on-chain transaction; subsequent Railgun-to-Railgun transfers are private

## Testing

Unit tests cover schema and serialization logic:

```bash
bun test
```

Browser E2E tests use the onboarding flow with OpenRouter (requires `.env.tianjin`):

```bash
dotenvx run -f .env.tianjin -- bun test:e2e:browser
```

Store any required developer-mode wallet or Safe credentials in `.env.tianjin` before running the suite.

The browser suite verifies:
- first-run onboarding
- OpenRouter-backed chat success
- provider switching between OpenRouter and Local
- persistence across reload
- edit flow
- delete-all flow

Tool-level E2E tests:

```bash
dotenvx run -f .env.tianjin -- bun test:e2e:tools
```

These tests also read developer-mode wallet and Safe credentials from `.env.tianjin`.

## Troubleshooting

**OpenRouter requests fail:**
- confirm you started the app with `dotenvx run -f .env.tianjin`
- confirm `.env.tianjin` contains a valid `OPEN_ROUTER_KEY`
- if startup says "Missing local dependencies", run `bun install --frozen-lockfile`

**Local requests fail:**
- confirm your local model server is running (`ollama serve` or equivalent)
- confirm the Local base URL matches the API root exposed by your server
- confirm the model name matches an available model (`ollama list` to check)

**Onboarding keeps reappearing:**
- check whether your browser profile blocks local storage
- open DevTools > Application > Local Storage and confirm it is writable for the app origin

# Private Ethereum Assistant

Private Ethereum Assistant is a local chat app for interacting with EVM chains in natural language.

It can:
- read balances, transactions, and ENS data
- prepare and send normal wallet transactions from a local EOA
- propose Safe transactions
- test Railgun flows on Arbitrum

The intended operating model is:
- UI runs locally with Next.js
- model runs locally or behind an OpenAI-compatible API
- signing keys live in your local `.env.local`

## Table of contents

- [What this repo does](#what-this-repo-does)
- [How transaction modes work](#how-transaction-modes-work)
- [Prerequisites](#prerequisites)
- [Model setup](#model-setup)
- [Repo setup](#repo-setup)
- [Environment configuration](#environment-configuration)
- [Running the app](#running-the-app)
- [Using the app locally](#using-the-app-locally)
- [Safe transaction walkthrough](#safe-transaction-walkthrough)
- [Normal transaction walkthrough](#normal-transaction-walkthrough)
- [Railgun notes](#railgun-notes)
- [Testing](#testing)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)

## What this repo does

This app exposes a chat interface backed by tools in the repo. The model decides when to call those tools.

Main capabilities:
- `get_balance`, `get_portfolio`, `get_transaction`
- `resolve_ens`, `reverse_resolve_ens`
- `prepare_eoa_transfer`, `send_eoa_transfer`
- `get_safe_info`, `get_pending_transactions`, `propose_transaction`
- Railgun tools for test flows on Arbitrum

Important implementation details:
- ENS resolution always happens against Ethereum mainnet
- read tools and normal EOA sends use the network selected in the UI
- Safe tools use the Safe config from environment variables, not the UI network selector
- the current Safe integration is wired to the Base Safe Transaction Service

## How transaction modes work

### 1. Normal transactions

These are direct wallet transactions signed by your local EOA.

Behavior:
- uses `EOA_PRIVATE_KEY`
- supports native token sends and ERC-20 transfers
- first prepares the transfer
- shows the user a summary and gas estimate
- waits for explicit confirmation
- signs and broadcasts only after confirmation

This is the right mode for:
- `Send 0.001 ETH to vitalik.eth`
- `Send 5 USDC to 0x...`

### 2. Safe transactions

These are Safe proposals, not direct sends from the app.

Behavior:
- uses the Safe configured in `SAFE_ADDRESS`
- prepares a Safe transaction proposal
- if `SAFE_SIGNER_PRIVATE_KEY` is configured, signs and submits the proposal
- if `SAFE_SIGNER_PRIVATE_KEY` is not configured, returns manual instructions plus a Safe UI link
- final approval/execution still happens through Safe owners

Important:
- use a Base Safe
- set `CHAIN_ID=8453`
- set `RPC_URL` to a Base RPC
- `SAFE_SIGNER_PRIVATE_KEY`, if used, must belong to a Safe owner

## Prerequisites

You need:
- `bun`
- Node-compatible local development environment
- a model endpoint that speaks the OpenAI chat API format
- a funded EOA if you want to send normal transactions
- a Safe on Base if you want to test Safe proposals

Optional but recommended:
- `ollama` for local models
- a dedicated testing wallet instead of a personal production wallet

## Model setup

The app uses an OpenAI-compatible endpoint. That means the model backend does not need to be OpenAI itself, but it must expose a compatible API.

The repo reads:
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`

### Option A: Ollama

This is the easiest local setup.

1. Install Ollama:

```bash
brew install ollama
```

2. Start the Ollama server:

```bash
ollama serve
```

3. Pull a model:

```bash
ollama pull qwen3:8b
```

4. Use this in `.env.local`:

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:8b
LLM_TIMEOUT_MS=180000
```

Notes:
- `qwen3:8b` is the current default in the app
- you can swap in larger models if your machine can handle them
- if the model name in `.env.local` does not exactly match the model installed in Ollama, requests will fail

### Option B: LM Studio

If you prefer LM Studio:

1. Load a chat-capable model in LM Studio
2. Start its local server
3. Point the app to the LM Studio base URL, usually something like:

```bash
LLM_BASE_URL=http://127.0.0.1:1234/v1
LLM_MODEL=your-loaded-model-name
```

The exact model name must match what LM Studio exposes.

### Option C: Another OpenAI-compatible server

You can also use:
- vLLM
- LocalAI
- LiteLLM proxy
- a self-hosted OpenAI-compatible gateway

Set:

```bash
LLM_BASE_URL=http://your-host:port/v1
LLM_MODEL=your-model-name
```

Requirements:
- chat completions must be supported
- streaming should be supported for the best UX

## Repo setup

### 1. Install bun

If you do not already have bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

Restart your shell after installation if needed.

### 2. Install dependencies

From the repo root:

```bash
bun install
```

### 3. Create your local env file

```bash
cp .env.local.example .env.local
```

### 4. Edit `.env.local`

Fill in at least:
- model settings
- default network settings
- Safe address if using Safe features
- EOA private key if using normal transactions

### 5. Optional shortcut script

If you are on macOS with Homebrew and want a one-command local setup for Ollama, you can also run:

```bash
./setup.sh
```

What it does:
- checks for Ollama
- starts Ollama if needed
- pulls the configured model
- installs bun dependencies
- creates `.env.local` from `.env.local.example` if missing
- starts the dev server

What it does not do:
- install bun
- fill in your private keys or Safe address for you

## Environment configuration

This repo uses `.env.local` for local development.

### Minimal config for read-only usage

If you only want to run the chat UI and query chain data:

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:8b
LLM_TIMEOUT_MS=180000

RPC_URL=https://mainnet.base.org
CHAIN_ID=8453
SAFE_ADDRESS=0xYourBaseSafeAddress
```

With that config you can:
- inspect balances
- look up transactions
- resolve ENS names
- inspect Safe info and pending Safe transactions

### Config for normal transactions

Add:

```bash
EOA_PRIVATE_KEY=0xyour_private_key
```

Behavior:
- this key signs normal EOA transfers
- it is also used by some Railgun test flows unless you provide separate Railgun inputs

Notes:
- `WALLET_PRIVATE_KEY` is still accepted as a fallback in parts of the codebase
- prefer `EOA_PRIVATE_KEY` going forward
- fund this wallet on whichever network you want to transact on

### Config for automatic Safe proposals

Add:

```bash
SAFE_SIGNER_PRIVATE_KEY=0xyour_safe_owner_private_key
SAFE_API_KEY=
```

Behavior:
- if `SAFE_SIGNER_PRIVATE_KEY` is set, the app can sign and submit Safe proposals automatically
- if omitted, the app falls back to manual creation in the Safe UI
- `SAFE_API_KEY` is optional

Requirements:
- the signer must be an owner on the configured Safe
- the signer needs enough native token to pay proposal-related gas/RPC costs

### Config for Railgun testing

Optional:

```bash
RAILGUN_RPC_URL=https://arb1.arbitrum.io/rpc
RAILGUN_CHAIN_ID=42161
RAILGUN_EXPLORER_TX_URL=https://arbiscan.io/tx/
RAILGUN_POI_NODE_URLS=https://ppoi-agg.horsewithsixlegs.xyz
RAILGUN_MNEMONIC=
RAILGUN_WALLET_CREATION_BLOCK=56109834
RAILGUN_SCAN_TIMEOUT_MS=180000
RAILGUN_POLLING_INTERVAL_MS=15000
```

### Full example `.env.local`

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:8b
LLM_TIMEOUT_MS=180000

# Default network for reads and normal transactions.
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453

# Safe configuration. Current integration expects a Base Safe.
SAFE_ADDRESS=0xYourBaseSafeAddress
SAFE_API_KEY=
SAFE_SIGNER_PRIVATE_KEY=0xyour_safe_owner_private_key

# Required for normal EOA transactions.
EOA_PRIVATE_KEY=0xyour_eoa_private_key

# Optional Railgun testing configuration.
RAILGUN_RPC_URL=https://arb1.arbitrum.io/rpc
RAILGUN_CHAIN_ID=42161
RAILGUN_EXPLORER_TX_URL=https://arbiscan.io/tx/
RAILGUN_POI_NODE_URLS=https://ppoi-agg.horsewithsixlegs.xyz
RAILGUN_MNEMONIC=
RAILGUN_WALLET_CREATION_BLOCK=56109834
RAILGUN_SCAN_TIMEOUT_MS=180000
RAILGUN_POLLING_INTERVAL_MS=15000
```

## Running the app

Start your model backend first, then run:

```bash
bun dev
```

Open:

```text
http://localhost:3000
```

The app has:
- a chat interface
- a network selector in the UI
- tool-backed transaction flows

## Using the app locally

### First things to try

Start with read-only prompts:
- `Show my Safe info`
- `What are the pending Safe transactions?`
- `What is the ETH balance of vitalik.eth?`
- `Show the portfolio for 0x...`

Then move to transaction prompts only after you are sure your env is correct.

### Network selection

Read tools and normal transactions use the network selected in the UI.

How it works:
- initial value comes from `CHAIN_ID` and `RPC_URL`
- you can change network inside the app
- the selected network is used for balance reads and EOA sends
- Safe tools do not follow that UI switch; they use the configured Safe env values

### ENS behavior

ENS always resolves using Ethereum mainnet.

Practical effect:
- `prepare_eoa_transfer` can take `vitalik.eth`
- Safe proposals require a resolved `0x...` address internally, so the assistant resolves ENS before using Safe tools

## Safe transaction walkthrough

This is the expected local workflow for Safe.

### Step 1: Configure Safe values

In `.env.local`:

```bash
RPC_URL=https://mainnet.base.org
CHAIN_ID=8453
SAFE_ADDRESS=0xYourBaseSafeAddress
SAFE_SIGNER_PRIVATE_KEY=0xyour_safe_owner_private_key
```

If you do not want automatic proposal signing, leave `SAFE_SIGNER_PRIVATE_KEY` blank.

### Step 2: Start the app

```bash
bun dev
```

### Step 3: Verify Safe access

Ask:

```text
Show my Safe info
```

You should see:
- Safe address
- owners
- threshold
- nonce
- ETH balance

### Step 4: Check pending proposals

Ask:

```text
What are the pending Safe transactions?
```

You should get:
- Safe tx hashes
- recipient addresses
- confirmation counts
- Safe UI link

### Step 5: Propose a new Safe transaction

Examples:

```text
Propose sending 0.01 ETH from the Safe to vitalik.eth
```

```text
Propose approving 1000 USDC from the Safe for 0xSpenderAddress
```

Possible outcomes:

1. Automatic proposal mode
   - happens when `SAFE_SIGNER_PRIVATE_KEY` is configured and valid
   - app signs and submits the proposal
   - returns Safe tx hash, proposer address, confirmation count, and Safe UI link

2. Manual proposal mode
   - happens when `SAFE_SIGNER_PRIVATE_KEY` is missing
   - app returns transaction details and tells you to create/sign it in the Safe UI yourself

### Safe gotchas

- the Safe integration is currently meant for Base
- if your Safe signer is not an owner, proposal signing will fail
- if ENS resolution fails, Safe proposal creation stops instead of guessing
- a Safe proposal is not the same as execution; other owners may still need to sign

## Normal transaction walkthrough

This is the expected local workflow for a normal wallet transfer.

### Step 1: Configure the signer

In `.env.local`:

```bash
EOA_PRIVATE_KEY=0xyour_private_key
```

Fund that address on the network you want to use.

### Step 2: Start the app

```bash
bun dev
```

### Step 3: Select the target network

Use the network selector in the UI.

Examples:
- Base
- Arbitrum
- Ethereum mainnet
- custom RPC + chain ID

### Step 4: Ask for a send

Examples:

```text
Send 0.001 ETH to vitalik.eth
```

```text
Send 5 USDC to 0xabc...
```

### Step 5: Review the prepared transaction

The app should first show:
- sender
- recipient
- amount
- asset type
- estimated gas

It should then ask for confirmation.

### Step 6: Confirm explicitly

Reply with an explicit confirmation such as:

```text
Yes, send it
```

Only after that should the app sign and broadcast the transfer.

### Step 7: Wait for the result

Successful sends return a lifecycle that includes:
- estimating gas
- building
- signing
- broadcasting
- waiting for confirmation
- confirmed

The final result should include:
- tx hash
- explorer URL when available
- receipt summary

### Normal transaction gotchas

- if `EOA_PRIVATE_KEY` is missing, sends cannot start
- if the wallet lacks native gas token, the app returns an insufficient balance error
- ERC-20 transfers need enough token balance and enough native token for gas

## Railgun notes

Railgun support is included for testing, separately from Safe and normal transactions.

Behavior:
- runs on Arbitrum configuration
- can shield, transfer privately, and unshield
- deposit/shield transactions are public
- later Railgun transfers can be private

You do not need Railgun configured to use the rest of the app.

## Testing

### Unit tests

```bash
bun test
```

### Tool E2E tests

```bash
bun test:e2e:tools
```

These tests may hit live RPC endpoints and may require:
- funded signers
- valid `.env` configuration

### Browser E2E tests

```bash
bun test:e2e:browser
```

## Security notes

This repo is meant for local use, but it still handles real keys.

Recommended practices:
- use a dedicated test wallet
- do not reuse a production Safe owner key unless you intentionally accept that risk
- do not commit `.env.local`
- keep only small balances in testing wallets
- verify the selected network before confirming a send
- verify the recipient and token contract before approving or transferring

## Troubleshooting

### Model fails to respond

Check:
- model server is running
- `LLM_BASE_URL` ends with `/v1` when required by your backend
- `LLM_MODEL` matches the name served by your backend
- timeout is high enough for your local machine

### Safe proposal falls back to manual mode

Expected if:
- `SAFE_SIGNER_PRIVATE_KEY` is empty

Unexpected if:
- signer key is invalid
- signer is not a Safe owner
- Safe RPC/service request failed

### Normal sends do not work

Check:
- `EOA_PRIVATE_KEY` is present
- the wallet has enough native token for gas
- token address is correct for ERC-20 transfers
- the selected UI network matches the wallet funds you expect

### ENS names fail

Check:
- ENS name actually exists on Ethereum mainnet
- your network RPC issue is not being confused with ENS resolution

### Safe setup works but wrong network is used

Remember:
- Safe tools use env-based Safe config
- read tools and normal sends use the UI-selected network

That split is intentional in the current implementation.

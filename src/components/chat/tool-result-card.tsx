"use client"

import { useState } from "react"
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CircleDot,
  ExternalLink,
  Hash,
  Info,
  Loader2,
  Shield,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ActionDetailRow,
  ActionResultCard,
  ActionStepList,
} from "@/components/ui/action-result"
import { TokenAvatar } from "@/components/ui/token-avatar"
import { cn } from "@/lib/utils"

type ToolResultCardProps = {
  result: unknown
  preliminary?: boolean
  onSendMessage?: (text: string) => void
}

function formatAgeMs(value: unknown) {
  const ageMs =
    typeof value === "number" && Number.isFinite(value) ? Math.max(value, 0) : null

  if (ageMs == null) {
    return null
  }

  if (ageMs < 1_000) {
    return "just now"
  }

  if (ageMs < 60_000) {
    return `${Math.round(ageMs / 1_000)}s ago`
  }

  return `${Math.round(ageMs / 60_000)}m ago`
}

type TransactionPreviewData = {
  kind: "transaction_preview"
  status: "awaiting_confirmation" | "awaiting_local_approval" | "aborted"
  summary: string
  message: string
  chain: { id: number; name: string; nativeSymbol: string }
  confirmationId?: string
  sender?: string
  recipient?: string
  recipientInput?: string
  resolvedEnsName?: string
  asset?: { type: "ETH" | "ERC20"; symbol: string; tokenAddress?: string; iconUrl?: string }
  amount?: string
  balance?: { asset: string; amount: string }
  gasEstimate?: {
    gasLimit: string
    maxFeePerGasGwei: string
    maxPriorityFeePerGasGwei?: string
    gasCostNative: string
  }
  approval?: {
    required: boolean
    state: "not_required" | "pending" | "approved" | "rejected"
    thresholdAmount?: string
    thresholdAssetSymbol?: string
    reason?: "single_transfer_threshold" | "session_cumulative_threshold"
    cumulativeAmount?: string
    summary: {
      recipient: string
      asset: string
      amount: string
      network: string
      estimatedGas: string
    }
  }
}

type TransactionErrorData = {
  kind: "transaction_error" | "tool_error"
  summary?: string
  message?: string
  error?: string
  toolName?: string
}

type ProgressStep = {
  key: string
  label: string
  status: "pending" | "in_progress" | "complete" | "error"
  detail?: string
}

type TransactionProgressData = {
  kind: "transaction_progress"
  status:
    | "estimating_gas"
    | "building"
    | "signing"
    | "broadcasting"
    | "waiting_for_confirmation"
    | "confirmed"
    | "reverted"
    | "error"
  summary: string
  message: string
  chain: { id: number; name: string; nativeSymbol: string }
  sender: string
  recipient: string
  recipientInput: string
  resolvedEnsName?: string
  asset: { type: "ETH" | "ERC20"; symbol: string; tokenAddress?: string; iconUrl?: string }
  amount: string
  steps: ProgressStep[]
  txHash?: string
  explorerUrl?: string
  receipt?: {
    status: "success" | "reverted"
    blockNumber: number
    gasUsed: string
    effectiveGasPriceGwei?: string
    gasCostNative?: string
  }
  revertReason?: string
  error?: string
}

type SwapResultData = {
  kind: "swap_result"
  status:
    | "awaiting_confirmation"
    | "awaiting_local_approval"
    | "aborted"
    | "executed"
    | "proposed"
    | "manual_action_required"
    | "unsupported"
    | "input_required"
    | "error"
  actor: string
  summary: string
  message: string
  confirmationId?: string
  approval?: {
    required: boolean
    state: "not_required" | "pending" | "approved" | "rejected"
    thresholdAmount?: string
    thresholdAssetSymbol?: string
    reason?: "single_transfer_threshold" | "session_cumulative_threshold"
    cumulativeAmount?: string
  }
  chain?: {
    id?: number
    name?: string
  }
  quote?: Record<string, unknown>
  plan?: Record<string, unknown>
  execution?: Record<string, unknown>
  candidates?: unknown[]
  error?: string
}

const CHAIN_EXPLORER_BY_ID: Partial<Record<number, string>> = {
  1: "https://etherscan.io",
  10: "https://optimistic.etherscan.io",
  56: "https://bscscan.com",
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  43114: "https://snowtrace.io",
}

const COW_EXPLORER_NETWORK_BY_CHAIN_ID: Partial<Record<number, string>> = {
  1: "mainnet",
  10: "optimism",
  56: "bnb",
  137: "polygon",
  8453: "base",
  42161: "arb1",
  43114: "avax",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getExplorerTxUrl(chainId: number, hash?: string) {
  if (!hash) return null
  const explorerBaseUrl = CHAIN_EXPLORER_BY_ID[chainId]
  return explorerBaseUrl ? `${explorerBaseUrl}/tx/${hash}` : null
}

function getCowExplorerOrderUrl(chainId: number, orderId?: string) {
  if (!orderId) return null
  const networkPath = COW_EXPLORER_NETWORK_BY_CHAIN_ID[chainId]
  return networkPath ? `https://explorer.cow.fi/${networkPath}/orders/${orderId}` : null
}

function getSourceLabel(source: unknown) {
  if (source === "verified" || source === "trustwallet") return "verified"
  if (source === "native") return "native"
  return "on-chain"
}

function TokenRow({
  token,
  showBalance = true,
}: {
  token: Record<string, unknown>
  showBalance?: boolean
}) {
  const address = String(token.address ?? "")
  const symbol = String(token.symbol ?? address ?? "Unknown")
  const name = typeof token.name === "string" ? token.name : undefined
  const chainName = typeof token.chainName === "string" ? token.chainName : undefined
  const iconUrl = typeof token.iconUrl === "string" ? token.iconUrl : undefined
  const sourceLabel = getSourceLabel(token.source)
  const balance = token.error
    ? null
    : `${String(token.formattedBalance ?? "0")} ${symbol}`.trim()

  return (
    <div className="rounded-xl bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <TokenAvatar
            symbol={symbol}
            address={address}
            iconUrl={iconUrl}
            isNative={token.source === "native"}
          />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{symbol}</p>
              <Badge variant={sourceLabel === "verified" ? "secondary" : "outline"}>
                {sourceLabel}
              </Badge>
              {chainName && <Badge variant="outline">{chainName}</Badge>}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {name ?? "Token metadata unavailable"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={address}>
              {shortenAddress(address)}
            </p>
          </div>
        </div>
        {showBalance && (
          <div className="text-right">
            {token.error ? (
              <p className="max-w-40 text-xs text-destructive">{String(token.error)}</p>
            ) : (
              <p className="font-semibold">{balance}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BalanceResult({ data }: { data: Record<string, unknown> }) {
  const nativeBalance = isRecord(data.nativeBalance) ? data.nativeBalance : null
  const tokens = Array.isArray(data.tokens)
    ? data.tokens.filter(isRecord)
    : []
  const tokenCandidates = Array.isArray(data.tokenCandidates)
    ? data.tokenCandidates.filter(isRecord)
    : []
  const errors = Array.isArray(data.errors) ? data.errors.map(String) : []

  return (
    <Card data-testid="result-balance" size="sm" className="border-0 bg-secondary/50">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <CardTitle className="text-xs font-normal text-muted-foreground">Balances</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {nativeBalance && (
          <div className="rounded-md bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Native
            </p>
            <p className="text-lg font-semibold">
              {String(nativeBalance.formattedBalance)} {String(nativeBalance.symbol)}
            </p>
          </div>
        )}
        {tokens.length > 0 && (
          <div className="space-y-2">
            {tokens.map((token) => (
              <TokenRow
                key={`${String(token.address)}-${String(token.symbol)}`}
                token={token}
              />
            ))}
          </div>
        )}
        {tokenCandidates.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5" />
              <p>Multiple verified matches found. Confirm the contract address.</p>
            </div>
            <div className="space-y-2">
              {tokenCandidates.map((token) => (
                <TokenRow
                  key={`candidate-${String(token.address)}-${String(token.symbol)}`}
                  token={token}
                  showBalance={false}
                />
              ))}
            </div>
          </div>
        )}
        {errors.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/20 bg-destructive/5 p-3">
            {errors.map((error) => (
              <p key={error} className="text-xs text-destructive">
                {error}
              </p>
            ))}
          </div>
        )}
        {"address" in data && (
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {String(data.address)}
          </p>
        )}
        {typeof data.blockNumber === "number" && (
          <p className="text-[11px] text-muted-foreground">
            Block {String(data.blockNumber)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Re-export from shared utility for backward compatibility
import { shortenAddress } from "@/lib/format"

function formatSignedTokenAmount(
  amount: string | undefined,
  symbol: string,
  direction: "sell" | "buy",
) {
  if (!amount) return symbol
  return `${direction === "sell" ? "-" : "+"}${amount} ${symbol}`.trim()
}

function SwapMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-xl bg-background/70 p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}

function SwapTokenPanel({
  label,
  amount,
  token,
  direction,
}: {
  label: string
  amount?: string
  token: Record<string, unknown>
  direction: "sell" | "buy"
}) {
  const address = String(token.address ?? "")
  const symbol = String(token.symbol ?? address ?? "Unknown")
  const name = typeof token.name === "string" ? token.name : symbol
  const iconUrl = typeof token.iconUrl === "string" ? token.iconUrl : undefined
  const sourceLabel = getSourceLabel(token.source)
  const amountLabel = formatSignedTokenAmount(amount, symbol, direction)

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        direction === "sell"
          ? "border-rose-500/20 bg-rose-500/5"
          : "border-emerald-500/20 bg-emerald-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <Badge variant={sourceLabel === "verified" ? "secondary" : "outline"}>{sourceLabel}</Badge>
      </div>
      <p
        className={cn(
          "mt-3 text-2xl font-semibold tracking-tight",
          direction === "sell"
            ? "text-rose-600 dark:text-rose-400"
            : "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {amountLabel}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <TokenAvatar
          symbol={symbol}
          address={address}
          iconUrl={iconUrl}
          isNative={token.source === "native"}
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {name !== symbol ? (
            <p className="text-xs text-muted-foreground">{symbol}</p>
          ) : null}
          {sourceLabel !== "native" && address ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={address}>
              {shortenAddress(address)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SafeTransactionResult({ data }: { data: Record<string, unknown> }) {
  const tx = (data.transaction as Record<string, string | undefined>) ?? {}
  const signers = Array.isArray(data.signers) ? (data.signers as string[]) : []
  const bundledTransactions = Array.isArray(data.transactions)
    ? data.transactions.filter(isRecord)
    : []
  const actionCount = typeof data.actionCount === "number" ? data.actionCount : bundledTransactions.length
  const status = String(data.status ?? "")
  const currentConfirmations = Number(data.currentConfirmations ?? 0)
  const requiredConfirmations = Number(data.requiredConfirmations ?? 0)
  const statusLabel = String(data.statusLabel ?? "")
  const safeUILink = String(data.safeUILink ?? data.safeUrl ?? "")
  const safeTxHash = data.safeTxHash ? String(data.safeTxHash) : null
  const safeAddress = data.safeAddress ? String(data.safeAddress) : null
  const proposerAddress = data.proposerAddress ? String(data.proposerAddress) : null
  const title =
    status === "proposed"
      ? "Safe Transaction Proposed"
      : status === "manual_creation_required"
        ? "Manual Safe Action Required"
        : "Safe Transaction Error"
  const accentClass =
    status === "error"
      ? "border-destructive/20 bg-destructive/5"
      : "border-amber-500/20 bg-amber-500/5"
  const titleClass = status === "error" ? "text-destructive" : "text-amber-500"
  const iconClass = status === "error" ? "text-destructive" : "text-amber-500"
  const ctaLabel = status === "proposed" ? "Sign on Safe" : "Open Safe"

  return (
    <ActionResultCard
      title={title}
      icon={<ArrowUpRight className={`size-4 ${iconClass}`} />}
      className={accentClass}
      titleClassName={titleClass}
    >
        {"summary" in data && (
          <p className="text-sm font-medium">{String(data.summary)}</p>
        )}
        {"message" in data && (
          <p className="text-sm text-muted-foreground">{String(data.message)}</p>
        )}
        {"signerMessage" in data && (
          <p className="text-xs text-muted-foreground">{String(data.signerMessage)}</p>
        )}
        <div className="space-y-1 text-sm">
          {safeAddress && (
            <ActionDetailRow
              label="Safe:"
              value={shortenAddress(safeAddress)}
              valueClassName="font-mono text-xs"
            />
          )}
          <ActionDetailRow label="Type:" value={String(tx.type ?? "Transaction")} />
          <ActionDetailRow
            label="To:"
            value={String(tx.to ?? "Unknown")}
            valueClassName="truncate font-mono text-xs"
          />
          <ActionDetailRow label="Value:" value={String(tx.value ?? "0 ETH")} />
          {tx.tokenAmount && (
            <ActionDetailRow label="Amount:" value={String(tx.tokenAmount)} />
          )}
          {tx.data && tx.data !== "0x" && (
            <ActionDetailRow
              label="Data:"
              value={String(tx.data)}
              valueClassName="truncate font-mono text-xs"
            />
          )}
          {actionCount > 1 && (
            <ActionDetailRow label="Actions:" value={String(actionCount)} />
          )}
          {safeTxHash && (
            <ActionDetailRow
              label="Safe Tx:"
              value={safeTxHash}
              valueClassName="truncate font-mono text-xs"
            />
          )}
          {requiredConfirmations > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-muted-foreground">Confirmations</span>
              <Badge variant="outline" className="text-xs">
                {currentConfirmations}/{requiredConfirmations} signatures
              </Badge>
            </div>
          )}
          {statusLabel && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={status === "error" ? "destructive" : "secondary"}>
                {status === "error" ? <X className="size-3" /> : <Info className="size-3" />}
                {statusLabel}
              </Badge>
            </div>
          )}
          {signers.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Threshold</span>
              <Badge variant="secondary">
                <Users className="size-3" />
                {requiredConfirmations || Number(data.threshold ?? 0)} of {signers.length} owners
              </Badge>
            </div>
          )}
          {proposerAddress && (
            <ActionDetailRow
              label="Signer:"
              value={shortenAddress(proposerAddress)}
              valueClassName="font-mono text-xs"
            />
          )}
        </div>
        {bundledTransactions.length > 1 && (
          <div className="space-y-2 rounded-md bg-background/50 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Bundled actions
            </p>
            {bundledTransactions.map((transaction, index) => (
              <div key={`${String(transaction.to)}-${index}`} className="space-y-1 text-xs">
                <p className="font-medium">{String(transaction.type ?? "Transaction")}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {String(transaction.to ?? "")}
                </p>
              </div>
            ))}
          </div>
        )}
        {"pendingTransactionsHint" in data && (
          <p className="text-xs text-muted-foreground">{String(data.pendingTransactionsHint)}</p>
        )}
        {safeUILink && (
          <a
            href={safeUILink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-400"
          >
            {ctaLabel}
            <ExternalLink className="size-3" />
          </a>
        )}
    </ActionResultCard>
  )
}

function SafeInfoResult({ data }: { data: Record<string, unknown> }) {
  const owners = data.owners as string[]
  return (
    <Card data-testid="result-safe-info" size="sm" className="border-0 bg-secondary/50">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">Safe Info</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex gap-2">
          <span className="text-muted-foreground">Address:</span>
          <span className="truncate font-mono text-xs">{String(data.address)}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">Balance:</span>
          <span>{String(data.balance)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Threshold:</span>
          <Badge variant="secondary">
            <Users className="size-3" />
            {String(data.threshold)} of {owners.length}
          </Badge>
        </div>
        <div>
          <span className="text-muted-foreground">Owners:</span>
          <ul className="mt-1 space-y-0.5">
            {owners.map((owner) => (
              <li key={owner} className="truncate font-mono text-xs text-muted-foreground">
                {owner}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function PendingTransactionsResult({ data }: { data: Record<string, unknown> }) {
  const txs = data.transactions as Array<Record<string, string | number>>
  const safeUILink = data.safeUILink ? String(data.safeUILink) : null
  const safeAddress = data.safeAddress ? String(data.safeAddress) : null
  if (txs.length === 0) {
    return (
      <Card
        data-testid="result-pending-transactions"
        size="sm"
        className="border-0 bg-secondary/50"
      >
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>No pending transactions.</p>
          {safeAddress && <p className="font-mono text-xs">{shortenAddress(safeAddress)}</p>}
        </CardContent>
      </Card>
    )
  }
  return (
    <div data-testid="result-pending-transactions" className="space-y-2">
      {txs.map((tx) => (
        <Card key={String(tx.safeTxHash)} size="sm" className="border-0 bg-secondary/50">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleDot className="size-4 text-muted-foreground" />
                <CardTitle className="text-xs font-normal text-muted-foreground">Pending Tx</CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                {String(tx.currentConfirmations)}/{String(tx.requiredConfirmations)} sigs
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {tx.safeAddress && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Safe:</span>
                <span className="font-mono text-xs">{shortenAddress(String(tx.safeAddress))}</span>
              </div>
            )}
            {"transactionType" in tx && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Type:</span>
                <span>{String(tx.transactionType)}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground">To:</span>
              <span className="truncate font-mono text-xs">{String(tx.to)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Value:</span>
              <span>{String(tx.value)}</span>
            </div>
            {"status" in tx && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="secondary">{String(tx.status)}</Badge>
              </div>
            )}
            <a
              href={String(tx.safeUILink ?? safeUILink ?? "")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 transition-colors hover:text-amber-500"
            >
              Sign on Safe
              <ExternalLink className="size-3" />
            </a>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EnsResult({ data }: { data: Record<string, unknown> }) {
  return (
    <Card data-testid="result-ens" size="sm" className="border-0 bg-secondary/50">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Hash className="size-4 text-muted-foreground" />
          <CardTitle className="text-xs font-normal text-muted-foreground">
            {String(data.name)}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-sm">
          {data.address ? String(data.address) : "Not found"}
        </p>
      </CardContent>
    </Card>
  )
}

function TransactionResult({ data }: { data: Record<string, unknown> }) {
  const isSuccess = data.status === "Success"
  return (
    <Card data-testid="result-transaction" size="sm" className="border-0 bg-secondary/50">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Transaction</CardTitle>
          <Badge variant={isSuccess ? "secondary" : "destructive"}>
            {isSuccess ? <Check className="size-3" /> : <X className="size-3" />}
            {String(data.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <div className="flex gap-2">
          <span className="text-muted-foreground">From:</span>
          <span className="truncate font-mono text-xs">{String(data.from)}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">To:</span>
          <span className="truncate font-mono text-xs">{String(data.to)}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">Value:</span>
          <span>{String(data.value)} ETH</span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">Block:</span>
          <span>{String(data.blockNumber)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function TransactionErrorResult({ data }: { data: TransactionErrorData }) {
  return (
    <Card
      data-testid="result-transaction-error"
      size="sm"
      className="border-destructive/20 bg-destructive/5"
    >
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 text-destructive" />
          <CardTitle className="text-sm text-destructive">
            {data.summary ?? "Tool Error"}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{data.error ?? data.message}</p>
        {data.toolName && (
          <p className="font-mono text-xs text-muted-foreground">{data.toolName}</p>
        )}
      </CardContent>
    </Card>
  )
}

function TransactionPreviewResult({ data }: { data: TransactionPreviewData }) {
  const isLocalApproval = data.status === "awaiting_local_approval"
  const isAborted = data.status === "aborted"
  const approvalSummary = data.approval?.summary

  return (
    <ActionResultCard
      testId={isLocalApproval ? "result-local-approval" : isAborted ? "result-transaction-aborted" : "result-transaction-preview"}
      title={isAborted ? "Transfer Aborted" : isLocalApproval ? "Local Approval Required" : "Ready to Confirm"}
      icon={
        <Wallet className={`size-4 ${isAborted ? "text-destructive" : isLocalApproval ? "text-orange-500" : "text-amber-500"}`} />
      }
      badge={
        <Badge
          variant="outline"
          className={
            isAborted
              ? "border-destructive/30 text-destructive"
              : isLocalApproval
                ? "border-orange-500/30 text-orange-600"
                : "border-amber-500/30 text-amber-600"
          }
        >
          {isAborted ? "Rejected" : isLocalApproval ? "Awaiting local approval" : "Awaiting confirmation"}
        </Badge>
      }
      className={
        isAborted
          ? "border-destructive/20 bg-destructive/5"
          : isLocalApproval
            ? "border-orange-500/20 bg-orange-500/5"
            : "border-amber-500/20 bg-amber-500/5"
      }
      titleClassName={isAborted ? "text-destructive" : isLocalApproval ? "text-orange-600" : "text-amber-500"}
    >
        {approvalSummary ? (
          <div className="space-y-2 rounded-md bg-background/60 p-3" data-testid="approval-summary">
            <ActionDetailRow label="Recipient:" value={approvalSummary.recipient} />
            <ActionDetailRow label="Asset:" value={approvalSummary.asset} />
            <ActionDetailRow label="Amount:" value={approvalSummary.amount} />
            <ActionDetailRow label="Network:" value={approvalSummary.network} />
            <ActionDetailRow label="Estimated gas:" value={approvalSummary.estimatedGas} />
          </div>
        ) : null}

        {/* Transfer panel */}
        {data.amount && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">You send</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-600 dark:text-rose-400">
              -{data.amount} {data.asset?.symbol ?? data.chain.nativeSymbol}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <TokenAvatar
                symbol={data.asset?.symbol ?? data.chain.nativeSymbol}
                address={data.asset?.tokenAddress ?? ""}
                iconUrl={data.asset?.iconUrl}
                isNative={data.asset?.type === "ETH" || !data.asset}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{data.asset?.symbol ?? data.chain.nativeSymbol}</p>
                {data.asset?.type === "ERC20" && data.asset.tokenAddress ? (
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={data.asset.tokenAddress}>
                    {shortenAddress(data.asset.tokenAddress)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Recipient panel */}
        {(data.recipient || data.resolvedEnsName) && (
          <div className="rounded-xl bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">To</p>
            <p className="mt-1 truncate font-medium" title={data.recipient}>
              {data.resolvedEnsName ?? (data.recipient ? shortenAddress(data.recipient) : "")}
            </p>
            {data.resolvedEnsName && data.recipient ? (
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={data.recipient}>
                {shortenAddress(data.recipient)}
              </p>
            ) : null}
          </div>
        )}

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1 rounded-xl bg-background/70 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Network</p>
            <p className="font-medium">{data.chain.name}</p>
          </div>
          {data.gasEstimate && (
            <div className="space-y-1 rounded-xl bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Gas cost</p>
              <p className="font-medium">~{data.gasEstimate.gasCostNative} {data.chain.nativeSymbol}</p>
            </div>
          )}
          {data.balance && (
            <div className="space-y-1 rounded-xl bg-background/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Balance</p>
              <p className="font-medium">{data.balance.amount} {data.balance.asset}</p>
            </div>
          )}
        </div>
        {data.approval?.required && data.approval.thresholdAmount && data.approval.thresholdAssetSymbol ? (
          <p className="text-xs text-muted-foreground">
            Local approval threshold: {data.approval.thresholdAmount} {data.approval.thresholdAssetSymbol}
          </p>
        ) : null}
        {data.approval?.reason === "session_cumulative_threshold" && data.approval.cumulativeAmount ? (
          <p className="text-xs text-muted-foreground">
            Cumulative session amount: {data.approval.cumulativeAmount}
          </p>
        ) : null}
        <p className={isAborted ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {data.message}
        </p>
    </ActionResultCard>
  )
}

function TransactionProgressResult({
  data,
  preliminary,
}: {
  data: TransactionProgressData
  preliminary?: boolean
}) {
  const isSuccess = data.status === "confirmed"
  const isFailure = data.status === "reverted" || data.status === "error"
  const badgeVariant = isSuccess ? "secondary" : isFailure ? "destructive" : "outline"
  const badgeLabel = isSuccess
    ? "Confirmed"
    : data.status === "reverted"
      ? "Reverted"
      : data.status === "error"
        ? "Error"
        : preliminary
          ? "Streaming"
          : "In progress"

  return (
    <ActionResultCard
      testId="result-transaction-progress"
      title={data.summary}
      icon={<ArrowUpRight className="size-4 text-amber-500" />}
      badge={<Badge variant={badgeVariant}>{badgeLabel}</Badge>}
      className={
        isSuccess
          ? "border-emerald-500/20 bg-emerald-500/5"
          : isFailure
            ? "border-destructive/20 bg-destructive/5"
            : "border-amber-500/20 bg-amber-500/5"
      }
    >
        <p className="text-muted-foreground">{data.message}</p>

        <div className="space-y-1.5">
          <ActionDetailRow
            label="From:"
            value={data.sender}
            valueClassName="truncate font-mono text-xs"
          />
          <ActionDetailRow
            label="To:"
            value={data.recipient}
            valueClassName="truncate font-mono text-xs"
          />
          <ActionDetailRow
            label="Amount:"
            value={`${data.amount} ${data.asset.symbol}`}
          />
        </div>

        <ActionStepList steps={data.steps} />

        {data.txHash && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Tx hash:</span>
            {data.explorerUrl ? (
              <a
                href={data.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
              >
                <span className="truncate font-mono text-xs">{data.txHash}</span>
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="truncate font-mono text-xs">{data.txHash}</span>
            )}
          </div>
        )}

        {data.receipt && (
          <div className="space-y-1.5 rounded-md bg-background/50 px-2.5 py-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground">Block:</span>
              <span>{data.receipt.blockNumber}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Gas used:</span>
              <span>{data.receipt.gasUsed}</span>
            </div>
            {data.receipt.effectiveGasPriceGwei && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Effective gas price:</span>
                <span>{data.receipt.effectiveGasPriceGwei} gwei</span>
              </div>
            )}
            {data.receipt.gasCostNative && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Actual gas cost:</span>
                <span>
                  {data.receipt.gasCostNative} {data.chain.nativeSymbol}
                </span>
              </div>
            )}
          </div>
        )}

        {data.revertReason && (
          <p className="text-sm text-destructive">{data.revertReason}</p>
        )}
        {data.error && <p className="text-sm text-destructive">{data.error}</p>}
    </ActionResultCard>
  )
}

function RailgunResult({ data }: { data: Record<string, unknown> }) {
  const operation = String(data.operation ?? "")
  const isError = data.status === "error"
  const titleByOperation: Record<string, string> = {
    balance: "Railgun Balances",
    route: "Railgun Balance Routing",
    shield: "Railgun Shield",
    transfer: "Railgun Transfer",
    unshield: "Railgun Unshield",
  }
  const balanceRouting =
    typeof data.balanceRouting === "object" && data.balanceRouting !== null
      ? (data.balanceRouting as Record<string, unknown>)
      : null

  if (
    data.status === "awaiting_local_approval" ||
    data.status === "cancelled"
  ) {
    return <RailgunApprovalResult data={data} />
  }

  if (isError) {
    const setup = Array.isArray(data.setup) ? (data.setup as string[]) : []
    return (
      <Card
        data-testid={`result-railgun-${operation || "error"}`}
        size="sm"
        className="border-red-500/20 bg-red-500/5"
      >
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-red-500" />
            <CardTitle className="text-sm text-red-500">
              {titleByOperation[operation] ?? "Railgun Error"}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{String(data.message ?? "Unknown Railgun error")}</p>
          {balanceRouting && (
            <div className="rounded-md border border-red-500/20 bg-background/60 p-3 text-xs">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  Private {String(balanceRouting.shieldedBalance)}{" "}
                  {String(balanceRouting.token)}
                </Badge>
                <Badge variant="secondary">
                  Public {String(balanceRouting.publicBalance)}{" "}
                  {String(balanceRouting.token)}
                </Badge>
                {"shortfall" in balanceRouting && balanceRouting.shortfall ? (
                  <Badge variant="outline">
                    Shortfall {String(balanceRouting.shortfall)}{" "}
                    {String(balanceRouting.token)}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2">{String(balanceRouting.recommendation ?? "")}</p>
              <p className="mt-1 text-muted-foreground">
                {String(balanceRouting.privacyGuidance ?? "")}
              </p>
            </div>
          )}
          {setup.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {setup.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    )
  }

  if (operation === "route" && balanceRouting) {
    return (
      <Card size="sm" className="border-0 bg-secondary/50">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm">Railgun Balance Routing</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {String(balanceRouting.requestedAmount)} {String(balanceRouting.token)}
            </Badge>
            <Badge variant="outline">
              {String(balanceRouting.requestedOperation)}
            </Badge>
            <Badge variant="outline">{String(balanceRouting.route)}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Private balance</p>
              <p className="font-medium">
                {String(balanceRouting.shieldedBalance)} {String(balanceRouting.token)}
              </p>
            </div>
            <div className="rounded-md bg-background/50 p-3">
              <p className="text-xs text-muted-foreground">Public balance</p>
              <p className="font-medium">
                {String(balanceRouting.publicBalance)} {String(balanceRouting.token)}
              </p>
            </div>
          </div>
          {"shortfall" in balanceRouting && balanceRouting.shortfall ? (
            <p className="text-xs text-muted-foreground">
              Shortfall: {String(balanceRouting.shortfall)}{" "}
              {String(balanceRouting.token)}
            </p>
          ) : null}
          <p>{String(balanceRouting.recommendation)}</p>
          <p className="text-xs text-muted-foreground">
            {String(balanceRouting.privacyGuidance)}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (operation === "balance") {
    const balances = Array.isArray(data.balances)
      ? (data.balances as Array<Record<string, unknown>>)
      : []
    const freshness =
      typeof data.freshness === "object" && data.freshness !== null
        ? (data.freshness as Record<string, unknown>)
        : null
    const freshnessAge = formatAgeMs(freshness?.ageMs)

    return (
      <Card
        data-testid="result-railgun-balance"
        size="sm"
        className="border-0 bg-secondary/50"
      >
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm">Railgun Balances</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="truncate font-mono text-xs text-muted-foreground">
            {String(data.railgunAddress)}
          </p>
          {freshness && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {String(freshness.source === "cache" ? "Snapshot" : "Live")}
              </Badge>
              {freshnessAge && <Badge variant="secondary">{freshnessAge}</Badge>}
              {freshness.refreshing === true && (
                <Badge variant="secondary">Refreshing in background</Badge>
              )}
            </div>
          )}
          {balances.length === 0 ? (
            <p className="text-muted-foreground">No shielded balances found.</p>
          ) : (
            <div className="space-y-1">
              {balances.map((balance) => (
                <div
                  key={`${String(balance.tokenAddress)}-${String(balance.rawAmount)}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{String(balance.symbol)}</span>
                  <span className="font-medium">{String(balance.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  const stages = Array.isArray(data.stages)
    ? (data.stages as Array<Record<string, unknown>>)
    : []
  const proofProgress = Array.isArray(data.proofProgress)
    ? (data.proofProgress as Array<Record<string, unknown>>)
    : []
  const balanceIndexing = data.balanceIndexing

  return (
    <Card
      data-testid={`result-railgun-${operation || "operation"}`}
      size="sm"
      className="border-0 bg-secondary/50"
    >
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">
            {titleByOperation[operation] ?? "Railgun Operation"}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {"amount" in data && "token" in data && (
            <Badge variant="secondary">
              {String(data.amount)} {String(data.token)}
            </Badge>
          )}
          {balanceIndexing === "pending" && (
            <Badge variant="outline">Private balance indexing in background</Badge>
          )}
        </div>

        {"recipient" in data && (
          <div className="rounded-md bg-background/50 px-2.5 py-2 text-xs">
            <p className="text-muted-foreground">
              {operation === "unshield" ? "Public recipient" : "Recipient"}
            </p>
            <p className="break-all font-mono">{String(data.recipient)}</p>
          </div>
        )}

        {"txHash" in data && (
          <div className="rounded-md bg-background/50 px-2.5 py-2 text-xs">
            <p className="text-muted-foreground">Tx hash</p>
            <p className="break-all font-mono">{String(data.txHash)}</p>
          </div>
        )}

        {stages.length > 0 && (
          <div className="space-y-1.5">
            {stages.map((stage, index) => (
              <div key={`${String(stage.label)}-${index}`} className="flex items-start gap-2">
                <Check className="mt-0.5 size-3.5 text-green-500" />
                <div>
                  <p>{String(stage.label)}</p>
                  {"detail" in stage && Boolean(stage.detail) && (
                    <p className="text-xs text-muted-foreground">{String(stage.detail)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {proofProgress.length > 0 && (
          <div className="rounded-md bg-background/50 p-2">
            <p className="text-xs font-medium text-muted-foreground">Proof generation</p>
            <div className="mt-1 space-y-1">
              {proofProgress.slice(-3).map((stage, index) => (
                <div key={`${String(stage.status)}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                  <span>{String(stage.status)}</span>
                  <span>{String(stage.progress)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {"privacyNote" in data && (
          <p className="text-xs text-muted-foreground">{String(data.privacyNote)}</p>
        )}

        {"txHash" in data && (
          <a
            href={String(data.explorerUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            View on Arbiscan
            <ExternalLink className="size-3" />
          </a>
        )}
      </CardContent>
    </Card>
  )
}

async function readJsonResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function streamApprovalUpdates(
  response: Response,
  onUpdate: (value: unknown) => void,
) {
  if (!response.body) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      onUpdate(JSON.parse(line))
    }
  }

  if (buffer.trim()) {
    onUpdate(JSON.parse(buffer))
  }
}

function buildLocalApprovalError(
  message: string,
  data: TransactionPreviewData,
): TransactionErrorData {
  return {
    kind: "transaction_error",
    summary: "Local approval failed",
    message,
    error: message,
    toolName: data.confirmationId,
  }
}

function RailgunApprovalResult({ data }: { data: Record<string, unknown> }) {
  const [currentData, setCurrentData] = useState(data)
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)

  if (
    currentData.status !== "awaiting_local_approval" &&
    currentData.status !== "cancelled"
  ) {
    return <RailgunResult data={currentData} />
  }

  const approval = isRecord(currentData.approval) ? currentData.approval : null
  const isAwaiting = currentData.status === "awaiting_local_approval"
  const operation = String(currentData.operation ?? "")
  const titleByOperation: Record<string, string> = {
    shield: "Railgun Shield Approval",
    transfer: "Railgun Transfer Approval",
    unshield: "Railgun Unshield Approval",
  }

  const submitDecision = async (nextDecision: "approve" | "reject") => {
    if (!approval || typeof approval.id !== "string") {
      setRequestError("Missing Railgun approval ID.")
      return
    }

    setDecision(nextDecision)
    setRequestError(null)

    try {
      const response = await fetch("/api/railgun-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          approvalId: approval.id,
          decision: nextDecision,
        }),
      })

      const payload = (await response.json()) as unknown
      if (!response.ok) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Railgun approval request failed.",
        )
      }

      if (!isRecord(payload)) {
        throw new Error("Railgun approval request returned an invalid response.")
      }

      setCurrentData(payload)
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Railgun approval request failed.",
      )
    } finally {
      setDecision(null)
    }
  }

  return (
    <Card
      data-testid="result-railgun-approval"
      size="sm"
      className={
        isAwaiting ? "border-amber-500/20 bg-amber-500/5" : "border-muted bg-muted/40"
      }
    >
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          {isAwaiting ? (
            <Shield className="size-4 text-amber-500" />
          ) : (
            <X className="size-4 text-muted-foreground" />
          )}
          <CardTitle className={isAwaiting ? "text-sm text-amber-500" : "text-sm"}>
            {titleByOperation[operation] ?? "Railgun Approval"}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {"summary" in currentData && (
          <p className="font-medium">{String(currentData.summary)}</p>
        )}
        {"message" in currentData && (
          <p className="text-muted-foreground">{String(currentData.message)}</p>
        )}

        <div className="flex flex-wrap gap-2">
          {"amount" in currentData && "token" in currentData && (
            <Badge variant="secondary">
              {String(currentData.amount)} {String(currentData.token)}
            </Badge>
          )}
          {approval && typeof approval.threshold === "string" && (
            <Badge variant="outline">
              Threshold {approval.threshold} {String(currentData.token ?? "")}
            </Badge>
          )}
        </div>

        {"recipient" in currentData && Boolean(currentData.recipient) && (
          <div className="rounded-md bg-background/60 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Recipient
            </p>
            <p className="break-all font-mono text-xs">
              {String(currentData.recipient)}
            </p>
          </div>
        )}

        {("privacyImpact" in currentData || "privacyNote" in currentData) && (
          <div className="rounded-md bg-background/60 p-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Privacy impact
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {String(currentData.privacyImpact ?? currentData.privacyNote)}
            </p>
          </div>
        )}

        {requestError ? (
          <p className="text-sm text-destructive">{requestError}</p>
        ) : null}

        {isAwaiting ? (
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="railgun-approval-approve"
              size="sm"
              onClick={() => submitDecision("approve")}
              disabled={decision !== null}
            >
              {decision === "approve" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Approving
                </>
              ) : (
                "Approve locally"
              )}
            </Button>
            <Button
              data-testid="railgun-approval-reject"
              size="sm"
              variant="outline"
              onClick={() => submitDecision("reject")}
              disabled={decision !== null}
            >
              {decision === "reject" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Cancelling
                </>
              ) : (
                "Reject"
              )}
            </Button>
          </div>
        ) : (
          <p data-testid="railgun-approval-cancelled" className="text-sm text-muted-foreground">
            Local approval was rejected on this device.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SwapResultCard({ data }: { data: SwapResultData }) {
  const status = String(data.status ?? "")
  const actor = String(data.actor ?? "").toUpperCase()
  const summary = String(data.summary ?? "Swap")
  const message = String(data.message ?? "")
  const quote = isRecord(data.quote) ? data.quote : null
  const plan = isRecord(data.plan) ? data.plan : null
  const chain = isRecord(data.chain) ? data.chain : null
  const execution = isRecord(data.execution) ? data.execution : null
  const chainId = typeof chain?.id === "number" ? chain.id : null
  const sellToken = isRecord(plan?.sell) ? plan.sell : null
  const buyToken = isRecord(plan?.buy) ? plan.buy : null
  const sellAmount =
    typeof quote?.sellAmount === "string"
      ? quote.sellAmount
      : typeof sellToken?.amount === "string"
        ? sellToken.amount
        : undefined
  const buyAmount =
    typeof quote?.buyAmount === "string"
      ? quote.buyAmount
      : typeof buyToken?.amount === "string"
        ? buyToken.amount
        : undefined
  const feeAmount =
    typeof quote?.feeAmount === "string"
      ? `${quote.feeAmount}${sellToken ? ` ${String(sellToken.symbol ?? "")}` : ""}`.trim()
      : null
  const slippageLabel =
    typeof quote?.slippageBps === "number" ? `${quote.slippageBps} bps` : null
  const validToLabel =
    typeof quote?.validTo === "string"
      ? new Date(quote.validTo).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null
  const orderId = typeof execution?.orderId === "string" ? execution.orderId : undefined
  const txHash =
    typeof execution?.approvalTxHash === "string"
      ? execution.approvalTxHash
      : typeof execution?.txHash === "string"
        ? execution.txHash
        : undefined
  const safeTxHash =
    typeof execution?.safeTxHash === "string" ? execution.safeTxHash : undefined
  const actionCount =
    typeof execution?.actionCount === "number" ? execution.actionCount : null
  const orderUrl = chainId ? getCowExplorerOrderUrl(chainId, orderId) : null
  const txUrl = chainId ? getExplorerTxUrl(chainId, txHash) : null

  const accentClass =
    status === "executed"
      ? "border-emerald-500/20 bg-emerald-500/5"
      : status === "awaiting_local_approval"
        ? "border-orange-500/20 bg-orange-500/5"
      : status === "awaiting_confirmation"
        ? "border-amber-500/20 bg-amber-500/5"
      : status === "proposed"
        ? "border-amber-500/20 bg-amber-500/5"
      : status === "manual_action_required"
        ? "border-amber-500/20 bg-amber-500/5"
        : status === "unsupported" || status === "error"
          ? "border-destructive/20 bg-destructive/5"
          : "border-border/60 bg-secondary/50"
  const badgeVariant =
    status === "executed"
      ? "secondary"
      : status === "awaiting_local_approval" || status === "awaiting_confirmation"
        ? "outline"
      : status === "proposed"
        ? "secondary"
      : status === "manual_action_required"
        ? "outline"
        : status === "unsupported" || status === "error"
          ? "destructive"
          : "outline"

  return (
    <Card data-testid="result-swap" size="sm" className={accentClass}>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-sm">{summary}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{actor}</Badge>
              {chain && typeof chain.name === "string" ? (
                <Badge variant="outline">{chain.name}</Badge>
              ) : null}
              {quote?.verified === true ? <Badge variant="secondary">verified quote</Badge> : null}
              <Badge variant={badgeVariant}>{status.replaceAll("_", " ")}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{message}</p>

        {data.approval?.required && data.approval.thresholdAmount && data.approval.thresholdAssetSymbol ? (
          <p className="text-xs text-muted-foreground">
            Local approval threshold: {data.approval.thresholdAmount} {data.approval.thresholdAssetSymbol}
          </p>
        ) : null}
        {data.approval?.reason === "session_cumulative_threshold" && data.approval.cumulativeAmount ? (
          <p className="text-xs text-muted-foreground">
            Cumulative session amount: {data.approval.cumulativeAmount}
          </p>
        ) : null}

        {sellToken && buyToken ? (
          <div className="grid gap-3">
            <SwapTokenPanel
              label="You pay"
              amount={sellAmount}
              token={sellToken}
              direction="sell"
            />
            <SwapTokenPanel
              label="You receive"
              amount={buyAmount}
              token={buyToken}
              direction="buy"
            />
          </div>
        ) : null}

        {quote ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {feeAmount ? <SwapMetric label="Fee" value={feeAmount} /> : null}
            {slippageLabel ? <SwapMetric label="Slippage" value={slippageLabel} /> : null}
            {validToLabel ? <SwapMetric label="Valid until" value={validToLabel} /> : null}
            {actionCount && actionCount > 1 ? (
              <SwapMetric label="Safe actions" value={String(actionCount)} />
            ) : null}
          </div>
        ) : null}

        {Array.isArray(plan?.steps) && plan.steps.length > 0 ? (
          <ActionStepList steps={plan.steps as Array<ProgressStep>} />
        ) : null}

        {orderUrl || txUrl ? (
          <div className="flex flex-wrap gap-2">
            {orderUrl ? (
              <a
                href={orderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                View order
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            {txUrl ? (
              <a
                href={txUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                View transaction
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </div>
        ) : null}

        {safeTxHash ? (
          <ActionDetailRow
            label="Safe Tx:"
            value={safeTxHash}
            valueClassName="truncate font-mono text-xs"
          />
        ) : null}

        {execution && typeof execution.safeUILink === "string" ? (
          <a
            href={execution.safeUILink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 transition-colors hover:text-amber-500"
          >
            {status === "proposed" ? "Sign on Safe" : "Continue in Safe"}
            <ExternalLink className="size-3" />
          </a>
        ) : null}

        {Array.isArray(data.candidates) && data.candidates.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5" />
              <p>Confirm the token contract before retrying the swap.</p>
            </div>
            <div className="space-y-2">
              {data.candidates.filter(isRecord).map((candidate) => (
                <TokenRow
                  key={`swap-candidate-${String(candidate.address)}-${String(candidate.symbol)}`}
                  token={candidate}
                  showBalance={false}
                />
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ToolResultCard({ result, preliminary, onSendMessage }: ToolResultCardProps) {
  const [localResult, setLocalResult] = useState<unknown>(null)
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null)
  const [isLocalOverride, setIsLocalOverride] = useState(false)
  const [chatConfirmationSent, setChatConfirmationSent] = useState(false)

  const liveResult = isLocalOverride ? localResult : result
  const setLiveResult = (value: unknown) => {
    setIsLocalOverride(true)
    setLocalResult(value)
  }

  if (!liveResult || typeof liveResult !== "object") return null
  const data = liveResult as Record<string, unknown>

  const handleLocalApproval = async (
    preview: TransactionPreviewData,
    action: "approve" | "reject",
  ) => {
    if (!preview.confirmationId || pendingAction) {
      return
    }

    setPendingAction(action)
    try {
      const response = await fetch("/api/eoa-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          confirmationId: preview.confirmationId,
        }),
      })

      if (!response.ok) {
        const payload = await readJsonResponse(response)
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Local approval failed."
        setLiveResult(buildLocalApprovalError(message, preview))
        return
      }

      if (action === "reject") {
        setLiveResult(await readJsonResponse(response))
        return
      }

      await streamApprovalUpdates(response, setLiveResult)
    } catch (error) {
      setLiveResult(
        buildLocalApprovalError(
          error instanceof Error ? error.message : "Local approval failed.",
          preview,
        ),
      )
    } finally {
      setPendingAction(null)
    }
  }

  const handleLocalSwapApproval = async (
    swap: SwapResultData,
    action: "approve" | "reject",
  ) => {
    if (!swap.confirmationId || pendingAction) {
      return
    }

    setPendingAction(action)
    try {
      const response = await fetch("/api/eoa-swap-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          confirmationId: swap.confirmationId,
        }),
      })

      const payload = await readJsonResponse(response)
      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : "Local approval failed."
        setLiveResult({
          ...swap,
          kind: "swap_result",
          status: "error",
          message,
          error: message,
        } satisfies SwapResultData)
        return
      }

      setLiveResult(payload)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Local approval failed."
      setLiveResult({
        ...swap,
        kind: "swap_result",
        status: "error",
        message,
        error: message,
      } satisfies SwapResultData)
    } finally {
      setPendingAction(null)
    }
  }

  if ("kind" in data && data.kind === "transaction_preview") {
    const previewData = data as unknown as TransactionPreviewData
    const canApproveLocally =
      previewData.status === "awaiting_local_approval" &&
      previewData.approval?.required === true &&
      previewData.approval.state !== "rejected" &&
      Boolean(previewData.confirmationId)

    const showChatConfirmation =
      !canApproveLocally &&
      previewData.status === "awaiting_confirmation" &&
      !chatConfirmationSent &&
      onSendMessage != null

    return (
      <div className="space-y-3">
        <TransactionPreviewResult data={previewData} />
        {canApproveLocally ? (
          <div className="flex gap-2">
            <Button
              data-testid="local-approval-approve"
              size="sm"
              onClick={() => handleLocalApproval(previewData, "approve")}
              disabled={pendingAction !== null}
            >
              {pendingAction === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Approve and send
            </Button>
            <Button
              data-testid="local-approval-reject"
              size="sm"
              variant="outline"
              onClick={() => handleLocalApproval(previewData, "reject")}
              disabled={pendingAction !== null}
            >
              {pendingAction === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Reject
            </Button>
          </div>
        ) : null}
        {showChatConfirmation ? (
          <div className="flex gap-2">
            <Button
              data-testid="chat-confirm-approve"
              size="sm"
              onClick={() => {
                setChatConfirmationSent(true)
                onSendMessage("I approve")
              }}
            >
              <Check className="size-3.5" />
              Approve
            </Button>
            <Button
              data-testid="chat-confirm-decline"
              size="sm"
              variant="outline"
              onClick={() => {
                setChatConfirmationSent(true)
                onSendMessage("I decline")
              }}
            >
              <X className="size-3.5" />
              Decline
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  if ("kind" in data && data.kind === "transaction_progress") {
    return (
      <TransactionProgressResult
        data={data as unknown as TransactionProgressData}
        preliminary={preliminary}
      />
    )
  }
  if ("kind" in data && (data.kind === "transaction_error" || data.kind === "tool_error")) {
    return <TransactionErrorResult data={data as unknown as TransactionErrorData} />
  }
  if ("kind" in data && data.kind === "swap_result") {
    const swapData = data as unknown as SwapResultData
    const canApproveLocally =
      swapData.status === "awaiting_local_approval" &&
      swapData.approval?.required === true &&
      swapData.approval.state !== "rejected" &&
      Boolean(swapData.confirmationId)

    const showSwapChatConfirmation =
      !canApproveLocally &&
      swapData.status === "awaiting_confirmation" &&
      !chatConfirmationSent &&
      onSendMessage != null

    return (
      <div className="space-y-3">
        <SwapResultCard data={swapData} />
        {canApproveLocally ? (
          <div className="flex gap-2">
            <Button
              data-testid="local-swap-approval-approve"
              size="sm"
              onClick={() => handleLocalSwapApproval(swapData, "approve")}
              disabled={pendingAction !== null}
            >
              {pendingAction === "approve" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Approve and swap
            </Button>
            <Button
              data-testid="local-swap-approval-reject"
              size="sm"
              variant="outline"
              onClick={() => handleLocalSwapApproval(swapData, "reject")}
              disabled={pendingAction !== null}
            >
              {pendingAction === "reject" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Reject
            </Button>
          </div>
        ) : null}
        {showSwapChatConfirmation ? (
          <div className="flex gap-2">
            <Button
              data-testid="chat-swap-confirm-approve"
              size="sm"
              onClick={() => {
                setChatConfirmationSent(true)
                onSendMessage("I approve")
              }}
            >
              <Check className="size-3.5" />
              Approve
            </Button>
            <Button
              data-testid="chat-swap-confirm-decline"
              size="sm"
              variant="outline"
              onClick={() => {
                setChatConfirmationSent(true)
                onSendMessage("I decline")
              }}
            >
              <X className="size-3.5" />
              Decline
            </Button>
          </div>
        ) : null}
      </div>
    )
  }
  if ("nativeBalance" in data && "tokens" in data) return <BalanceResult data={data} />
  if (data.railgun === true) return <RailgunResult data={data} />
  if (("safeUILink" in data || "safeUrl" in data) && ("transaction" in data || "status" in data)) {
    return <SafeTransactionResult data={data} />
  }
  if ("owners" in data && "threshold" in data) return <SafeInfoResult data={data} />
  if ("transactions" in data) return <PendingTransactionsResult data={data} />
  if ("name" in data && "address" in data) return <EnsResult data={data} />
  if ("hash" in data && "from" in data && "status" in data) return <TransactionResult data={data} />

  return (
    <Card size="sm" className="border-0 bg-secondary/50">
      <CardContent>
        <pre className="overflow-x-auto text-xs text-muted-foreground">
          {JSON.stringify(result, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}

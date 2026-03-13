"use client"

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

type ToolResultCardProps = {
  result: unknown
  preliminary?: boolean
}

type TransactionPreviewData = {
  kind: "transaction_preview"
  status: "awaiting_confirmation"
  summary: string
  message: string
  chain: { id: number; name: string; nativeSymbol: string }
  confirmationId?: string
  sender?: string
  recipient?: string
  recipientInput?: string
  resolvedEnsName?: string
  asset?: { type: "ETH" | "ERC20"; symbol: string; tokenAddress?: string }
  amount?: string
  balance?: { asset: string; amount: string }
  gasEstimate?: {
    gasLimit: string
    maxFeePerGasGwei: string
    maxPriorityFeePerGasGwei?: string
    gasCostNative: string
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
  asset: { type: "ETH" | "ERC20"; symbol: string; tokenAddress?: string }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function BalanceResult({ data }: { data: Record<string, unknown> }) {
  const nativeBalance = isRecord(data.nativeBalance) ? data.nativeBalance : null
  const tokens = Array.isArray(data.tokens)
    ? data.tokens.filter(isRecord)
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
              <div
                key={`${String(token.address)}-${String(token.symbol)}`}
                className="rounded-md bg-background/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{String(token.symbol)}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {String(token.address)}
                    </p>
                  </div>
                  <div className="text-right">
                    {token.error ? (
                      <p className="max-w-40 text-xs text-destructive">
                        {String(token.error)}
                      </p>
                    ) : (
                      <p className="font-semibold">
                        {String(token.formattedBalance)} {String(token.symbol)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
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

function shortenAddress(value: string) {
  if (!value || value.length < 12) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function SafeTransactionResult({ data }: { data: Record<string, unknown> }) {
  const tx = (data.transaction as Record<string, string | undefined>) ?? {}
  const signers = Array.isArray(data.signers) ? (data.signers as string[]) : []
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
    <Card size="sm" className={accentClass}>
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <ArrowUpRight className={`size-4 ${iconClass}`} />
          <CardTitle className={`text-sm ${titleClass}`}>{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
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
            <div className="flex gap-2">
              <span className="text-muted-foreground">Safe:</span>
              <span className="font-mono text-xs">{shortenAddress(safeAddress)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-muted-foreground">Type:</span>
            <span>{String(tx.type ?? "Transaction")}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground">To:</span>
            <span className="truncate font-mono text-xs">{String(tx.to ?? "Unknown")}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground">Value:</span>
            <span>{String(tx.value ?? "0 ETH")}</span>
          </div>
          {tx.tokenAmount && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Amount:</span>
              <span>{String(tx.tokenAmount)}</span>
            </div>
          )}
          {tx.data && tx.data !== "0x" && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Data:</span>
              <span className="truncate font-mono text-xs">{String(tx.data)}</span>
            </div>
          )}
          {safeTxHash && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Safe Tx:</span>
              <span className="truncate font-mono text-xs">{safeTxHash}</span>
            </div>
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
            <div className="flex gap-2">
              <span className="text-muted-foreground">Signer:</span>
              <span className="font-mono text-xs">{shortenAddress(proposerAddress)}</span>
            </div>
          )}
        </div>
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
      </CardContent>
    </Card>
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
  return (
    <Card
      data-testid="result-transaction-preview"
      size="sm"
      className="border-amber-500/20 bg-amber-500/5"
    >
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-amber-500" />
            <CardTitle className="text-sm text-amber-500">Ready to Confirm</CardTitle>
          </div>
          <Badge variant="outline" className="border-amber-500/30 text-amber-600">
            Awaiting confirmation
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{data.summary}</p>
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <span className="text-muted-foreground">Network:</span>
            <span>{data.chain.name}</span>
          </div>
          {data.sender && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">From:</span>
              <span className="truncate font-mono text-xs">{data.sender}</span>
            </div>
          )}
          {data.recipient && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">To:</span>
              <span className="truncate font-mono text-xs">{data.recipient}</span>
            </div>
          )}
          {data.resolvedEnsName && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">ENS:</span>
              <span>{data.resolvedEnsName}</span>
            </div>
          )}
          {data.asset && data.amount && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Amount:</span>
              <span>
                {data.amount} {data.asset.symbol}
              </span>
            </div>
          )}
          {data.gasEstimate && (
            <>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Gas limit:</span>
                <span>{data.gasEstimate.gasLimit}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Max fee:</span>
                <span>{data.gasEstimate.maxFeePerGasGwei} gwei</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Gas cost:</span>
                <span>
                  ~{data.gasEstimate.gasCostNative} {data.chain.nativeSymbol}
                </span>
              </div>
            </>
          )}
          {data.balance && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Signer balance:</span>
              <span>
                {data.balance.amount} {data.balance.asset}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "complete") return <Check className="size-3.5 text-emerald-600" />
  if (status === "error") return <X className="size-3.5 text-destructive" />
  if (status === "in_progress") return <Loader2 className="size-3.5 animate-spin text-amber-500" />
  return <CircleDot className="size-3.5 text-muted-foreground/50" />
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
    <Card
      data-testid="result-transaction-progress"
      size="sm"
      className={
        isSuccess
          ? "border-emerald-500/20 bg-emerald-500/5"
          : isFailure
            ? "border-destructive/20 bg-destructive/5"
            : "border-amber-500/20 bg-amber-500/5"
      }
    >
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="size-4 text-amber-500" />
            <CardTitle className="text-sm">{data.summary}</CardTitle>
          </div>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{data.message}</p>

        <div className="space-y-1.5">
          <div className="flex gap-2">
            <span className="text-muted-foreground">From:</span>
            <span className="truncate font-mono text-xs">{data.sender}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground">To:</span>
            <span className="truncate font-mono text-xs">{data.recipient}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground">Amount:</span>
            <span>
              {data.amount} {data.asset.symbol}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {data.steps.map((step) => (
            <div key={step.key} className="flex items-start gap-2 rounded-md bg-background/50 px-2.5 py-2">
              <div className="pt-0.5">
                <StepIcon status={step.status} />
              </div>
              <div className="min-w-0">
                <p className="text-sm">{step.label}</p>
                {step.detail && (
                  <p className="break-all text-xs text-muted-foreground">{step.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>

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
      </CardContent>
    </Card>
  )
}

function RailgunResult({ data }: { data: Record<string, unknown> }) {
  const operation = String(data.operation ?? "")
  const isError = data.status === "error"
  const titleByOperation: Record<string, string> = {
    balance: "Railgun Balances",
    shield: "Railgun Shield",
    transfer: "Railgun Transfer",
    unshield: "Railgun Unshield",
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

  if (operation === "balance") {
    const balances = Array.isArray(data.balances)
      ? (data.balances as Array<Record<string, unknown>>)
      : []

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

export function ToolResultCard({ result, preliminary }: ToolResultCardProps) {
  if (!result || typeof result !== "object") return null
  const data = result as Record<string, unknown>

  if ("kind" in data && data.kind === "transaction_preview") {
    return <TransactionPreviewResult data={data as unknown as TransactionPreviewData} />
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

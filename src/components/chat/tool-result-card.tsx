"use client"

import {
  ArrowUpRight,
  Check,
  CircleDot,
  ExternalLink,
  Hash,
  Shield,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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
    <Card size="sm" className="border-0 bg-secondary/50">
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

function TransactionProposalResult({ data }: { data: Record<string, unknown> }) {
  const tx = data.transaction as Record<string, string>
  const status = String(data.status ?? "")
  const isProposed = status === "proposed"
  const title = isProposed ? "Transaction Proposed" : "Manual Safe Action Required"
  const ctaLabel = isProposed ? "Open Safe Queue" : "Open Safe to Create"
  return (
    <Card size="sm" className="border-amber-500/20 bg-amber-500/5">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <ArrowUpRight className="size-4 text-amber-500" />
          <CardTitle className="text-sm text-amber-500">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {"message" in data && (
          <p className="text-sm text-muted-foreground">{String(data.message)}</p>
        )}
        <div className="space-y-1 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground">To:</span>
            <span className="truncate font-mono text-xs">{tx.to}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground">Value:</span>
            <span>{tx.value}</span>
          </div>
          {tx.data && tx.data !== "0x" && (
            <div className="flex gap-2">
              <span className="text-muted-foreground">Data:</span>
              <span className="truncate font-mono text-xs">{tx.data}</span>
            </div>
          )}
        </div>
        <a
          href={String(data.safeUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-400"
        >
          {ctaLabel}
          <ExternalLink className="size-3" />
        </a>
      </CardContent>
    </Card>
  )
}

function SafeInfoResult({ data }: { data: Record<string, unknown> }) {
  const owners = data.owners as string[]
  return (
    <Card size="sm" className="border-0 bg-secondary/50">
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
  if (txs.length === 0) {
    return (
      <Card size="sm" className="border-0 bg-secondary/50">
        <CardContent className="text-sm text-muted-foreground">
          No pending transactions.
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-2">
      {txs.map((tx) => (
        <Card key={String(tx.safeTxHash)} size="sm" className="border-0 bg-secondary/50">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleDot className="size-4 text-muted-foreground" />
                <CardTitle className="text-xs font-normal text-muted-foreground">Pending Tx</CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                {String(tx.confirmations)}/{String(tx.confirmationsRequired)} sigs
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground">To:</span>
              <span className="truncate font-mono text-xs">{String(tx.to)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Value:</span>
              <span>{String(tx.value)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function EnsResult({ data }: { data: Record<string, unknown> }) {
  return (
    <Card size="sm" className="border-0 bg-secondary/50">
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
    <Card size="sm" className="border-0 bg-secondary/50">
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

export function ToolResultCard({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") return null
  const data = result as Record<string, unknown>

  if ("nativeBalance" in data && "tokens" in data) return <BalanceResult data={data} />
  if ("safeUrl" in data && "transaction" in data) return <TransactionProposalResult data={data} />
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

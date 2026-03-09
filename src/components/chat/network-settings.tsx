"use client"

import { Globe, Settings2 } from "lucide-react"
import { NETWORK_PRESETS } from "@/lib/ethereum"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type NetworkFormState = {
  chainId: string
  rpcUrl: string
}

type NetworkSettingsProps = {
  value: NetworkFormState
  onChange: (value: NetworkFormState) => void
  isOpen: boolean
  onToggle: () => void
}

function getPresetId(value: NetworkFormState) {
  return (
    NETWORK_PRESETS.find(
      (preset) =>
        String(preset.chainId) === value.chainId && preset.rpcUrl === value.rpcUrl,
    )?.id ?? "custom"
  )
}

function getNetworkLabel(value: NetworkFormState) {
  const byChainId = NETWORK_PRESETS.find(
    (preset) => String(preset.chainId) === value.chainId,
  )
  return byChainId?.name ?? "Custom Network"
}

export function NetworkSettings({
  value,
  onChange,
  isOpen,
  onToggle,
}: NetworkSettingsProps) {
  const presetId = getPresetId(value)
  const networkLabel = getNetworkLabel(value)

  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="gap-2" onClick={onToggle}>
        <Globe className="size-3.5" />
        <span className="hidden sm:inline">{networkLabel}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {value.chainId || "?"}
        </span>
        <Settings2 className="size-3.5" />
      </Button>

      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-background p-4 shadow-lg">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Network Settings</p>
              <p className="text-xs text-muted-foreground">
                Pick a popular network or enter any RPC URL and chain ID.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Preset</span>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none"
                value={presetId}
                onChange={(event) => {
                  const nextId = event.target.value
                  const preset = NETWORK_PRESETS.find((entry) => entry.id === nextId)
                  if (!preset) return
                  onChange({
                    chainId: String(preset.chainId),
                    rpcUrl: preset.rpcUrl,
                  })
                }}
              >
                {NETWORK_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.chainId})
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">RPC URL</span>
              <Input
                value={value.rpcUrl}
                onChange={(event) =>
                  onChange({ ...value, rpcUrl: event.target.value })
                }
                placeholder="https://your-rpc.example"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Chain ID</span>
              <Input
                value={value.chainId}
                onChange={(event) =>
                  onChange({ ...value, chainId: event.target.value })
                }
                placeholder="42161"
                inputMode="numeric"
              />
            </label>

            <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              Active network: {networkLabel} ({value.chainId || "unknown"})
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

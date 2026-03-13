"use client";

import { ShieldAlert, Sparkles, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  applyNetworkPreset,
  getActiveModelDraftValue,
  getNetworkPresetId,
  getProviderLabel,
  getSuggestedModels,
  setActiveModelDraftValue,
  type LlmProvider,
  type RuntimeConfigDraft,
} from "@/lib/runtime-config";
import { NETWORK_PRESETS } from "@/lib/ethereum";

type RuntimeConfigSection =
  | "warning"
  | "model"
  | "network"
  | "safe"
  | "wallet"
  | "railgun";

type RuntimeConfigFormProps = {
  draft: RuntimeConfigDraft;
  onChange: (nextValue: RuntimeConfigDraft) => void;
  mode: "onboarding" | "settings";
  validationMessage?: string | null;
  providerOptions?: LlmProvider[];
  sections?: readonly RuntimeConfigSection[];
};

function updateDraftSection<K extends keyof RuntimeConfigDraft>(
  draft: RuntimeConfigDraft,
  section: K,
  value: RuntimeConfigDraft[K],
) {
  return {
    ...draft,
    [section]: value,
  };
}

function getSelectedPresetId(draft: RuntimeConfigDraft) {
  return getNetworkPresetId({
    chainId: Number(draft.network.chainId || 0),
    rpcUrl: draft.network.rpcUrl,
  });
}

export function RuntimeConfigForm({
  draft,
  onChange,
  mode,
  validationMessage,
  providerOptions = ["openrouter", "local"],
  sections = ["warning", "model", "network", "safe", "wallet", "railgun"],
}: RuntimeConfigFormProps) {
  const visibleSections = new Set(sections);
  const allowedProviders: LlmProvider[] =
    providerOptions.length > 0 ? [...providerOptions] : ["local"];
  const selectedProviderLabel = getProviderLabel(draft.llm.provider);
  const selectedPresetId = getSelectedPresetId(draft);
  const activeModel = getActiveModelDraftValue(draft);
  const suggestedModels = getSuggestedModels(draft.llm.provider);

  return (
    <div className="space-y-4">
      {visibleSections.has("warning") ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4" />
              Browser Storage Warning
            </CardTitle>
            <CardDescription>
              EOA and Safe signer keys are stored in this browser profile on this machine.
              Use dedicated low-value wallets. Delete all settings if this device is shared.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {visibleSections.has("model") ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Model Runtime
            </CardTitle>
            <CardDescription>
              {allowedProviders.length > 1
                ? "Choose the provider first. The same chat UI works with either backend."
                : "Normal mode uses your own local model endpoint. OpenRouter is reserved for developer mode."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {allowedProviders.length > 1 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {allowedProviders.map((provider) => {
                  const isActive = draft.llm.provider === provider;
                  return (
                    <button
                      key={provider}
                      type="button"
                      data-testid={`runtime-provider-${provider}`}
                      onClick={() =>
                        onChange(
                          updateDraftSection(draft, "llm", {
                            ...draft.llm,
                            provider,
                          }),
                        )
                      }
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <div className="text-sm font-medium">{getProviderLabel(provider)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {provider === "openrouter"
                          ? "Uses the developer-only OpenRouter key from dotenvx for local development and E2E."
                          : "Uses your own local OpenAI-compatible endpoint such as Ollama or LM Studio."}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                Provider: <span className="font-medium text-foreground">Local</span>
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                {selectedProviderLabel} model
              </span>
              <Input
                data-testid="runtime-active-model"
                value={activeModel}
                onChange={(event) =>
                  onChange(setActiveModelDraftValue(draft, event.target.value))
                }
                placeholder={
                  draft.llm.provider === "openrouter"
                    ? "qwen/qwen3.5-27b"
                    : "qwen3:8b"
                }
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {suggestedModels.map((model) => (
                <Button
                  key={model}
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => onChange(setActiveModelDraftValue(draft, model))}
                >
                  {model}
                </Button>
              ))}
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                Local provider base URL
              </span>
              <Input
                data-testid="runtime-local-base-url"
                value={draft.llm.localBaseUrl}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "llm", {
                      ...draft.llm,
                      localBaseUrl: event.target.value,
                    }),
                  )
                }
                placeholder="http://127.0.0.1:11434/v1"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Timeout (ms)</span>
              <Input
                data-testid="runtime-timeout-ms"
                value={draft.llm.timeoutMs}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "llm", {
                      ...draft.llm,
                      timeoutMs: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>

            <div className="rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              {draft.llm.provider === "openrouter"
                ? "OpenRouter handles chat completions. Your prompts and tool outputs leave the machine for inference."
                : "Local mode talks only to the base URL above. A working local model server is required to send messages."}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {visibleSections.has("network") ? (
      <Card>
        <CardHeader>
          <CardTitle>Selected Network</CardTitle>
          <CardDescription>
            This controls read tools and normal EOA transfers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Preset</span>
            <select
              data-testid="runtime-network-preset"
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
              value={selectedPresetId}
              onChange={(event) => {
                const nextId = event.target.value;
                if (nextId === "custom") {
                  return;
                }
                onChange(applyNetworkPreset(draft, nextId));
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
              data-testid="runtime-network-rpc-url"
              value={draft.network.rpcUrl}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "network", {
                    ...draft.network,
                    rpcUrl: event.target.value,
                  }),
                )
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Chain ID</span>
            <Input
              data-testid="runtime-network-chain-id"
              value={draft.network.chainId}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "network", {
                    ...draft.network,
                    chainId: event.target.value,
                  }),
                )
              }
              inputMode="numeric"
            />
          </label>
        </CardContent>
      </Card>
      ) : null}

      {visibleSections.has("safe") ? (
      <Card>
        <CardHeader>
          <CardTitle>Safe Settings</CardTitle>
          <CardDescription>
            The Safe config stays separate from the selected read/send network.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Safe address</span>
            <Input
              data-testid="runtime-safe-address"
              value={draft.safe.address}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "safe", {
                    ...draft.safe,
                    address: event.target.value,
                  }),
                )
              }
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Safe RPC URL</span>
              <Input
                data-testid="runtime-safe-rpc-url"
                value={draft.safe.rpcUrl}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "safe", {
                      ...draft.safe,
                      rpcUrl: event.target.value,
                    }),
                  )
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Safe chain ID</span>
              <Input
                data-testid="runtime-safe-chain-id"
                value={draft.safe.chainId}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "safe", {
                      ...draft.safe,
                      chainId: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Safe signer private key (optional)
            </span>
            <Input
              data-testid="runtime-safe-signer-private-key"
              type="password"
              value={draft.safe.signerPrivateKey}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "safe", {
                    ...draft.safe,
                    signerPrivateKey: event.target.value,
                  }),
                )
              }
              placeholder="Leave blank for manual Safe UI creation"
            />
          </label>
        </CardContent>
      </Card>
      ) : null}

      {visibleSections.has("wallet") ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4" />
            Wallet Keys
          </CardTitle>
          <CardDescription>
            Rotate these keys any time from settings. Saving replaces the stored value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">EOA private key</span>
            <Input
              data-testid="runtime-eoa-private-key"
              type="password"
              value={draft.wallet.eoaPrivateKey}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "wallet", {
                    ...draft.wallet,
                    eoaPrivateKey: event.target.value,
                  }),
                )
              }
              placeholder="0x..."
            />
          </label>

          <label className="flex items-start gap-3 rounded-xl border bg-secondary/20 px-4 py-3">
            <input
              data-testid="runtime-approval-enabled"
              type="checkbox"
              checked={draft.wallet.approvalPolicy.enabled}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "wallet", {
                    ...draft.wallet,
                    approvalPolicy: {
                      ...draft.wallet.approvalPolicy,
                      enabled: event.target.checked,
                    },
                  }),
                )
              }
              className="mt-0.5 size-4 rounded border-input"
            />
            <div className="space-y-1">
              <span className="block text-sm font-medium">Require local approval for high-value sends</span>
              <p className="text-xs text-muted-foreground">
                Transfers above the configured threshold must be approved in the local chat UI before signing.
              </p>
            </div>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Native threshold</span>
              <Input
                data-testid="runtime-approval-native-threshold"
                value={draft.wallet.approvalPolicy.nativeThreshold}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "wallet", {
                      ...draft.wallet,
                      approvalPolicy: {
                        ...draft.wallet.approvalPolicy,
                        nativeThreshold: event.target.value,
                      },
                    }),
                  )
                }
                placeholder="0.5"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">ERC-20 threshold</span>
              <Input
                data-testid="runtime-approval-erc20-threshold"
                value={draft.wallet.approvalPolicy.erc20Threshold}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "wallet", {
                      ...draft.wallet,
                      approvalPolicy: {
                        ...draft.wallet.approvalPolicy,
                        erc20Threshold: event.target.value,
                      },
                    }),
                  )
                }
                placeholder="1000"
              />
            </label>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {visibleSections.has("railgun") ? (
      <Card>
        <CardHeader>
          <CardTitle>Railgun Settings</CardTitle>
          <CardDescription>
            These settings are used only for private Railgun operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Network label</span>
              <Input
                data-testid="runtime-railgun-network-label"
                value={draft.railgun.networkLabel}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "railgun", {
                      ...draft.railgun,
                      networkLabel: event.target.value,
                    }),
                  )
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Chain ID</span>
              <Input
                data-testid="runtime-railgun-chain-id"
                value={draft.railgun.chainId}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "railgun", {
                      ...draft.railgun,
                      chainId: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Railgun RPC URL</span>
            <Input
              data-testid="runtime-railgun-rpc-url"
              value={draft.railgun.rpcUrl}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "railgun", {
                    ...draft.railgun,
                    rpcUrl: event.target.value,
                  }),
                )
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Explorer TX base URL</span>
            <Input
              data-testid="runtime-railgun-explorer-url"
              value={draft.railgun.explorerTxBaseUrl}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "railgun", {
                    ...draft.railgun,
                    explorerTxBaseUrl: event.target.value,
                  }),
                )
              }
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              POI node URLs (one per line)
            </span>
            <Textarea
              data-testid="runtime-railgun-poi-node-urls"
              value={draft.railgun.poiNodeUrls}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "railgun", {
                    ...draft.railgun,
                    poiNodeUrls: event.target.value,
                  }),
                )
              }
              rows={3}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Railgun mnemonic (optional)
            </span>
            <Textarea
              data-testid="runtime-railgun-mnemonic"
              value={draft.railgun.mnemonic}
              onChange={(event) =>
                onChange(
                  updateDraftSection(draft, "railgun", {
                    ...draft.railgun,
                    mnemonic: event.target.value,
                  }),
                )
              }
              rows={2}
              placeholder="Leave blank to derive one from the EOA key for testing"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                Wallet creation block
              </span>
              <Input
                data-testid="runtime-railgun-wallet-creation-block"
                value={draft.railgun.walletCreationBlock}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "railgun", {
                      ...draft.railgun,
                      walletCreationBlock: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Scan timeout (ms)</span>
              <Input
                data-testid="runtime-railgun-scan-timeout-ms"
                value={draft.railgun.scanTimeoutMs}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "railgun", {
                      ...draft.railgun,
                      scanTimeoutMs: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                Polling interval (ms)
              </span>
              <Input
                data-testid="runtime-railgun-polling-interval-ms"
                value={draft.railgun.pollingIntervalMs}
                onChange={(event) =>
                  onChange(
                    updateDraftSection(draft, "railgun", {
                      ...draft.railgun,
                      pollingIntervalMs: event.target.value,
                    }),
                  )
                }
                inputMode="numeric"
              />
            </label>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {validationMessage ? (
        <div
          data-testid="runtime-form-error"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {validationMessage}
        </div>
      ) : null}

      {mode === "onboarding" ? (
        <p className="text-center text-xs text-muted-foreground">
          Finish onboarding once, then edit, rotate, reset, or delete all settings later
          from the header.
        </p>
      ) : null}
    </div>
  );
}

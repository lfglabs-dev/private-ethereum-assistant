"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
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
  type AppMode,
  type LlmProvider,
  type RuntimeConfigDraft,
} from "@/lib/runtime-config";
import { NETWORK_PRESETS } from "@/lib/ethereum";
import { getExecutionModeOptions } from "@/lib/mode";

type RuntimeConfigSection =
  | "warning"
  | "model"
  | "network"
  | "keys"
  | "actor"
  | "safe"
  | "wallet"
  | "railgun";

type EnvSecretStatus = {
  eoaPrivateKey: boolean;
  safeSignerPrivateKey: boolean;
  safeApiKey: boolean;
  railgunMnemonic: boolean;
  accessDenied: boolean;
};

type EnvSecretDraft = {
  eoaPrivateKey: string;
  safeSignerPrivateKey: string;
  safeApiKey: string;
  railgunMnemonic: string;
};

type SaveKeysResult = { ok: true } | { ok: false; message: string };

type RuntimeConfigFormProps = {
  appMode: AppMode;
  draft: RuntimeConfigDraft;
  onChange: (nextValue: RuntimeConfigDraft) => void;
  mode: "onboarding" | "settings";
  validationMessage?: string | null;
  providerOptions?: LlmProvider[];
  sections?: readonly RuntimeConfigSection[];
};

export type RuntimeConfigFormHandle = {
  saveKeys: () => Promise<SaveKeysResult>;
};

const MODE_OPTIONS = getExecutionModeOptions();
const EMPTY_ENV_STATUS: EnvSecretStatus = {
  eoaPrivateKey: false,
  safeSignerPrivateKey: false,
  safeApiKey: false,
  railgunMnemonic: false,
  accessDenied: false,
};
const EMPTY_ENV_SECRET_DRAFT: EnvSecretDraft = {
  eoaPrivateKey: "",
  safeSignerPrivateKey: "",
  safeApiKey: "",
  railgunMnemonic: "",
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

function FieldStatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${
        configured
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      {configured ? "Configured" : "Not set"}
    </span>
  );
}

export const RuntimeConfigForm = forwardRef<RuntimeConfigFormHandle, RuntimeConfigFormProps>(
  function RuntimeConfigForm(
    {
      appMode,
      draft,
      onChange,
      mode,
      validationMessage,
      providerOptions = ["openrouter", "local"],
      sections = ["warning", "model", "network", "keys", "actor", "safe", "wallet", "railgun"],
    }: RuntimeConfigFormProps,
    ref,
  ) {
    const visibleSections = new Set(sections);
    const includesKeys = visibleSections.has("keys");
    const includesRailgun = visibleSections.has("railgun");
    const allowedProviders: LlmProvider[] =
      providerOptions.length > 0 ? [...providerOptions] : ["local"];
    const selectedProviderLabel = getProviderLabel(draft.llm.provider);
    const selectedPresetId = getSelectedPresetId(draft);
    const activeModel = getActiveModelDraftValue(draft);
    const suggestedModels = getSuggestedModels(draft.llm.provider);
    const railgunMnemonicRef = useRef<HTMLTextAreaElement | null>(null);
    const [envStatus, setEnvStatus] = useState<EnvSecretStatus>(EMPTY_ENV_STATUS);
    const [keysDraft, setKeysDraft] = useState<EnvSecretDraft>(EMPTY_ENV_SECRET_DRAFT);
    const [editingKeys, setEditingKeys] = useState(false);
    const [keyMessage, setKeyMessage] = useState<string | null>(null);
    const [isLoadingEnvStatus, setIsLoadingEnvStatus] = useState(false);
    const [didGenerateRailgunMnemonic, setDidGenerateRailgunMnemonic] = useState(false);
    const [saveEnvConfirmationToken, setSaveEnvConfirmationToken] = useState("");
    const isDeveloperMode = appMode === "developer";
    const hasRailgunMnemonic = draft.railgun.mnemonic.trim().length > 0;

    const loadEnvStatus = async () => {
      setIsLoadingEnvStatus(true);

      try {
        const response = await fetch("/api/env-status", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as Partial<EnvSecretStatus> & {
          saveEnvConfirmationToken?: string;
        };

        if (!response.ok) {
          throw new Error("Could not load key status.");
        }

        setEnvStatus({
          eoaPrivateKey: Boolean(payload.eoaPrivateKey),
          safeSignerPrivateKey: Boolean(payload.safeSignerPrivateKey),
          safeApiKey: Boolean(payload.safeApiKey),
          railgunMnemonic: Boolean(payload.railgunMnemonic),
          accessDenied: Boolean(payload.accessDenied),
        });
        setSaveEnvConfirmationToken(payload.saveEnvConfirmationToken ?? "");
        setKeyMessage(
          payload.accessDenied
            ? "macOS Keychain access was denied while checking configured keys."
            : null,
        );
        return payload;
      } catch (error) {
        setKeyMessage(
          error instanceof Error ? error.message : "Could not load key status.",
        );
        return null;
      } finally {
        setIsLoadingEnvStatus(false);
      }
    };

    useEffect(() => {
      if (!includesKeys) {
        return;
      }

      void loadEnvStatus();
    }, [includesKeys]);

    useImperativeHandle(
      ref,
      () => ({
        saveKeys: async () => {
          setKeyMessage(null);

          const payload: Partial<EnvSecretDraft> = {};
          const eoaPrivateKey = keysDraft.eoaPrivateKey.trim();
          const safeSignerPrivateKey = keysDraft.safeSignerPrivateKey.trim();
          const safeApiKey = keysDraft.safeApiKey.trim();

          if (eoaPrivateKey) {
            payload.eoaPrivateKey = eoaPrivateKey;
          }
          if (safeSignerPrivateKey) {
            payload.safeSignerPrivateKey = safeSignerPrivateKey;
          }
          if (safeApiKey) {
            payload.safeApiKey = safeApiKey;
          }
          if (!isDeveloperMode) {
            const railgunMnemonic = draft.railgun.mnemonic.trim();
            if (railgunMnemonic) {
              payload.railgunMnemonic = railgunMnemonic;
            }
          }

          if (mode === "onboarding" && !envStatus.eoaPrivateKey && !payload.eoaPrivateKey) {
            const message = "Enter an EOA private key to continue.";
            setKeyMessage(message);
            return { ok: false, message };
          }

          if (
            mode === "onboarding" &&
            includesRailgun &&
            !isDeveloperMode &&
            !envStatus.railgunMnemonic &&
            !payload.railgunMnemonic
          ) {
            const message =
              "Generate or import a Railgun mnemonic before continuing.";
            setKeyMessage(message);
            return { ok: false, message };
          }

          if (Object.keys(payload).length === 0) {
            return { ok: true };
          }

          try {
            const refreshedEnvStatus =
              saveEnvConfirmationToken.length > 0 ? null : await loadEnvStatus();
            const confirmationToken =
              refreshedEnvStatus?.saveEnvConfirmationToken ?? saveEnvConfirmationToken;

            if (!confirmationToken) {
              const message = "Could not prepare secure key save. Refresh and try again.";
              setKeyMessage(message);
              return { ok: false, message };
            }

            const response = await fetch("/api/save-env", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...payload,
                saveEnvConfirmationToken: confirmationToken,
              }),
            });
            const result = (await response.json()) as
              | { error?: string; saved?: string[] }
              | undefined;

            if (!response.ok) {
              const message = result?.error ?? "Failed to save keys.";
              setKeyMessage(message);
              return { ok: false, message };
            }

            setKeysDraft(EMPTY_ENV_SECRET_DRAFT);
            setEditingKeys(false);
            setEnvStatus((current) => ({
              eoaPrivateKey:
                current.eoaPrivateKey ||
                Boolean(result?.saved?.includes("eoaPrivateKey")),
              safeSignerPrivateKey:
                current.safeSignerPrivateKey ||
                Boolean(result?.saved?.includes("safeSignerPrivateKey")),
              safeApiKey:
                current.safeApiKey || Boolean(result?.saved?.includes("safeApiKey")),
              railgunMnemonic:
                current.railgunMnemonic ||
                Boolean(result?.saved?.includes("railgunMnemonic")),
              accessDenied: false,
            }));
            await loadEnvStatus();
            return { ok: true };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Failed to save keys.";
            setKeyMessage(message);
            return { ok: false, message };
          }
        },
      }),
      [
        draft.railgun.mnemonic,
        envStatus.eoaPrivateKey,
        envStatus.railgunMnemonic,
        includesRailgun,
        isDeveloperMode,
        keysDraft,
        mode,
        saveEnvConfirmationToken,
      ],
    );

    const formMessages = [keyMessage, validationMessage].filter(
      (message, index, values): message is string =>
        typeof message === "string" && values.indexOf(message) === index,
    );

    const updateRailgunMnemonic = (mnemonic: string) => {
      onChange(
        updateDraftSection(draft, "railgun", {
          ...draft.railgun,
          mnemonic,
        }),
      );
    };

    const handleGenerateRailgunMnemonic = () => {
      updateRailgunMnemonic(generateMnemonic(wordlist));
      setDidGenerateRailgunMnemonic(true);
    };

    const handleImportRailgunMnemonic = () => {
      setDidGenerateRailgunMnemonic(false);
      railgunMnemonicRef.current?.focus();
      railgunMnemonicRef.current?.select();
    };

    return (
      <div className="space-y-4">
        {visibleSections.has("warning") ? (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4" />
                Local Storage Model
              </CardTitle>
              <CardDescription>
                Non-secret preferences stay in browser storage. Wallet keys are saved
                later to the macOS Keychain on this machine instead.
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
                      : "llama3.2:3b"
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

        {visibleSections.has("keys") ? (
          <Card>
            <CardHeader>
              <CardTitle>Keys</CardTitle>
              <CardDescription>
                Saved to the macOS Keychain on this machine. These values never enter
                browser storage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block space-y-1">
                <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>EOA private key</span>
                  <FieldStatusBadge configured={envStatus.eoaPrivateKey} />
                </span>
                <Input
                  data-testid="runtime-eoa-private-key"
                  type="password"
                  value={keysDraft.eoaPrivateKey}
                  onChange={(event) =>
                    setKeysDraft((current) => ({
                      ...current,
                      eoaPrivateKey: event.target.value,
                    }))
                  }
                  placeholder={
                    envStatus.eoaPrivateKey ? "••••••• (already configured)" : "0x..."
                  }
                  disabled={envStatus.eoaPrivateKey && !editingKeys}
                />
              </label>

              <label className="block space-y-1">
                <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Safe signer private key (optional)</span>
                  <FieldStatusBadge configured={envStatus.safeSignerPrivateKey} />
                </span>
                <Input
                  data-testid="runtime-safe-signer-private-key"
                  type="password"
                  value={keysDraft.safeSignerPrivateKey}
                  onChange={(event) =>
                    setKeysDraft((current) => ({
                      ...current,
                      safeSignerPrivateKey: event.target.value,
                    }))
                  }
                  placeholder={
                    envStatus.safeSignerPrivateKey
                      ? "••••••• (already configured)"
                      : "Leave blank for manual Safe UI creation"
                  }
                  disabled={envStatus.safeSignerPrivateKey && !editingKeys}
                />
              </label>

              <label className="block space-y-1">
                <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Safe API key (optional)</span>
                  <FieldStatusBadge configured={envStatus.safeApiKey} />
                </span>
                <Input
                  data-testid="runtime-safe-api-key"
                  type="password"
                  value={keysDraft.safeApiKey}
                  onChange={(event) =>
                    setKeysDraft((current) => ({
                      ...current,
                      safeApiKey: event.target.value,
                    }))
                  }
                  placeholder={
                    envStatus.safeApiKey
                      ? "••••••• (already configured)"
                      : "Get one at app.safe.global/settings"
                  }
                  disabled={envStatus.safeApiKey && !editingKeys}
                />
                <span className="text-xs text-muted-foreground">
                  Enables automatic Safe transaction proposals. Without it, you sign
                  manually in the Safe App.
                </span>
              </label>

              {(envStatus.eoaPrivateKey ||
                envStatus.safeSignerPrivateKey ||
                envStatus.safeApiKey) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingKeys((current) => !current);
                    setKeysDraft(EMPTY_ENV_SECRET_DRAFT);
                    setKeyMessage(null);
                  }}
                >
                  {editingKeys ? "Cancel edit" : "Edit keys"}
                </Button>
              )}

              <p className="text-xs text-muted-foreground">
                Keys are stored in the macOS Keychain on this machine. Use dedicated
                low-value wallets.
              </p>

              {isLoadingEnvStatus ? (
                <p className="text-xs text-muted-foreground">Checking configured keys…</p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {visibleSections.has("actor") ? (
          <Card>
            <CardHeader>
              <CardTitle>Execution Mode</CardTitle>
              <CardDescription>
                This is the active execution boundary for sends, Safe actions, swaps,
                and private flows.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              {MODE_OPTIONS.map((modeOption) => {
                const isActive = draft.actor.type === modeOption.value;
                return (
                  <button
                    key={modeOption.value}
                    type="button"
                    data-testid={`runtime-mode-${modeOption.value}`}
                    onClick={() =>
                      onChange(
                        updateDraftSection(draft, "actor", {
                          type: modeOption.value,
                        }),
                      )
                    }
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    <div className="text-sm font-medium">{modeOption.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {modeOption.description}
                    </div>
                  </button>
                );
              })}
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
            </CardContent>
          </Card>
        ) : null}

        {visibleSections.has("wallet") ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4" />
                Wallet Approval Policy
              </CardTitle>
              <CardDescription>
                Configure when the assistant should pause for local confirmation
                before sending value.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <span className="block text-sm font-medium">
                    Require local approval for high-value sends
                  </span>
                  <p className="text-xs text-muted-foreground">
                    Transfers above the configured threshold must be approved in the
                    local chat UI before signing.
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
                {isDeveloperMode
                  ? "These settings are used only for private Railgun operations."
                  : "Railgun uses a separate private wallet. Generate or import its recovery phrase before you shield funds."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isDeveloperMode ? (
                <div className="rounded-xl border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                  Developer mode hardcodes the Railgun wallet to the configured EOA
                  private key. The mnemonic is not editable here.
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Save the Railgun recovery phrase before shielding.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Railgun is a separate private wallet from your public EOA. If you
                      lose this mnemonic, you can lose access to shielded Railgun funds.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleGenerateRailgunMnemonic}
                    >
                      {hasRailgunMnemonic ? "Generate new mnemonic" : "Generate mnemonic"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleImportRailgunMnemonic}
                    >
                      Import existing mnemonic
                    </Button>
                  </div>
                  {didGenerateRailgunMnemonic ? (
                    <p className="text-xs text-foreground">
                      A new Railgun mnemonic was generated below. Back it up now before
                      continuing.
                    </p>
                  ) : null}
                </div>
              )}

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
                <span className="text-xs text-muted-foreground">Privacy guidance text</span>
                <Textarea
                  data-testid="runtime-railgun-privacy-guidance"
                  value={draft.railgun.privacyGuidanceText}
                  onChange={(event) =>
                    onChange(
                      updateDraftSection(draft, "railgun", {
                        ...draft.railgun,
                        privacyGuidanceText: event.target.value,
                      }),
                    )
                  }
                  rows={3}
                  placeholder="Explain that shielding is public first, then future Railgun actions use private balance."
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

              {isDeveloperMode ? (
                <div className="block space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Railgun mnemonic source
                  </span>
                  <div className="rounded-xl border bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
                    Fixed to the EOA private key configured for developer mode.
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Developer mode always derives the same Railgun wallet from that EOA
                    key. Switch to standard mode if you want a dedicated Railgun mnemonic.
                  </span>
                </div>
              ) : (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Railgun mnemonic</span>
                  <Textarea
                    ref={railgunMnemonicRef}
                    data-testid="runtime-railgun-mnemonic"
                    value={draft.railgun.mnemonic}
                    onChange={(event) => updateRailgunMnemonic(event.target.value)}
                    rows={2}
                    placeholder="Generate a new Railgun mnemonic or paste an existing one"
                  />
                  <span className="text-xs text-muted-foreground">
                    This phrase controls your private Railgun balance. Store it in a
                    password manager or offline backup before using Railgun.
                  </span>
                </label>
              )}

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

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Shield approval threshold
                  </span>
                  <Input
                    data-testid="runtime-railgun-shield-approval-threshold"
                    value={draft.railgun.shieldApprovalThreshold}
                    onChange={(event) =>
                      onChange(
                        updateDraftSection(draft, "railgun", {
                          ...draft.railgun,
                          shieldApprovalThreshold: event.target.value,
                        }),
                      )
                    }
                    inputMode="decimal"
                    placeholder="1"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Private transfer threshold
                  </span>
                  <Input
                    data-testid="runtime-railgun-transfer-approval-threshold"
                    value={draft.railgun.transferApprovalThreshold}
                    onChange={(event) =>
                      onChange(
                        updateDraftSection(draft, "railgun", {
                          ...draft.railgun,
                          transferApprovalThreshold: event.target.value,
                        }),
                      )
                    }
                    inputMode="decimal"
                    placeholder="1"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Unshield approval threshold
                  </span>
                  <Input
                    data-testid="runtime-railgun-unshield-approval-threshold"
                    value={draft.railgun.unshieldApprovalThreshold}
                    onChange={(event) =>
                      onChange(
                        updateDraftSection(draft, "railgun", {
                          ...draft.railgun,
                          unshieldApprovalThreshold: event.target.value,
                        }),
                      )
                    }
                    inputMode="decimal"
                    placeholder="1"
                  />
                </label>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {formMessages.map((message) => (
          <div
            key={message}
            data-testid="runtime-form-error"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {message}
          </div>
        ))}

        {mode === "onboarding" ? (
          <p className="text-center text-xs text-muted-foreground">
            Finish onboarding once, then edit, rotate, reset, or delete browser
            settings later from the header.
          </p>
        ) : null}
      </div>
    );
  },
);

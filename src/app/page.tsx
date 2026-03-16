"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useChat } from "@ai-sdk/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { ZodError } from "zod";
import { EthereumIcon } from "@/components/icons/ethereum-icon";
import { RuntimeConfigForm } from "@/components/chat/runtime-config-form";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { ChatMessage } from "@/components/chat/chat-message";
import { ChatDebugPanel } from "@/components/chat/chat-debug-panel";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatError } from "@/components/chat/chat-error";
import { ThemeToggle } from "@/components/theme-toggle";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import {
  assistantDataPartSchemas,
  type AssistantUIMessage,
  type DebugLogEntry,
  createDebugLog,
} from "@/lib/chat-stream";
import {
  createDeveloperDisplayRuntimeConfig,
  clearStoredRuntimeConfig,
  createDefaultRuntimeConfig,
  createRuntimeConfigDraft,
  getAppMode,
  getProviderLabel,
  loadStoredRuntimeConfig,
  mergeDeveloperDisplayRuntimeConfig,
  parseRuntimeConfigDraft,
  saveStoredRuntimeConfig,
  subscribeToStoredRuntimeConfig,
  type AppMode,
  type RuntimeConfig,
  type RuntimeConfigDraft,
} from "@/lib/runtime-config";
import { getNetworkLabel } from "@/lib/ethereum";

const STANDARD_ONBOARDING_STEPS = [
  {
    title: "Local model",
    description: "Point the app at your own local OpenAI-compatible model endpoint.",
    sections: ["warning", "model"] as const,
  },
  {
    title: "Network",
    description: "Choose the read/send network for normal wallet activity.",
    sections: ["network"] as const,
  },
  {
    title: "Wallet",
    description: "Add the low-value EOA you want to use for normal transfers.",
    sections: ["wallet"] as const,
  },
  {
    title: "Safe and Railgun",
    description: "Choose the active actor, then finish the Safe and Railgun settings.",
    sections: ["actor", "safe", "railgun"] as const,
  },
];

function createStandardRuntimeConfigDraft() {
  const runtimeConfig = createDefaultRuntimeConfig();
  return createRuntimeConfigDraft({
    ...runtimeConfig,
    llm: {
      ...runtimeConfig.llm,
      provider: "local",
    },
  });
}

function getValidationMessage(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Invalid runtime config.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Invalid runtime config.";
}

type ConfiguredAssistantProps = {
  runtimeConfig: RuntimeConfig;
  appMode: AppMode;
  onSaveRuntimeConfig: (runtimeConfig: RuntimeConfig) => void;
  onDeleteAllSettings: () => void;
};

function ConfiguredAssistant({
  runtimeConfig,
  appMode,
  onSaveRuntimeConfig,
  onDeleteAllSettings,
}: ConfiguredAssistantProps) {
  const [debugEntries, setDebugEntries] = useState<DebugLogEntry[]>([]);
  const [showDebugTrace, setShowDebugTrace] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<RuntimeConfigDraft>(() =>
    createRuntimeConfigDraft(runtimeConfig),
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useScrollToBottom();

  const appendDebugEntry = (entry: DebugLogEntry) => {
    setDebugEntries((entries) => [...entries.slice(-23), entry]);
  };

  const { messages, sendMessage, stop, status, error, clearError } =
    useChat<AssistantUIMessage>({
      dataPartSchemas: assistantDataPartSchemas,
      onData: (part) => {
        if (part.type !== "data-debug") return;

        appendDebugEntry(part.data);
        if (part.data.level === "error") {
          setShowDebugTrace(true);
        }
      },
      onError: (nextError) => {
        appendDebugEntry(
          createDebugLog({
            level: "error",
            stage: "error",
            message: "Chat request failed",
            detail: nextError.message || "Unknown chat error",
          }),
        );
        setShowDebugTrace(true);
      },
    });

  const isLoading = status === "submitted" || status === "streaming";
  const isSubmitted = status === "submitted";
  const providerLabel = getProviderLabel(runtimeConfig.llm.provider);
  const activeNetworkLabel = getNetworkLabel(runtimeConfig.network);
  const activeActorLabel = runtimeConfig.actor.type.toUpperCase();
  const settingsEnabled = true;
  const settingsProviderOptions: Array<"openrouter" | "local"> =
    appMode === "developer" ? ["openrouter", "local"] : ["local"];
  const settingsSections =
    appMode === "developer"
      ? (["model", "network", "actor", "safe", "railgun"] as const)
      : undefined;

  useEffect(() => {
    const hasRailgunCredential =
      runtimeConfig.wallet.eoaPrivateKey.trim().length > 0 ||
      runtimeConfig.railgun.mnemonic.trim().length > 0;

    if (!hasRailgunCredential) {
      return;
    }

    let cancelled = false;

    const warmRailgun = async () => {
      try {
        await fetch("/api/railgun-warm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            runtimeConfig,
          }),
        });
      } catch {
        if (!cancelled) {
          // Ignore warm-up failures here and let on-demand actions report errors.
        }
      }
    };

    void warmRailgun();
    const intervalId = window.setInterval(() => {
      void warmRailgun();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [runtimeConfig]);

  const sendChatMessage = (text: string) => {
    setDebugEntries([]);
    setShowDebugTrace(false);
    sendMessage(
      { text },
      {
        body: {
          networkConfig: runtimeConfig.network,
          runtimeConfig,
        },
      },
    );
  };

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    clearError();
    sendChatMessage(input);
    setInput("");
  };

  const handleSuggestion = (suggestion: string) => {
    clearError();
    sendChatMessage(suggestion);
  };

  const handleSaveSettings = () => {
    try {
      const nextConfig = parseRuntimeConfigDraft(settingsDraft);
      onSaveRuntimeConfig(nextConfig);
      setSettingsError(null);
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(getValidationMessage(error));
    }
  };

  const handleResetChanges = () => {
    setSettingsDraft(createRuntimeConfigDraft(runtimeConfig));
    setSettingsError(null);
  };

  const handleResetDefaults = () => {
    setSettingsDraft(
      createRuntimeConfigDraft(
        appMode === "developer"
          ? createDeveloperDisplayRuntimeConfig()
          : createDefaultRuntimeConfig(),
      ),
    );
    setSettingsError(null);
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <EthereumIcon className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="font-serif text-sm font-semibold">
              Private Ethereum Assistant
            </h1>
            <p className="text-xs text-muted-foreground">
              {providerLabel} · {activeNetworkLabel} · Actor {activeActorLabel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
            <span
              className={`size-2 rounded-full ${
                runtimeConfig.llm.provider === "local"
                  ? "bg-green-500"
                  : "bg-amber-500"
              }`}
            />
            <span data-testid="runtime-provider-label">{providerLabel}</span>
          </div>
          {settingsEnabled ? (
            <Button
              data-testid="runtime-settings-trigger"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                setSettingsDraft(createRuntimeConfigDraft(runtimeConfig));
                setSettingsError(null);
                setSettingsOpen(true);
              }}
            >
              <Settings2 className="size-3.5" />
              Settings
            </Button>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <div ref={containerRef} className="relative flex-1 overflow-y-auto">
        <div ref={endRef} className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && !error ? (
            <ChatWelcome
              onSuggestionClick={handleSuggestion}
              providerLabel={providerLabel}
            />
          ) : null}

          {messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              runtimeConfig={runtimeConfig}
              isStreaming={
                isLoading &&
                index === messages.length - 1 &&
                message.role === "assistant"
              }
              traceEntries={debugEntries}
              showTrace={
                showDebugTrace &&
                index === messages.length - 1 &&
                message.role === "assistant"
              }
              canToggleTrace={index === messages.length - 1 && message.role === "assistant"}
              onToggleTrace={() => setShowDebugTrace((visible) => !visible)}
            />
          ))}

          {isSubmitted &&
          (messages.length === 0 || messages[messages.length - 1].role === "user") ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <button
                type="button"
                onClick={() => setShowDebugTrace((visible) => !visible)}
                className="rounded-full transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={showDebugTrace ? "Hide model trace" : "Show model trace"}
                title={showDebugTrace ? "Hide model trace" : "Show model trace"}
              >
                <Avatar size="sm" className="mt-0.5 shrink-0">
                  <AvatarFallback className="bg-secondary">
                    <EthereumIcon className="size-3.5" />
                  </AvatarFallback>
                </Avatar>
              </button>
              <div className="max-w-[80%] space-y-2">
                <div className="rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3">
                  <ThinkingIndicator />
                </div>
                {showDebugTrace ? (
                  <ChatDebugPanel entries={debugEntries} isStreaming={isLoading} />
                ) : null}
              </div>
            </motion.div>
          ) : null}

          {error ? (
            <div className="mx-auto max-w-3xl space-y-3">
              <ChatError error={error} onDismiss={clearError} />
              {debugEntries.length > 0 ? (
                <ChatDebugPanel entries={debugEntries} isStreaming={false} />
              ) : null}
            </div>
          ) : null}
        </div>

        <AnimatePresence>
          {!isAtBottom ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="sticky bottom-4 flex justify-center"
            >
              <Button
                variant="outline"
                size="icon"
                className="size-8 rounded-full bg-background/80 shadow-md backdrop-blur-sm"
                onClick={() => scrollToBottom()}
              >
                <ArrowDown className="size-4" />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        isLoading={isLoading}
        networkLabel={activeNetworkLabel}
        providerLabel={providerLabel}
      />

      <AnimatePresence>
        {settingsOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          >
            <motion.aside
              initial={{ x: 32, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 32, opacity: 0 }}
              className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l bg-background shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/90 px-6 py-4 backdrop-blur">
                <div>
                  <h2 className="text-sm font-semibold">Runtime Settings</h2>
                  <p className="text-xs text-muted-foreground">
                    Edit, rotate, reset, or delete all browser-stored settings.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <X className="size-4" />
                </Button>
              </div>

              <div className="space-y-4 px-6 py-6">
                <RuntimeConfigForm
                  draft={settingsDraft}
                  onChange={setSettingsDraft}
                  mode="settings"
                  validationMessage={settingsError}
                  providerOptions={settingsProviderOptions}
                  sections={settingsSections}
                />
              </div>

              <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-6 py-4 backdrop-blur">
                <div className="flex flex-wrap gap-2">
                  <Button
                    data-testid="runtime-settings-reset"
                    type="button"
                    variant="outline"
                    onClick={handleResetChanges}
                  >
                    <RefreshCw className="size-3.5" />
                    Reset changes
                  </Button>
                  <Button
                    data-testid="runtime-settings-reset-defaults"
                    type="button"
                    variant="outline"
                    onClick={handleResetDefaults}
                  >
                    Defaults
                  </Button>
                  <Button
                    data-testid="runtime-settings-delete-all"
                    type="button"
                    variant="destructive"
                    onClick={onDeleteAllSettings}
                  >
                    <Trash2 className="size-3.5" />
                    Delete all
                  </Button>
                </div>
                <Button
                  data-testid="runtime-settings-save"
                  type="button"
                  onClick={handleSaveSettings}
                >
                  Save settings
                </Button>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function Home() {
  const appMode = getAppMode();
  const runtimeConfig = useSyncExternalStore(
    subscribeToStoredRuntimeConfig,
    loadStoredRuntimeConfig,
    () => null,
  );
  const [sessionKey, setSessionKey] = useState(0);
  const [onboardingDraft, setOnboardingDraft] = useState<RuntimeConfigDraft>(
    createStandardRuntimeConfigDraft,
  );
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);

  const handleSaveRuntimeConfig = (nextRuntimeConfig: RuntimeConfig) => {
    saveStoredRuntimeConfig(nextRuntimeConfig);
  };

  const handleDeleteAllSettings = () => {
    clearStoredRuntimeConfig();
    setOnboardingDraft(createStandardRuntimeConfigDraft());
    setOnboardingError(null);
    setOnboardingStep(0);
    setSessionKey((value) => value + 1);
  };

  const handleCompleteOnboarding = () => {
    try {
      const nextRuntimeConfig = parseRuntimeConfigDraft(onboardingDraft);
      saveStoredRuntimeConfig(nextRuntimeConfig);
      setOnboardingError(null);
      setOnboardingStep(0);
      setSessionKey((value) => value + 1);
    } catch (error) {
      setOnboardingError(getValidationMessage(error));
    }
  };

  if (appMode === "developer") {
    const developerRuntimeConfig = mergeDeveloperDisplayRuntimeConfig(runtimeConfig);

    return (
      <ConfiguredAssistant
        key="developer-mode"
        runtimeConfig={developerRuntimeConfig}
        appMode={appMode}
        onSaveRuntimeConfig={handleSaveRuntimeConfig}
        onDeleteAllSettings={handleDeleteAllSettings}
      />
    );
  }

  if (runtimeConfig === null) {
    const step = STANDARD_ONBOARDING_STEPS[onboardingStep];
    const isLastStep = onboardingStep === STANDARD_ONBOARDING_STEPS.length - 1;

    return (
      <main
        data-testid="runtime-onboarding-screen"
        className="min-h-dvh bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.04),transparent_50%)] px-4 py-8"
      >
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10">
                <EthereumIcon className="size-5 text-primary" />
              </div>
              <div>
                <h1 className="font-serif text-2xl font-semibold tracking-tight">
                  Normal mode setup
                </h1>
                <p className="text-sm text-muted-foreground">
                  Local-only onboarding. OpenRouter is available only in developer mode.
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>

          <div className="rounded-2xl border bg-background/80 p-4 text-sm text-muted-foreground shadow-sm backdrop-blur">
            Step {onboardingStep + 1} of {STANDARD_ONBOARDING_STEPS.length}:{" "}
            <span className="font-medium text-foreground">{step.title}</span>. {step.description}
          </div>

          <RuntimeConfigForm
            draft={onboardingDraft}
            onChange={setOnboardingDraft}
            mode="onboarding"
            validationMessage={onboardingError}
            providerOptions={["local"]}
            sections={step.sections}
          />

          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={onboardingStep === 0}
              onClick={() => {
                setOnboardingError(null);
                setOnboardingStep((value) => Math.max(0, value - 1));
              }}
            >
              Back
            </Button>
            <Button
              data-testid="runtime-onboarding-submit"
              type="button"
              size="lg"
              onClick={() => {
                if (isLastStep) {
                  handleCompleteOnboarding();
                  return;
                }

                setOnboardingError(null);
                setOnboardingStep((value) =>
                  Math.min(STANDARD_ONBOARDING_STEPS.length - 1, value + 1),
                );
              }}
            >
              {isLastStep ? "Save and continue" : "Continue"}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ConfiguredAssistant
      key={sessionKey}
      runtimeConfig={runtimeConfig}
      appMode={appMode}
      onSaveRuntimeConfig={handleSaveRuntimeConfig}
      onDeleteAllSettings={handleDeleteAllSettings}
    />
  );
}

import { DEFAULT_NETWORK_CONFIG, type NetworkConfig } from "../ethereum";
import { createEoaTransferTools } from "./eoa-tx";
import { createReadChainTools } from "./read-chain";
import { createRailgunTools } from "./railgun";
import { createSafeTools } from "./safe";
import { createSwapTools } from "./swap";
import { guardToolRegistryForMode } from "./access-control";
import {
  createDefaultRuntimeConfig,
  getRuntimeConfigForNetwork,
  type RuntimeConfig,
} from "../runtime-config";
import { type ExecutionMode } from "../mode";

type EoaToolSet = ReturnType<typeof createEoaTransferTools>;
type ReadToolSet = ReturnType<typeof createReadChainTools>;
type SafeToolSet = ReturnType<typeof createSafeTools>;
type RailgunToolSet = ReturnType<typeof createRailgunTools>;
type SwapToolSet = ReturnType<typeof createSwapTools>;

type UniversalToolRegistry = {
  get_balance: ReadToolSet["getBalance"];
  get_portfolio: ReadToolSet["getPortfolio"];
  get_transaction: ReadToolSet["getTransaction"];
  resolve_ens: ReadToolSet["resolveEns"];
  reverse_resolve_ens: ReadToolSet["reverseResolveEns"];
};

export type EoaToolRegistry = UniversalToolRegistry & {
  send_token: EoaToolSet["sendToken"];
  send_eoa_transfer: EoaToolSet["sendEoaTransfer"];
  prepare_swap: SwapToolSet["prepareSwap"];
  execute_swap: SwapToolSet["executeSwap"];
};

export type SafeToolRegistry = UniversalToolRegistry & {
  get_safe_info: SafeToolSet["getSafeInfo"];
  get_pending_transactions: SafeToolSet["getPendingTransactions"];
  propose_transaction: SafeToolSet["proposeTransaction"];
  swap_tokens: SwapToolSet["swapTokens"];
};

export type PrivateToolRegistry = UniversalToolRegistry & {
  railgun_balance: RailgunToolSet["getRailgunBalance"];
  railgun_shield: RailgunToolSet["railgunShieldTokens"];
  railgun_transfer: RailgunToolSet["railgunPrivateTransfer"];
  railgun_unshield: RailgunToolSet["railgunWithdraw"];
};

export type ToolRegistry = EoaToolRegistry | SafeToolRegistry | PrivateToolRegistry;

type RuntimeConfigForMode<M extends ExecutionMode> = RuntimeConfig & {
  actor: {
    type: M;
  };
};

type ToolRegistryForMode<M extends ExecutionMode> = M extends "safe"
  ? SafeToolRegistry
  : M extends "railgun"
    ? PrivateToolRegistry
    : EoaToolRegistry;

function resolveRuntimeConfig(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
) {
  return runtimeConfig ?? getRuntimeConfigForNetwork(networkConfig);
}

export function getTools<M extends ExecutionMode>(
  networkConfig: NetworkConfig,
  runtimeConfig: RuntimeConfigForMode<M>,
): ToolRegistryForMode<M>;
export function getTools(
  networkConfig?: NetworkConfig,
  runtimeConfig?: RuntimeConfig,
): ToolRegistry;
export function getTools(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
): ToolRegistry {
  const resolvedRuntimeConfig = resolveRuntimeConfig(networkConfig, runtimeConfig);
  const activeMode = resolvedRuntimeConfig.actor.type as ExecutionMode;
  const { sendToken, sendEoaTransfer } = createEoaTransferTools(
    resolvedRuntimeConfig.network,
    resolvedRuntimeConfig.wallet,
  );
  const {
    getBalance,
    getPortfolio,
    getTransaction,
    resolveEns,
    reverseResolveEns,
  } = createReadChainTools(resolvedRuntimeConfig.network);
  const { getSafeInfo, getPendingTransactions, proposeTransaction } =
    createSafeTools(resolvedRuntimeConfig.safe);
  const {
    getRailgunBalance,
    railgunShieldTokens,
    railgunPrivateTransfer,
    railgunWithdraw,
  } = createRailgunTools({
    ...resolvedRuntimeConfig.railgun,
    signerPrivateKey: resolvedRuntimeConfig.wallet.eoaPrivateKey,
  });
  const { prepareSwap, executeSwap, swapTokens } = createSwapTools(resolvedRuntimeConfig);

  const universalTools = {
    get_balance: getBalance,
    get_portfolio: getPortfolio,
    get_transaction: getTransaction,
    resolve_ens: resolveEns,
    reverse_resolve_ens: reverseResolveEns,
  };

  if (activeMode === "safe") {
    const registry: SafeToolRegistry = {
      ...universalTools,
      get_safe_info: getSafeInfo,
      get_pending_transactions: getPendingTransactions,
      propose_transaction: proposeTransaction,
      swap_tokens: swapTokens,
    };
    return guardToolRegistryForMode(activeMode, registry as never) as ToolRegistry;
  }

  if (activeMode === "railgun") {
    const registry: PrivateToolRegistry = {
      ...universalTools,
      railgun_balance: getRailgunBalance,
      railgun_shield: railgunShieldTokens,
      railgun_transfer: railgunPrivateTransfer,
      railgun_unshield: railgunWithdraw,
    };
    return guardToolRegistryForMode(activeMode, registry as never) as ToolRegistry;
  }

  const registry: EoaToolRegistry = {
    ...universalTools,
    send_token: sendToken,
    send_eoa_transfer: sendEoaTransfer,
    prepare_swap: prepareSwap,
    execute_swap: executeSwap,
  };
  return guardToolRegistryForMode(activeMode, registry as never) as ToolRegistry;
}

export function createTools<M extends ExecutionMode>(
  networkConfig: NetworkConfig,
  runtimeConfig: RuntimeConfigForMode<M>,
): ToolRegistryForMode<M>;
export function createTools(
  networkConfig?: NetworkConfig,
  runtimeConfig?: RuntimeConfig,
): ToolRegistry;
export function createTools(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
): ToolRegistry {
  return getTools(networkConfig, runtimeConfig);
}

const defaultRuntimeConfig = createDefaultRuntimeConfig();

export const tools = getTools(defaultRuntimeConfig.network, defaultRuntimeConfig);

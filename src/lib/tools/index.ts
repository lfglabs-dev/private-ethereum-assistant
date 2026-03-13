import { DEFAULT_NETWORK_CONFIG, type NetworkConfig } from "../ethereum";
import { createEoaTransferTools } from "./eoa-tx";
import { createReadChainTools } from "./read-chain";
import { createRailgunTools } from "./railgun";
import { createSafeTools } from "./safe";
import {
  createDefaultRuntimeConfig,
  getRuntimeConfigForNetwork,
  type RuntimeConfig,
} from "../runtime-config";

function resolveRuntimeConfig(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
) {
  return runtimeConfig ?? getRuntimeConfigForNetwork(networkConfig);
}

export function getTools(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
) {
  const resolvedRuntimeConfig = resolveRuntimeConfig(networkConfig, runtimeConfig);
  const { prepareEoaTransfer, sendEoaTransfer } = createEoaTransferTools(
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

  return {
    prepare_eoa_transfer: prepareEoaTransfer,
    send_eoa_transfer: sendEoaTransfer,
    get_balance: getBalance,
    get_portfolio: getPortfolio,
    get_transaction: getTransaction,
    resolve_ens: resolveEns,
    reverse_resolve_ens: reverseResolveEns,
    get_safe_info: getSafeInfo,
    get_pending_transactions: getPendingTransactions,
    propose_transaction: proposeTransaction,
    railgun_balance: getRailgunBalance,
    railgun_shield: railgunShieldTokens,
    railgun_transfer: railgunPrivateTransfer,
    railgun_unshield: railgunWithdraw,
  };
}

export function createTools(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
  runtimeConfig?: RuntimeConfig,
) {
  return getTools(networkConfig, runtimeConfig);
}

const defaultRuntimeConfig = createDefaultRuntimeConfig();

export const tools = getTools(defaultRuntimeConfig.network, defaultRuntimeConfig);

import { DEFAULT_NETWORK_CONFIG, type NetworkConfig } from "../ethereum";
import {
  getRailgunBalance,
  railgunPrivateTransfer,
  railgunShieldTokens,
  railgunWithdraw,
} from "./railgun";
import { createEoaTransferTools } from "./eoa-tx";
import { createReadChainTools } from "./read-chain";
import { getSafeInfo, getPendingTransactions, proposeTransaction } from "./safe";

export function getTools(networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG) {
  const { prepareEoaTransfer, sendEoaTransfer } =
    createEoaTransferTools(networkConfig);
  const {
    getBalance,
    getPortfolio,
    getTransaction,
    resolveEns,
    reverseResolveEns,
  } = createReadChainTools(networkConfig);

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
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG
) {
  return getTools(networkConfig);
}

export const tools = getTools();

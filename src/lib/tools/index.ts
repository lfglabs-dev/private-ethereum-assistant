import { createReadChainTools } from "./read-chain";
import { getSafeInfo, getPendingTransactions, proposeTransaction } from "./safe";

export function createTools() {
  const { getBalance, getTransaction, resolveEns, reverseResolveEns } =
    createReadChainTools();

  return {
    get_balance: getBalance,
    get_transaction: getTransaction,
    resolve_ens: resolveEns,
    reverse_resolve_ens: reverseResolveEns,
    get_safe_info: getSafeInfo,
    get_pending_transactions: getPendingTransactions,
    propose_transaction: proposeTransaction,
  };
}

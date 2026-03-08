import { getBalance, getTransaction, resolveEns } from "./read-chain";
import { getSafeInfo, getPendingTransactions, proposeTransaction } from "./safe";

export const tools = {
  get_balance: getBalance,
  get_transaction: getTransaction,
  resolve_ens: resolveEns,
  get_safe_info: getSafeInfo,
  get_pending_transactions: getPendingTransactions,
  propose_transaction: proposeTransaction,
};

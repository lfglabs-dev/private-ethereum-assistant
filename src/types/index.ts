export interface SafeTransactionProposal {
  status: "proposed" | "manual_creation_required" | "error";
  safeTxHash: string;
  safeAddress: string;
  to: string;
  value: string;
  data: string;
  type: string;
  currentConfirmations: number;
  requiredConfirmations: number;
  safeUILink: string;
  signers: string[];
}

export interface SafeInfo {
  address: string;
  owners: string[];
  threshold: number;
  nonce: number;
  balance: string;
}

export interface PendingTransaction {
  safeTxHash: string;
  safeAddress: string;
  to: string;
  value: string;
  data: string;
  transactionType: string;
  currentConfirmations: number;
  requiredConfirmations: number;
  status: string;
  safeUILink: string;
  submissionDate: string;
}

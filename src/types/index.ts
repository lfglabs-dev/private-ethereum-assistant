export interface SafeTransactionProposal {
  safeTxHash: string;
  to: string;
  value: string;
  data: string;
  safeUrl: string;
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
  to: string;
  value: string;
  data: string;
  confirmations: number;
  confirmationsRequired: number;
  submissionDate: string;
}

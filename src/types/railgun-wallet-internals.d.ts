declare module "@railgun-community/wallet/dist/services/transactions/proof-cache.js" {
  import type {
    NetworkName,
    ProofType,
    RailgunERC20Amount,
    RailgunERC20AmountRecipient,
    RailgunERC20Recipient,
    RailgunNFTAmount,
    RailgunNFTAmountRecipient,
    TransactionGasDetails,
    TXIDVersion,
  } from "@railgun-community/shared-models";
  import type { PreTransactionPOIsPerTxidLeafPerList } from "@railgun-community/engine";
  import type { ContractTransaction } from "ethers";

  export type ProvedTransaction = {
    proofType: ProofType;
    txidVersion: TXIDVersion;
    transaction: ContractTransaction;
    railgunWalletID: string;
    showSenderAddressToRecipient: boolean;
    memoText: Optional<string>;
    erc20AmountRecipients: RailgunERC20AmountRecipient[];
    nftAmountRecipients: RailgunNFTAmountRecipient[];
    relayAdaptUnshieldERC20Amounts: Optional<RailgunERC20Amount[]>;
    relayAdaptUnshieldNFTAmounts: Optional<RailgunNFTAmount[]>;
    relayAdaptShieldERC20Recipients: Optional<RailgunERC20Recipient[]>;
    relayAdaptShieldNFTRecipients: Optional<RailgunNFTAmount[]>;
    crossContractCalls: Optional<ContractTransaction[]>;
    broadcasterFeeERC20AmountRecipient: Optional<RailgunERC20AmountRecipient>;
    sendWithPublicWallet: boolean;
    overallBatchMinGasPrice: Optional<bigint>;
    preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList;
    nullifiers: string[];
  };

  export const setCachedProvedTransaction: (tx?: ProvedTransaction) => void;
  export const populateProvedTransaction: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    proofType: ProofType,
    railgunWalletID: string,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
    relayAdaptUnshieldERC20Amounts: Optional<RailgunERC20Amount[]>,
    relayAdaptUnshieldNFTAmounts: Optional<RailgunNFTAmount[]>,
    relayAdaptShieldERC20Recipients: Optional<RailgunERC20Recipient[]>,
    relayAdaptShieldNFTRecipients: Optional<RailgunNFTAmount[]>,
    crossContractCalls: Optional<ContractTransaction[]>,
    broadcasterFeeERC20AmountRecipient: Optional<RailgunERC20AmountRecipient>,
    sendWithPublicWallet: boolean,
    overallBatchMinGasPrice: Optional<bigint>,
    gasDetails: TransactionGasDetails,
  ) => Promise<{
    transaction: ContractTransaction;
    nullifiers: string[];
    preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList;
  }>;
}

declare module "@railgun-community/wallet/dist/services/transactions/tx-cross-contract-calls.js" {
  import type {
    NetworkName,
    RailgunERC20Amount,
    RailgunERC20AmountRecipient,
    TXIDVersion,
  } from "@railgun-community/shared-models";

  export const createRelayAdaptUnshieldERC20AmountRecipients: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    unshieldERC20Amounts: RailgunERC20Amount[],
  ) => RailgunERC20AmountRecipient[];
}

declare module "@railgun-community/wallet/dist/services/transactions/tx-generator.js" {
  import type {
    AdaptID,
    PreTransactionPOIsPerTxidLeafPerList,
    TransactionStructV2,
    TransactionStructV3,
  } from "@railgun-community/engine";
  import type {
    NetworkName,
    ProofType,
    RailgunERC20Amount,
    RailgunERC20AmountRecipient,
    RailgunNFTAmountRecipient,
    TXIDVersion,
  } from "@railgun-community/shared-models";
  import type { ContractTransaction } from "ethers";

  export const DUMMY_FROM_ADDRESS: string;
  export type GenerateTransactionsProgressCallback = (
    progress: number,
    status: string,
  ) => void;
  export const generateProofTransactions: (
    proofType: ProofType,
    networkName: NetworkName,
    railgunWalletID: string,
    txidVersion: TXIDVersion,
    encryptionKey: string,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
    broadcasterFeeERC20AmountRecipient: Optional<RailgunERC20AmountRecipient>,
    sendWithPublicWallet: boolean,
    relayAdaptID: Optional<AdaptID>,
    useDummyProof: boolean,
    overallBatchMinGasPrice: Optional<bigint>,
    progressCallback: GenerateTransactionsProgressCallback,
    originShieldTxidForSpendabilityOverride?: string,
  ) => Promise<{
    provedTransactions: (TransactionStructV2 | TransactionStructV3)[];
    preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList;
  }>;
  export const nullifiersForTransactions: (
    transactions: (TransactionStructV2 | TransactionStructV3)[],
  ) => string[];
  export const generateDummyProofTransactions: (
    proofType: ProofType,
    networkName: NetworkName,
    railgunWalletID: string,
    txidVersion: TXIDVersion,
    encryptionKey: string,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
    broadcasterFeeERC20Amount: Optional<RailgunERC20Amount>,
    sendWithPublicWallet: boolean,
    overallBatchMinGasPrice: Optional<bigint>,
    originShieldTxidForSpendabilityOverride?: string,
  ) => Promise<(TransactionStructV2 | TransactionStructV3)[]>;
  export const generateUnshieldBaseToken: (
    txidVersion: TXIDVersion,
    txs: (TransactionStructV2 | TransactionStructV3)[],
    networkName: NetworkName,
    toWalletAddress: string,
    relayAdaptParamsRandom: string,
    useDummyProof: boolean | undefined,
    sendWithPublicWallet: boolean,
  ) => Promise<ContractTransaction>;
}

declare module "@railgun-community/wallet/dist/services/transactions/tx-gas-details.js" {
  import type { NetworkName, TXIDVersion } from "@railgun-community/shared-models";
  import type { ContractTransaction } from "ethers";

  export const getGasEstimate: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    transaction: ContractTransaction,
    fromWalletAddress: string,
    sendWithPublicWallet: boolean,
    isCrossContractCall: boolean,
  ) => Promise<bigint>;
}

declare module "@railgun-community/wallet/dist/services/transactions/tx-unshield.js" {
  import type {
    NetworkName,
    RailgunERC20AmountRecipient,
    RailgunNFTAmountRecipient,
    TransactionGasDetails,
    TXIDVersion,
  } from "@railgun-community/shared-models";

  export const gasEstimateForUnprovenUnshieldToOrigin: (
    originalShieldTxid: string,
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    railgunWalletID: string,
    encryptionKey: string,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
  ) => Promise<{ gasEstimate: bigint }>;
  export const populateProvedUnshieldToOrigin: (
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    railgunWalletID: string,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
    gasDetails: TransactionGasDetails,
  ) => Promise<{
    transaction: {
      to?: string | null;
      data?: string | null;
      value?: bigint | number | string | null;
      gasLimit?: bigint | number | string | null;
      gasPrice?: bigint | number | string | null;
      maxFeePerGas?: bigint | number | string | null;
      maxPriorityFeePerGas?: bigint | number | string | null;
      nonce?: number | null;
    };
    nullifiers: string[];
    preTransactionPOIsPerTxidLeafPerList: unknown;
  }>;
}

declare module "@railgun-community/wallet/dist/services/transactions/tx-proof-unshield.js" {
  import type {
    NetworkName,
    RailgunERC20AmountRecipient,
    RailgunNFTAmountRecipient,
    TXIDVersion,
  } from "@railgun-community/shared-models";

  export const generateUnshieldToOriginProof: (
    originalShieldTxid: string,
    txidVersion: TXIDVersion,
    networkName: NetworkName,
    railgunWalletID: string,
    encryptionKey: string,
    erc20AmountRecipients: RailgunERC20AmountRecipient[],
    nftAmountRecipients: RailgunNFTAmountRecipient[],
    progressCallback: (progress: number, status: string) => void,
  ) => Promise<void>;
}

declare module "@railgun-community/wallet/dist/services/railgun/core/engine.js" {
  import type { TXIDVersion } from "@railgun-community/shared-models";

  export const getEngine: () => {
    scanUTXOHistory: (
      txidVersion: TXIDVersion,
      chain: unknown,
      walletIdFilter?: string[],
    ) => Promise<void>;
  };
}

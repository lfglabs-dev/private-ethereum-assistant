import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export function validateSeedPhrase(phrase: string): boolean {
  return validateMnemonic(phrase.trim(), wordlist);
}

export function seedPhraseToPrivateKey(phrase: string): Hex {
  const account = mnemonicToAccount(phrase.trim());
  const hdKey = account.getHdKey();
  if (!hdKey.privateKey) {
    throw new Error("Failed to derive private key from seed phrase.");
  }
  return `0x${Buffer.from(hdKey.privateKey).toString("hex")}` as Hex;
}

export function seedPhraseToAddress(phrase: string): Address {
  return mnemonicToAccount(phrase.trim()).address;
}

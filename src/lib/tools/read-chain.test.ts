import { describe, expect, test } from "bun:test";
import {
  formatTokenAmount,
  formatWithGrouping,
  normalizeAddressInput,
  resolveRequestedTokenAddresses,
} from "./read-chain";

describe("read-chain helpers", () => {
  test("formats grouped decimal balances", () => {
    expect(formatWithGrouping("1234567.890000")).toBe("1,234,567.89");
    expect(formatWithGrouping("0.000000")).toBe("0");
  });

  test("formats raw token amounts using token decimals", () => {
    expect(formatTokenAmount(BigInt("123456789"), 6)).toBe("123.456789");
    expect(formatTokenAmount(BigInt("1234500000000000000"), 18)).toBe("1.2345");
    expect(formatTokenAmount(BigInt("123456789"), null)).toBe("123,456,789");
  });

  test("normalizes valid addresses and rejects invalid ones", () => {
    expect(
      normalizeAddressInput(
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "token address"
      )
    ).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

    expect(() => normalizeAddressInput("0xinvalid", "wallet address")).toThrow(
      "Invalid wallet address"
    );
  });

  test("deduplicates requested token addresses and preserves invalid inputs for reporting", () => {
    expect(
      resolveRequestedTokenAddresses(
        "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        [
          "0x833589fCD6EDB6E08f4c7C32D4f71b54bDa02913",
          "0x4200000000000000000000000000000000000006",
          "0xinvalid",
        ]
      )
    ).toEqual([
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "0x4200000000000000000000000000000000000006",
      "0xinvalid",
    ]);
  });

});

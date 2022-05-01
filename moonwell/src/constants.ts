import { Address } from "@graphprotocol/graph-ts";
import { cTokenDecimals } from "../../src/constants";

//////////////////////////////
/////     Addresses      /////
//////////////////////////////

export let comptrollerAddr = Address.fromString(
  "0x0b7a0EAA884849c6Af7a129e899536dDDcA4905E"
);
export let MOVRAddr = Address.fromString(
  "0x0000000000000000000000000000000000000000"
);
export let MFAMAddr = Address.fromString(
  "0xbb8d88bcd9749636bc4d2be22aac4bb3b01a58f1"
);

// at this very moment, the average block time on moonriver is 24 seconds, therefore 3600 blocks per day
// however, we know this is fluctuating according to https://moonriver.moonscan.io/chart/blocks
// maybe we could find a better way to get this data rather than hardcoding it
export const BLOCKS_PER_DAY = 3600 as i32;

export class TokenData {
  address: Address;
  name: string;
  symbol: string;
  decimals: i32;
  constructor(address: Address, name: string, symbol: string, decimals: i32) {
    this.address = address;
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
  }
}

export const nativeToken = new TokenData(
  Address.fromString("0x0000000000000000000000000000000000000000"),
  "MOVR",
  "MOVR",
  18
);

export const nativeCToken = new TokenData(
  Address.fromString("0x6a1A771C7826596652daDC9145fEAaE62b1cd07f"),
  "Moonwell MOVR",
  "mMOVR",
  cTokenDecimals
);

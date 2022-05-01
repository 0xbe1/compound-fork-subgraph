import { Address } from "@graphprotocol/graph-ts";
import { cTokenDecimals } from "../../src/constants";

//////////////////////////////
/////     Addresses      /////
//////////////////////////////

export let comptrollerAddr = Address.fromString(
  "0x6De54724e128274520606f038591A00C5E94a1F6"
);

// TODO: about 2 seconds per block
export const BLOCKS_PER_DAY = (24 * 60 * 60) / 2;

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
  "Ether",
  "ETH",
  18
);

export const nativeCToken = new TokenData(
  Address.fromString("0x4E8fE8fd314cFC09BDb0942c5adCC37431abDCD0"),
  "Bastion Ether",
  "cETH",
  cTokenDecimals
);

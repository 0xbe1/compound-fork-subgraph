import { Address } from "@graphprotocol/graph-ts";

//////////////////////////////
/////     Addresses      /////
//////////////////////////////

export let comptrollerAddr = Address.fromString(
  "0x6De54724e128274520606f038591A00C5E94a1F6"
);

// TODO: about 2 seconds per block
export const BLOCKS_PER_DAY = (24 * 60 * 60) / 2;

export const nativeToken = {
  address: Address.fromString(
    "0x0000000000000000000000000000000000000000"
  ),
  name: "Ether",
  symbol: "ETH"
}

export const nativeCToken = {
  address: Address.fromString(
    "0x4E8fE8fd314cFC09BDb0942c5adCC37431abDCD0"
  ),
  name: "Bastion Ether",
  symbol: "cETH"
}
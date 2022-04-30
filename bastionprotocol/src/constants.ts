import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";

////////////////////////
///// Schema Enums /////
////////////////////////

// The enum values are derived from Coingecko slugs (converted to uppercase
// and replaced hyphens with underscores for Postgres enum compatibility)
export namespace Network {
  export const ARBITRUM = "ARBITRUM_ONE";
  export const AVALANCHE = "AVALANCHE";
  export const AURORA = "AURORA";
  export const BSC = "BINANCE_SMART_CHAIN";
  export const CELO = "CELO";
  export const CRONOS = "CRONOS";
  export const ETHEREUM = "ETHEREUM";
  export const FANTOM = "FANTOM";
  export const HARMONY = "HARMONY_SHARD_0";
  export const MOONBEAM = "MOONBEAM";
  export const MOONRIVER = "MOONRIVER";
  export const OPTIMISM = "OPTIMISTIC_ETHEREUM";
  export const POLYGON = "POLYGON_POS";
  export const XDAI = "XDAI";
}

export namespace ProtocolType {
  export const EXCHANGE = "EXCHANGE";
  export const LENDING = "LENDING";
  export const YIELD = "YIELD";
  export const BRIDGE = "BRIDGE";
  export const GENERIC = "GENERIC";
}

export namespace LendingType {
  export const CDP = "CDP";
  export const POOLED = "POOLED";
}

export namespace RiskType {
  export const GLOBAL = "GLOBAL";
  export const ISOLATED = "ISOLATED";
}

export namespace RewardTokenType {
  export const DEPOSIT = "DEPOSIT";
  export const BORROW = "BORROW";
}

export namespace InterestRateType {
  export const STABLE = "STABLE";
  export const VARIABLE = "VARIABLE";
  export const FIXED_TERM = "FIXED_TERM";
}

export namespace InterestRateSide {
  export const LENDER = "LENDER";
  export const BORROWER = "BORROWER";
}

//////////////////////////////
/////     Addresses      /////
//////////////////////////////

export let comptrollerAddr = Address.fromString(
  "0x6De54724e128274520606f038591A00C5E94a1F6"
);
export let cETHAddr = Address.fromString(
  "0x4E8fE8fd314cFC09BDb0942c5adCC37431abDCD0"
);
export let ETHAddr = Address.fromString(
  "0x0000000000000000000000000000000000000000"
);
// export let MFAMAddr = Address.fromString(
//   "0xbb8d88bcd9749636bc4d2be22aac4bb3b01a58f1"
// );

////////////////////////
///// Type Helpers /////
////////////////////////

export const BIGINT_ZERO = BigInt.fromI32(0);
export const BIGINT_ONE = BigInt.fromI32(1);

export const BIGDECIMAL_ZERO = new BigDecimal(BIGINT_ZERO);
export const BIGDECIMAL_ONE = new BigDecimal(BIGINT_ONE);
export const BIGDECIMAL_HUNDRED = new BigDecimal(BigInt.fromI32(100));

/////////////////////
///// Date/Time /////
/////////////////////

export const SECONDS_PER_YEAR = 60 * 60 * 24 * 365;
export const SECONDS_PER_DAY = 60 * 60 * 24; // 86400
export const SECONDS_PER_HOUR = 60 * 60; // 3600

/////////////////////////////
/////        Math       /////
/////////////////////////////

export const mantissaFactor = 18;
export const cTokenDecimals = 8;
export const mantissaFactorBD = exponentToBigDecimal(mantissaFactor);
export const cTokenDecimalsBD = exponentToBigDecimal(cTokenDecimals);

// n => 10^n
export function exponentToBigDecimal(decimals: i32): BigDecimal {
  let result = BIGINT_ONE;
  let ten = BigInt.fromI32(10);
  for (let i = 0; i < decimals; i++) {
    result = result.times(ten);
  }
  return result.toBigDecimal();
}

// TODO: about 2 seconds per block
export const BLOCKS_PER_DAY = (24 * 60 * 60) / 2;

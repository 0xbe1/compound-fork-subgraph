import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import { NewReserveFactor } from "../generated/Comptroller/CToken";
import {
  Account,
  Borrow,
  ActiveAccount,
  Deposit,
  FinancialsDailySnapshot,
  LendingProtocol,
  Liquidate,
  Market,
  MarketDailySnapshot,
  Repay,
  Token,
  UsageMetricsDailySnapshot,
  Withdraw,
  InterestRate,
  MarketHourlySnapshot,
  UsageMetricsHourlySnapshot,
} from "../generated/schema";
import {
  BIGDECIMAL_HUNDRED,
  LendingType,
  mantissaFactorBD,
  Network,
  ProtocolType,
  RiskType,
} from "./constants";

export class ProtocolData {
  comptrollerAddr: Address;
  name: string;
  slug: string;
  schemaVersion: string;
  subgraphVersion: string;
  methodologyVersion: string;
  network: string;
  constructor(
    comptrollerAddr: Address,
    name: string,
    slug: string,
    schemaVersion: string,
    subgraphVersion: string,
    methodologyVersion: string,
    network: string
  ) {
    this.comptrollerAddr = comptrollerAddr;
    this.name = name;
    this.slug = slug;
    this.schemaVersion = schemaVersion;
    this.subgraphVersion = subgraphVersion;
    this.methodologyVersion = methodologyVersion;
    this.network = network;
  }
}

export function templateGetOrCreateProtocol(
  protocolData: ProtocolData,
  liquidationIncentiveMantissaResult: ethereum.CallResult<BigInt>
): LendingProtocol {
  let protocol = LendingProtocol.load(
    protocolData.comptrollerAddr.toHexString()
  );
  if (!protocol) {
    protocol = new LendingProtocol(protocolData.comptrollerAddr.toHexString());
    protocol.name = protocolData.name;
    protocol.slug = protocolData.slug;
    protocol.schemaVersion = protocolData.schemaVersion;
    protocol.subgraphVersion = protocolData.subgraphVersion;
    protocol.methodologyVersion = protocolData.methodologyVersion;
    protocol.network = protocolData.network;
    protocol.type = ProtocolType.LENDING;
    protocol.lendingType = LendingType.POOLED;
    protocol.riskType = RiskType.GLOBAL;

    if (liquidationIncentiveMantissaResult.reverted) {
      log.warning(
        "[getOrCreateProtocol] liquidationIncentiveMantissaResult reverted",
        []
      );
    } else {
      protocol._liquidationIncentive = liquidationIncentiveMantissaResult.value
        .toBigDecimal()
        .div(mantissaFactorBD)
        .times(BIGDECIMAL_HUNDRED);
    }
    protocol.save();
  }
  return protocol;
}

//
//
// event.params
// - oldReserveFactorMantissa
// - newReserveFactorMantissa
export function templateHandleNewReserveFactor(event: NewReserveFactor): void {
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (market == null) {
    log.warning("[handleNewReserveFactor] Market not found: {}", [marketID]);
    return;
  }
  let reserveFactor = event.params.newReserveFactorMantissa
    .toBigDecimal()
    .div(mantissaFactorBD);
  market._reserveFactor = reserveFactor;
  market.save();
}

import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import {
  MarketListed,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewPriceOracle,
} from "../generated/Comptroller/Comptroller";
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
  cTokenDecimals,
  InterestRateSide,
  InterestRateType,
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

//
//
// event.params.cToken:
// event.params.oldCollateralFactorMantissa:
// event.params.newCollateralFactorMantissa:
export function templateHandleNewCollateralFactor(
  event: NewCollateralFactor
): void {
  let marketID = event.params.cToken.toHexString();
  let market = Market.load(marketID);
  if (market == null) {
    log.warning("[handleNewCollateralFactor] Market not found: {}", [marketID]);
    return;
  }
  let collateralFactor = event.params.newCollateralFactorMantissa
    .toBigDecimal()
    .div(mantissaFactorBD)
    .times(BIGDECIMAL_HUNDRED);
  market.maximumLTV = collateralFactor;
  market.liquidationThreshold = collateralFactor;
  market.save();
}

//
//
// event.params.oldLiquidationIncentiveMantissa
// event.params.newLiquidationIncentiveMantissa
export function templateHandleNewLiquidationIncentive(
  protocol: LendingProtocol,
  event: NewLiquidationIncentive
): void {
  let liquidationIncentive = event.params.newLiquidationIncentiveMantissa
    .toBigDecimal()
    .div(mantissaFactorBD)
    .times(BIGDECIMAL_HUNDRED);
  protocol._liquidationIncentive = liquidationIncentive;
  protocol.save();

  for (let i = 0; i < protocol._marketIDs.length; i++) {
    let market = Market.load(protocol.markets[i]);
    if (!market) {
      log.warning("[handleNewLiquidationIncentive] Market not found: {}", [
        protocol.markets[i],
      ]);
      // best effort
      continue;
    }
    market.liquidationPenalty = liquidationIncentive;
    market.save();
  }
}

//
//
// event.params
// - oldPriceOracle
// - newPriceOracle
export function templateHandleNewPriceOracle(
  protocol: LendingProtocol,
  event: NewPriceOracle
): void {
  protocol._priceOracle = event.params.newPriceOracle.toHexString();
  protocol.save();
}

export class MarketListedData {
  protocol: LendingProtocol;
  token: TokenData;
  cToken: TokenData;
  cTokenReserveFactorMantissa: BigInt;
  constructor(
    protocol: LendingProtocol,
    token: TokenData,
    cToken: TokenData,
    cTokenReserveFactorMantissa: BigInt
  ) {
    this.protocol = protocol;
    this.token = token;
    this.cToken = cToken;
    this.cTokenReserveFactorMantissa = cTokenReserveFactorMantissa;
  }
}

//
//
// event.params.cToken: The address of the market (token) to list
export function templateHandleMarketListed(
  marketListedData: MarketListedData,
  event: MarketListed
): void {
  let cTokenAddr = event.params.cToken;
  let cToken = Token.load(cTokenAddr.toHexString());
  if (cToken != null) {
    return;
  }
  // this is a new cToken, a new underlying token, and a new market

  //
  // create cToken
  //
  cToken = new Token(cTokenAddr.toHexString());
  cToken.name = marketListedData.cToken.name;
  cToken.symbol = marketListedData.cToken.symbol;
  cToken.decimals = marketListedData.cToken.decimals;
  cToken.save();

  //
  // create underlying token
  //
  let underlyingToken = new Token(marketListedData.token.address.toHexString());
  underlyingToken.name = marketListedData.token.name;
  underlyingToken.symbol = marketListedData.token.symbol;
  underlyingToken.decimals = marketListedData.token.decimals;
  underlyingToken.save();

  //
  // create market
  //
  let market = new Market(cTokenAddr.toHexString());
  market.name = cToken.name;
  market.protocol = marketListedData.protocol.id;
  market.inputToken = underlyingToken.id;
  market.outputToken = cToken.id;

  // assumptions: reward 0 is MFAM, reward 1 is MOVR
  // let MFAMToken = Token.load(MFAMAddr.toHexString());
  // if (!MFAMToken) {
  //   MFAMToken = new Token(MFAMAddr.toHexString());
  //   MFAMToken.name = "MFAM";
  //   MFAMToken.symbol = "MFAM";
  //   MFAMToken.decimals = 18;
  //   MFAMToken.save();
  // }
  // let MOVRToken = Token.load(ETHAddr.toHexString());
  // if (!MOVRToken) {
  //   MOVRToken = new Token(ETHAddr.toHexString());
  //   MOVRToken.name = "MOVR";
  //   MOVRToken.symbol = "MOVR";
  //   MOVRToken.decimals = 18;
  //   MOVRToken.save();
  // }

  // let borrowRewardToken0 = RewardToken.load(
  //   InterestRateSide.BORROWER.concat("-").concat(MFAMAddr.toHexString())
  // );
  // if (!borrowRewardToken0) {
  //   borrowRewardToken0 = new RewardToken(
  //     InterestRateSide.BORROWER.concat("-").concat(MFAMAddr.toHexString())
  //   );
  //   borrowRewardToken0.token = MFAMToken.id;
  //   borrowRewardToken0.type = RewardTokenType.BORROW;
  //   borrowRewardToken0.save();
  // }

  // let borrowRewardToken1 = RewardToken.load(
  //   InterestRateSide.BORROWER.concat("-").concat(ETHAddr.toHexString())
  // );
  // if (!borrowRewardToken1) {
  //   borrowRewardToken1 = new RewardToken(
  //     InterestRateSide.BORROWER.concat("-").concat(ETHAddr.toHexString())
  //   );
  //   borrowRewardToken1.token = MOVRToken.id;
  //   borrowRewardToken1.type = RewardTokenType.BORROW;
  //   borrowRewardToken1.save();
  // }

  // let supplyRewardToken0 = RewardToken.load(
  //   InterestRateSide.LENDER.concat("-").concat(MFAMAddr.toHexString())
  // );
  // if (!supplyRewardToken0) {
  //   supplyRewardToken0 = new RewardToken(
  //     InterestRateSide.LENDER.concat("-").concat(MFAMAddr.toHexString())
  //   );
  //   supplyRewardToken0.token = MFAMToken.id;
  //   supplyRewardToken0.type = RewardTokenType.DEPOSIT;
  //   supplyRewardToken0.save();
  // }

  // let supplyRewardToken1 = RewardToken.load(
  //   InterestRateSide.LENDER.concat("-").concat(ETHAddr.toHexString())
  // );
  // if (!supplyRewardToken1) {
  //   supplyRewardToken1 = new RewardToken(
  //     InterestRateSide.LENDER.concat("-").concat(ETHAddr.toHexString())
  //   );
  //   supplyRewardToken1.token = MOVRToken.id;
  //   supplyRewardToken1.type = RewardTokenType.DEPOSIT;
  //   supplyRewardToken1.save();
  // }

  // market.rewardTokens = [
  //   borrowRewardToken0.id,
  //   borrowRewardToken1.id,
  //   supplyRewardToken0.id,
  //   supplyRewardToken1.id,
  // ];
  // market.rewardTokenEmissionsAmount = [
  //   BIGINT_ZERO,
  //   BIGINT_ZERO,
  //   BIGINT_ZERO,
  //   BIGINT_ZERO,
  // ];
  // market.rewardTokenEmissionsUSD = [
  //   BIGDECIMAL_ZERO,
  //   BIGDECIMAL_ZERO,
  //   BIGDECIMAL_ZERO,
  //   BIGDECIMAL_ZERO,
  // ];

  let supplyInterestRate = new InterestRate(
    InterestRateSide.LENDER.concat("-")
      .concat(InterestRateType.VARIABLE)
      .concat("-")
      .concat(market.id)
  );
  supplyInterestRate.side = InterestRateSide.LENDER;
  supplyInterestRate.type = InterestRateType.VARIABLE;
  supplyInterestRate.save();
  let borrowInterestRate = new InterestRate(
    InterestRateSide.BORROWER.concat("-")
      .concat(InterestRateType.VARIABLE)
      .concat("-")
      .concat(market.id)
  );
  borrowInterestRate.side = InterestRateSide.BORROWER;
  borrowInterestRate.type = InterestRateType.VARIABLE;
  borrowInterestRate.save();
  market.rates = [supplyInterestRate.id, borrowInterestRate.id];

  market.isActive = true;
  market.canUseAsCollateral = true;
  market.canBorrowFrom = true;
  market.liquidationPenalty = marketListedData.protocol._liquidationIncentive;
  market._reserveFactor = marketListedData.cTokenReserveFactorMantissa
    .toBigDecimal()
    .div(mantissaFactorBD);

  market.createdTimestamp = event.block.timestamp;
  market.createdBlockNumber = event.block.number;
  market.save();

  //
  // update protocol
  //
  let marketIDs = marketListedData.protocol._marketIDs;
  marketIDs.push(market.id);
  marketListedData.protocol._marketIDs = marketIDs;
  marketListedData.protocol.save();
}

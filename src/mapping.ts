import { Address, BigDecimal, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
import {
  MarketListed,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewPriceOracle,
} from "../generated/Comptroller/Comptroller";
import { NewReserveFactor } from "../generated/Comptroller/CToken";
import { Mint, Redeem } from "../generated/templates/CToken/CToken"
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
  BIGDECIMAL_ZERO,
  cTokenDecimals,
  exponentToBigDecimal,
  InterestRateSide,
  InterestRateType,
  LendingType,
  mantissaFactorBD,
  Network,
  ProtocolType,
  RiskType,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
} from "./constants";

enum EventType {
  Deposit,
  Withdraw,
  Borrow,
  Repay,
  Liquidate,
}

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

//
//
// event.params
// - minter
// - mintAmount: The amount of underlying assets to mint
// - mintTokens: The amount of cTokens minted
export function templateHandleMint(comptrollerAddr: Address, event: Mint): void {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString())
  if (!protocol) {
    log.warning("[handleMint] protocol not found: {}", [comptrollerAddr.toHexString()])
    return;
  }
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[handleMint] Market not found: {}", [marketID]);
    return;
  }
  let underlyingToken = Token.load(market.inputToken);
  if (!underlyingToken) {
    log.warning("[handleMint] Failed to load underlying token: {}", [
      market.inputToken,
    ]);
    return;
  }

  let depositID = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.transactionLogIndex.toString());
  let deposit = new Deposit(depositID);
  deposit.hash = event.transaction.hash.toHexString();
  deposit.logIndex = event.transactionLogIndex.toI32();
  deposit.protocol = protocol.id;
  deposit.to = marketID;
  deposit.from = event.params.minter.toHexString();
  deposit.blockNumber = event.block.number;
  deposit.timestamp = event.block.timestamp;
  deposit.market = marketID;
  deposit.asset = market.inputToken;
  deposit.amount = event.params.mintAmount;
  let depositUSD = market.inputTokenPriceUSD.times(
    event.params.mintAmount
      .toBigDecimal()
      .div(exponentToBigDecimal(underlyingToken.decimals))
  );
  deposit.amountUSD = depositUSD;
  deposit.save();

  market.inputTokenBalance = market.inputTokenBalance.plus(
    event.params.mintAmount
  );
  market.cumulativeDepositUSD = market.cumulativeDepositUSD.plus(depositUSD);
  market.save();

  updateMarketSnapshots(
    marketID,
    event.block.timestamp.toI32(),
    depositUSD,
    EventType.Deposit
  );

  snapshotUsage(
    comptrollerAddr,
    event.block.number,
    event.block.timestamp,
    event.params.minter.toHexString(),
    EventType.Deposit
  );
}

//
//
// event.params
// - redeemer
// - redeemAmount
// - redeecTokens
export function templateHandleRedeem(comptrollerAddr: Address, event: Redeem): void {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString())
  if (!protocol) {
    log.warning("[handleMint] protocol not found: {}", [comptrollerAddr.toHexString()])
    return;
  }
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[handleRedeem] Market not found: {}", [marketID]);
    return;
  }
  let underlyingToken = Token.load(market.inputToken);
  if (!underlyingToken) {
    log.warning("[handleRedeem] Failed to load underlying token: {}", [
      market.inputToken,
    ]);
    return;
  }

  let withdrawID = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.transactionLogIndex.toString());
  let withdraw = new Withdraw(withdrawID);
  withdraw.hash = event.transaction.hash.toHexString();
  withdraw.logIndex = event.transactionLogIndex.toI32();
  withdraw.protocol = protocol.id;
  withdraw.to = event.params.redeemer.toHexString();
  withdraw.from = marketID;
  withdraw.blockNumber = event.block.number;
  withdraw.timestamp = event.block.timestamp;
  withdraw.market = marketID;
  withdraw.asset = market.inputToken;
  withdraw.amount = event.params.redeemAmount;
  withdraw.amountUSD = market.inputTokenPriceUSD.times(
    event.params.redeemAmount
      .toBigDecimal()
      .div(exponentToBigDecimal(underlyingToken.decimals))
  );
  withdraw.save();

  market.inputTokenBalance = market.inputTokenBalance.minus(
    event.params.redeemAmount
  );
  market.save();

  snapshotUsage(
    comptrollerAddr,
    event.block.number,
    event.block.timestamp,
    event.params.redeemer.toHexString(),
    EventType.Withdraw
  );
}

function snapshotMarket(
  marketID: string,
  blockNumber: BigInt,
  blockTimestamp: BigInt
): void {
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[snapshotMarket] Market not found: {}", [marketID]);
    return;
  }

  //
  // daily snapshot
  //
  let dailySnapshot = new MarketDailySnapshot(
    getMarketDailySnapshotID(marketID, blockTimestamp.toI32())
  );
  dailySnapshot.protocol = market.protocol;
  dailySnapshot.market = marketID;
  dailySnapshot.totalValueLockedUSD = market.totalValueLockedUSD;
  dailySnapshot.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  dailySnapshot.cumulativeDepositUSD = market.cumulativeDepositUSD;
  dailySnapshot.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  dailySnapshot.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  dailySnapshot.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  dailySnapshot.inputTokenBalance = market.inputTokenBalance;
  dailySnapshot.inputTokenPriceUSD = market.inputTokenPriceUSD;
  dailySnapshot.outputTokenSupply = market.outputTokenSupply;
  dailySnapshot.outputTokenPriceUSD = market.outputTokenPriceUSD;
  dailySnapshot.exchangeRate = market.exchangeRate;
  dailySnapshot.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  dailySnapshot.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  dailySnapshot.rates = market.rates;
  dailySnapshot.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  dailySnapshot.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  dailySnapshot.blockNumber = blockNumber;
  dailySnapshot.timestamp = blockTimestamp;
  dailySnapshot.save();

  //
  // hourly snapshot
  //
  let hourlySnapshot = new MarketHourlySnapshot(
    getMarketHourlySnapshotID(marketID, blockTimestamp.toI32())
  );
  hourlySnapshot.protocol = market.protocol;
  hourlySnapshot.market = marketID;
  hourlySnapshot.totalValueLockedUSD = market.totalValueLockedUSD;
  hourlySnapshot.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  hourlySnapshot.cumulativeDepositUSD = market.cumulativeDepositUSD;
  hourlySnapshot.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  hourlySnapshot.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  hourlySnapshot.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  hourlySnapshot.inputTokenBalance = market.inputTokenBalance;
  hourlySnapshot.inputTokenPriceUSD = market.inputTokenPriceUSD;
  hourlySnapshot.outputTokenSupply = market.outputTokenSupply;
  hourlySnapshot.outputTokenPriceUSD = market.outputTokenPriceUSD;
  hourlySnapshot.exchangeRate = market.exchangeRate;
  hourlySnapshot.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  hourlySnapshot.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  hourlySnapshot.rates = market.rates;
  hourlySnapshot.rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount;
  hourlySnapshot.rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD;
  hourlySnapshot.blockNumber = blockNumber;
  hourlySnapshot.timestamp = blockTimestamp;
  hourlySnapshot.save();
}

/**
 *
 * @param blockNumber
 * @param blockTimestamp
 * @returns
 */
function snapshotFinancials(comptrollerAddr: Address, blockNumber: BigInt, blockTimestamp: BigInt): void {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString());
  if (!protocol) {
    log.error(
      "[snapshotFinancials] Protocol not found, this SHOULD NOT happen",
      []
    );
    return;
  }
  let snapshotID = (blockTimestamp.toI32() / SECONDS_PER_DAY).toString();
  let snapshot = new FinancialsDailySnapshot(snapshotID);

  snapshot.protocol = protocol.id;
  snapshot.totalValueLockedUSD = protocol.totalValueLockedUSD;
  snapshot.totalDepositBalanceUSD = protocol.totalDepositBalanceUSD;
  snapshot.totalBorrowBalanceUSD = protocol.totalBorrowBalanceUSD;
  snapshot.cumulativeDepositUSD = protocol.cumulativeDepositUSD;
  snapshot.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD;
  snapshot.cumulativeLiquidateUSD = protocol.cumulativeLiquidateUSD;
  snapshot.cumulativeTotalRevenueUSD = protocol.cumulativeTotalRevenueUSD;
  snapshot.cumulativeProtocolSideRevenueUSD =
    protocol.cumulativeProtocolSideRevenueUSD;
  snapshot.cumulativeSupplySideRevenueUSD =
    protocol.cumulativeSupplySideRevenueUSD;

  let dailyDepositUSD = BIGDECIMAL_ZERO;
  let dailyBorrowUSD = BIGDECIMAL_ZERO;
  let dailyLiquidateUSD = BIGDECIMAL_ZERO;
  let dailyTotalRevenueUSD = BIGDECIMAL_ZERO;
  let dailyProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
  let dailySupplySideRevenueUSD = BIGDECIMAL_ZERO;

  for (let i = 0; i < protocol._marketIDs.length; i++) {
    let market = Market.load(protocol._marketIDs[i]);
    if (!market) {
      log.warning("[snapshotFinancials] Market not found: {}", [
        protocol._marketIDs[i],
      ]);
      // best effort
      continue;
    }

    let marketDailySnapshot = MarketDailySnapshot.load(
      getMarketDailySnapshotID(market.id, blockTimestamp.toI32())
    );

    if (marketDailySnapshot) {
      dailyDepositUSD = dailyDepositUSD.plus(
        marketDailySnapshot.dailyDepositUSD
      );
      dailyBorrowUSD = dailyBorrowUSD.plus(marketDailySnapshot.dailyBorrowUSD);
      dailyLiquidateUSD = dailyLiquidateUSD.plus(
        marketDailySnapshot.dailyLiquidateUSD
      );
      dailyTotalRevenueUSD = dailyTotalRevenueUSD.plus(
        marketDailySnapshot._dailyTotalRevenueUSD
      );
      dailyProtocolSideRevenueUSD = dailyProtocolSideRevenueUSD.plus(
        marketDailySnapshot._dailyProtocolSideRevenueUSD
      );
      dailySupplySideRevenueUSD = dailySupplySideRevenueUSD.plus(
        marketDailySnapshot._dailySupplySideRevenueUSD
      );
    }
  }

  snapshot.dailyDepositUSD = dailyDepositUSD;
  snapshot.dailyBorrowUSD = dailyBorrowUSD;
  snapshot.dailyLiquidateUSD = dailyLiquidateUSD;
  snapshot.dailyTotalRevenueUSD = dailyTotalRevenueUSD;
  snapshot.dailyProtocolSideRevenueUSD = dailyProtocolSideRevenueUSD;
  snapshot.dailySupplySideRevenueUSD = dailySupplySideRevenueUSD;
  snapshot.blockNumber = blockNumber;
  snapshot.timestamp = blockTimestamp;
  snapshot.save();
}

/**
 * Snapshot usage.
 * It has to happen in handleMint, handleRedeem, handleBorrow, handleRepayBorrow and handleLiquidate,
 * because handleAccrueInterest doesn't have access to the accountID
 * @param blockNumber
 * @param blockTimestamp
 * @param accountID
 */
function snapshotUsage(
  comptrollerAddr: Address,
  blockNumber: BigInt,
  blockTimestamp: BigInt,
  accountID: string,
  eventType: EventType
): void {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString());
  if (!protocol) {
    log.error("[snapshotUsage] Protocol not found, this SHOULD NOT happen", []);
    return;
  }
  let account = Account.load(accountID);
  if (!account) {
    account = new Account(accountID);
    account.save();

    protocol.cumulativeUniqueUsers += 1;
    protocol.save();
  }

  let daysSinceEpoch = (blockTimestamp.toI32() / SECONDS_PER_DAY).toString();
  let hoursOfDay = (
    (blockTimestamp.toI32() / SECONDS_PER_HOUR) %
    24
  ).toString();

  //
  // daily snapshot
  //
  let dailySnapshotID = daysSinceEpoch;
  let dailySnapshot = UsageMetricsDailySnapshot.load(dailySnapshotID);
  if (!dailySnapshot) {
    dailySnapshot = new UsageMetricsDailySnapshot(dailySnapshotID);
    dailySnapshot.protocol = protocol.id;
  }
  let dailyAccountID = accountID.concat("-").concat(dailySnapshotID);
  let dailyActiveAccount = ActiveAccount.load(dailyAccountID);
  if (!dailyActiveAccount) {
    dailyActiveAccount = new ActiveAccount(dailyAccountID);
    dailyActiveAccount.save();

    dailySnapshot.dailyActiveUsers += 1;
  }
  dailySnapshot.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
  dailySnapshot.dailyTransactionCount += 1;
  switch (eventType) {
    case EventType.Deposit:
      dailySnapshot.dailyDepositCount += 1;
      break;
    case EventType.Withdraw:
      dailySnapshot.dailyWithdrawCount += 1;
      break;
    case EventType.Borrow:
      dailySnapshot.dailyBorrowCount += 1;
      break;
    case EventType.Repay:
      dailySnapshot.dailyRepayCount += 1;
      break;
    case EventType.Liquidate:
      dailySnapshot.dailyLiquidateCount += 1;
      break;
    default:
      break;
  }
  dailySnapshot.blockNumber = blockNumber;
  dailySnapshot.timestamp = blockTimestamp;
  dailySnapshot.save();

  //
  // hourly snapshot
  //
  let hourlySnapshotID = daysSinceEpoch.concat("-").concat(hoursOfDay);
  let hourlySnapshot = UsageMetricsHourlySnapshot.load(hourlySnapshotID);
  if (!hourlySnapshot) {
    hourlySnapshot = new UsageMetricsHourlySnapshot(hourlySnapshotID);
    hourlySnapshot.protocol = protocol.id;
  }
  let hourlyAccoutID = accountID.concat("-").concat(hourlySnapshotID);
  let hourlyActiveAccount = ActiveAccount.load(hourlyAccoutID);
  if (!hourlyActiveAccount) {
    hourlyActiveAccount = new ActiveAccount(hourlyAccoutID);
    hourlyActiveAccount.save();

    hourlySnapshot.hourlyActiveUsers += 1;
  }
  hourlySnapshot.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
  hourlySnapshot.hourlyTransactionCount += 1;
  switch (eventType) {
    case EventType.Deposit:
      hourlySnapshot.hourlyDepositCount += 1;
      break;
    case EventType.Withdraw:
      hourlySnapshot.hourlyWithdrawCount += 1;
      break;
    case EventType.Borrow:
      hourlySnapshot.hourlyBorrowCount += 1;
      break;
    case EventType.Repay:
      hourlySnapshot.hourlyRepayCount += 1;
      break;
    case EventType.Liquidate:
      hourlySnapshot.hourlyLiquidateCount += 1;
      break;
    default:
      break;
  }
  hourlySnapshot.blockNumber = blockNumber;
  hourlySnapshot.timestamp = blockTimestamp;
  hourlySnapshot.save();
}

function updateMarketSnapshots(
  marketID: string,
  timestamp: i32,
  amountUSD: BigDecimal,
  eventType: EventType
): void {
  let marketHourlySnapshot = MarketHourlySnapshot.load(
    getMarketHourlySnapshotID(marketID, timestamp)
  );
  if (marketHourlySnapshot) {
    switch (eventType) {
      case EventType.Deposit:
        marketHourlySnapshot.hourlyDepositUSD =
          marketHourlySnapshot.hourlyDepositUSD.plus(amountUSD);
        break;
      case EventType.Borrow:
        marketHourlySnapshot.hourlyBorrowUSD =
          marketHourlySnapshot.hourlyBorrowUSD.plus(amountUSD);
        break;
      case EventType.Liquidate:
        marketHourlySnapshot.hourlyLiquidateUSD =
          marketHourlySnapshot.hourlyLiquidateUSD.plus(amountUSD);
        break;
      default:
        break;
    }
    marketHourlySnapshot.save();
  }
  let marketDailySnapshot = MarketDailySnapshot.load(
    getMarketDailySnapshotID(marketID, timestamp)
  );
  if (marketDailySnapshot) {
    switch (eventType) {
      case EventType.Deposit:
        marketDailySnapshot.dailyDepositUSD =
          marketDailySnapshot.dailyDepositUSD.plus(amountUSD);
        break;
      case EventType.Borrow:
        marketDailySnapshot.dailyBorrowUSD =
          marketDailySnapshot.dailyBorrowUSD.plus(amountUSD);
        break;
      case EventType.Liquidate:
        marketDailySnapshot.dailyLiquidateUSD =
          marketDailySnapshot.dailyLiquidateUSD.plus(amountUSD);
        break;
      default:
        break;
    }
    marketDailySnapshot.save();
  }
}

function getMarketHourlySnapshotID(marketID: string, timestamp: i32): string {
  return marketID
    .concat("-")
    .concat((timestamp / SECONDS_PER_DAY).toString())
    .concat("-")
    .concat(((timestamp / SECONDS_PER_HOUR) % 24).toString());
}

function getMarketDailySnapshotID(marketID: string, timestamp: i32): string {
  return marketID.concat("-").concat((timestamp / SECONDS_PER_DAY).toString());
}
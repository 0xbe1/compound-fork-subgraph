import {
  Address,
  BigInt,
  BigDecimal,
  log,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  Comptroller,
  // MarketListed,
  // NewCollateralFactor,
  // NewLiquidationIncentive,
  // NewPriceOracle,
} from "../generated/Comptroller/Comptroller";
import {
  AccrueInterest,
  CToken,
  // LiquidateBorrow,
  // NewReserveFactor,
} from "../generated/Comptroller/CToken";
import { NewReserveFactor } from "../../generated/Comptroller/CToken";
import {
  NewPriceOracle,
  MarketListed,
  NewCollateralFactor,
  NewLiquidationIncentive,
} from "../../generated/Comptroller/Comptroller";
import { CToken as CTokenTemplate } from "../generated/templates";
import { ERC20 } from "../generated/Comptroller/ERC20";
import // Mint,
// Redeem,
// Borrow as BorrowEvent,
// RepayBorrow,
"../generated/templates/CToken/CToken";
import {
  Mint,
  Redeem,
  Borrow as BorrowEvent,
  RepayBorrow,
  LiquidateBorrow,
} from "../../generated/templates/CToken/CToken";
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
  RewardToken,
} from "../../generated/schema";
import {
  BIGDECIMAL_ZERO,
  cTokenDecimals,
  cTokenDecimalsBD,
  exponentToBigDecimal,
  LendingType,
  mantissaFactor,
  mantissaFactorBD,
  Network,
  ProtocolType,
  RiskType,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  BIGDECIMAL_HUNDRED,
  BIGINT_ZERO,
  // RewardTokenType,
  InterestRateSide,
  InterestRateType,
  SECONDS_PER_YEAR,
} from "../../src/constants";
import {
  comptrollerAddr,
  MOVRAddr,
  // MFAMAddr,
  BLOCKS_PER_DAY,
  nativeCToken,
  nativeToken,
} from "./constants";
import { PriceOracle } from "../generated/templates/CToken/PriceOracle";
import {
  ProtocolData,
  templateGetOrCreateProtocol,
  templateHandleNewReserveFactor,
  templateHandleNewCollateralFactor,
  templateHandleNewPriceOracle,
  templateHandleMarketListed,
  MarketListedData,
  TokenData,
  templateHandleNewLiquidationIncentive,
  templateHandleMint,
  templateHandleRedeem,
  templateHandleBorrow,
  templateHandleRepayBorrow,
  templateHandleLiquidateBorrow,
} from "../../src/mapping";

enum EventType {
  Deposit,
  Withdraw,
  Borrow,
  Repay,
  Liquidate,
}

//
//
// event.params
// - oldPriceOracle
// - newPriceOracle
export function handleNewPriceOracle(event: NewPriceOracle): void {
  let protocol = getOrCreateProtocol();
  templateHandleNewPriceOracle(protocol, event);
}

//
//
// event.params.cToken: The address of the market (token) to list
export function handleMarketListed(event: MarketListed): void {
  CTokenTemplate.create(event.params.cToken);

  let cTokenAddr = event.params.cToken;
  let cToken = Token.load(cTokenAddr.toHexString());
  if (cToken != null) {
    return;
  }
  // this is a new cToken, a new underlying token, and a new market

  let protocol = getOrCreateProtocol();
  let cTokenContract = CToken.bind(event.params.cToken);
  let cTokenReserveFactorMantissa = getOrElse<BigInt>(
    cTokenContract.try_reserveFactorMantissa(),
    BIGINT_ZERO
  );
  if (cTokenAddr == nativeCToken.address) {
    let marketListedData = new MarketListedData(
      protocol,
      nativeToken,
      nativeCToken,
      cTokenReserveFactorMantissa
    );
    templateHandleMarketListed(marketListedData, event);
    return;
  }

  let underlyingTokenAddrResult = cTokenContract.try_underlying();
  if (underlyingTokenAddrResult.reverted) {
    log.warning(
      "[handleMarketListed] could not fetch underlying token of cToken: {}",
      [cTokenAddr.toHexString()]
    );
    return;
  }
  let underlyingTokenAddr = underlyingTokenAddrResult.value;
  let underlyingTokenContract = ERC20.bind(underlyingTokenAddr);
  templateHandleMarketListed(
    new MarketListedData(
      protocol,
      new TokenData(
        underlyingTokenAddr,
        getOrElse<string>(cTokenContract.try_name(), "unknown"),
        getOrElse<string>(cTokenContract.try_symbol(), "unknown"),
        cTokenDecimals
      ),
      new TokenData(
        cTokenAddr,
        getOrElse<string>(underlyingTokenContract.try_name(), "unknown"),
        getOrElse<string>(underlyingTokenContract.try_symbol(), "unknown"),
        getOrElse<i32>(underlyingTokenContract.try_decimals(), 0)
      ),
      cTokenReserveFactorMantissa
    ),
    event
  );
}

export function handleNewCollateralFactor(event: NewCollateralFactor): void {
  templateHandleNewCollateralFactor(event);
}

export function handleNewLiquidationIncentive(
  event: NewLiquidationIncentive
): void {
  let protocol = getOrCreateProtocol();
  templateHandleNewLiquidationIncentive(protocol, event);
}

export function handleNewReserveFactor(event: NewReserveFactor): void {
  templateHandleNewReserveFactor(event);
}

export function handleMint(event: Mint): void {
  templateHandleMint(comptrollerAddr, event);
}

export function handleRedeem(event: Redeem): void {
  templateHandleRedeem(comptrollerAddr, event);
}

export function handleBorrow(event: BorrowEvent): void {
  templateHandleBorrow(comptrollerAddr, event);
}

export function handleRepayBorrow(event: RepayBorrow): void {
  templateHandleRepayBorrow(comptrollerAddr, event);
}

export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  templateHandleLiquidateBorrow(comptrollerAddr, event);
}

// This function is called whenever mint, redeem, borrow, repay, liquidateBorrow happens
export function handleAccrueInterest(event: AccrueInterest): void {
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[handleAccrueInterest] Market not found: {}", [marketID]);
    return;
  }
  if (market._accrualTimestamp.ge(event.block.timestamp)) {
    return;
  }
  updateMarket(marketID, event.block.number, event.block.timestamp);
  updateProtocol();
  snapshotMarket(
    event.address.toHexString(),
    event.block.number,
    event.block.timestamp
  );
  snapshotFinancials(event.block.number, event.block.timestamp);
}

function getOrCreateProtocol(): LendingProtocol {
  let protocolData = new ProtocolData(
    comptrollerAddr,
    "Moonwell",
    "moonwell",
    "1.2.0",
    "1.0.0",
    "1.0.0",
    Network.AURORA
  );
  let comptroller = Comptroller.bind(comptrollerAddr);
  return templateGetOrCreateProtocol(
    protocolData,
    comptroller.try_liquidationIncentiveMantissa()
  );
}

function updateMarket(
  marketID: string,
  blockNumber: BigInt,
  blockTimestamp: BigInt
): void {
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[updateMarket] Market not found: {}", [marketID]);
    return;
  }
  let marketAddress = Address.fromString(marketID);

  let underlyingToken = Token.load(market.inputToken);
  if (!underlyingToken) {
    log.warning("[updateMarket] Underlying token not found: {}", [
      market.inputToken,
    ]);
    return;
  }

  let underlyingTokenPriceUSD = getTokenPriceUSD(
    marketAddress,
    underlyingToken.decimals
  );

  underlyingToken.lastPriceUSD = underlyingTokenPriceUSD;
  underlyingToken.lastPriceBlockNumber = blockNumber;
  underlyingToken.save();

  market.inputTokenPriceUSD = underlyingTokenPriceUSD;

  let cTokenContract = CToken.bind(marketAddress);

  let totalSupplyResult = cTokenContract.try_totalSupply();
  if (totalSupplyResult.reverted) {
    log.warning("[updateMarket] Failed to get totalSupply of Market {}", [
      marketID,
    ]);
  } else {
    market.outputTokenSupply = totalSupplyResult.value;
  }

  let underlyingSupplyUSD = market.inputTokenBalance
    .toBigDecimal()
    .div(exponentToBigDecimal(underlyingToken.decimals))
    .times(underlyingTokenPriceUSD);
  market.totalValueLockedUSD = underlyingSupplyUSD;
  market.totalDepositBalanceUSD = underlyingSupplyUSD;

  let exchangeRateResult = cTokenContract.try_exchangeRateStored();
  if (exchangeRateResult.reverted) {
    log.warning(
      "[updateMarket] Failed to get exchangeRateStored of Market {}",
      [marketID]
    );
  } else {
    // Formula: check out "Interpreting Exchange Rates" in https://compound.finance/docs#protocol-math
    let oneCTokenInUnderlying = exchangeRateResult.value
      .toBigDecimal()
      .div(
        exponentToBigDecimal(
          mantissaFactor + underlyingToken.decimals - cTokenDecimals
        )
      );
    market.exchangeRate = oneCTokenInUnderlying;
    market.outputTokenPriceUSD = oneCTokenInUnderlying.times(
      underlyingTokenPriceUSD
    );
  }

  let totalBorrowsResult = cTokenContract.try_totalBorrows();
  let totalBorrowUSD = BIGDECIMAL_ZERO;
  if (totalBorrowsResult.reverted) {
    log.warning("[updateMarket] Failed to get totalBorrows of Market {}", [
      marketID,
    ]);
  } else {
    totalBorrowUSD = totalBorrowsResult.value
      .toBigDecimal()
      .div(exponentToBigDecimal(underlyingToken.decimals))
      .times(underlyingTokenPriceUSD);
    market.totalBorrowBalanceUSD = totalBorrowUSD;
  }

  let supplyRatePerTimestampResult =
    cTokenContract.try_supplyRatePerTimestamp();
  if (supplyRatePerTimestampResult.reverted) {
    log.warning(
      "[updateMarket] Failed to get supplyRatePerTimestamp of Market {}",
      [marketID]
    );
  } else {
    setSupplyInterestRate(
      marketID,
      convertRatePerTimestampToAPY(supplyRatePerTimestampResult.value)
    );
  }

  let borrowRatePerTimestampResult =
    cTokenContract.try_borrowRatePerTimestamp();
  let borrowRatePerTimestamp = BIGDECIMAL_ZERO;
  if (borrowRatePerTimestampResult.reverted) {
    log.warning(
      "[updateMarket] Failed to get borrowRatePerTimestamp of Market {}",
      [marketID]
    );
  } else {
    setBorrowInterestRate(
      marketID,
      convertRatePerTimestampToAPY(borrowRatePerTimestampResult.value)
    );

    borrowRatePerTimestamp = borrowRatePerTimestampResult.value
      .toBigDecimal()
      .div(mantissaFactorBD);
  }

  let totalRevenueUSDPerTimestamp = totalBorrowUSD.times(
    borrowRatePerTimestamp
  );
  let timestampDelta = blockTimestamp.minus(market._accrualTimestamp);
  let totalRevenueUSDDelta = totalRevenueUSDPerTimestamp.times(
    new BigDecimal(timestampDelta)
  );
  let protocolSideRevenueUSDDelta = totalRevenueUSDDelta.times(
    market._reserveFactor
  );
  let supplySideRevenueUSDDelta = totalRevenueUSDDelta.minus(
    protocolSideRevenueUSDDelta
  );

  market._cumulativeTotalRevenueUSD =
    market._cumulativeTotalRevenueUSD.plus(totalRevenueUSDDelta);
  market._cumulativeProtocolSideRevenueUSD =
    market._cumulativeProtocolSideRevenueUSD.plus(protocolSideRevenueUSDDelta);
  market._cumulativeSupplySideRevenueUSD =
    market._cumulativeSupplySideRevenueUSD.plus(supplySideRevenueUSDDelta);

  // update daily fields in snapshot
  let snapshot = new MarketDailySnapshot(
    getMarketDailySnapshotID(market.id, blockTimestamp.toI32())
  );
  snapshot._dailyTotalRevenueUSD =
    snapshot._dailyTotalRevenueUSD.plus(totalRevenueUSDDelta);
  snapshot._dailyProtocolSideRevenueUSD =
    snapshot._dailyProtocolSideRevenueUSD.plus(protocolSideRevenueUSDDelta);
  snapshot._dailySupplySideRevenueUSD =
    snapshot._dailySupplySideRevenueUSD.plus(supplySideRevenueUSDDelta);

  // rewards
  // let comptroller = Comptroller.bind(comptrollerAddr);
  // setMFAMReward(
  //   market,
  //   comptroller.try_borrowRewardSpeeds(0, marketAddress),
  //   0
  // );
  // setMOVRReward(
  //   market,
  //   comptroller.try_borrowRewardSpeeds(1, marketAddress),
  //   1
  // );
  // setMFAMReward(
  //   market,
  //   comptroller.try_supplyRewardSpeeds(0, marketAddress),
  //   2
  // );
  // setMOVRReward(
  //   market,
  //   comptroller.try_supplyRewardSpeeds(1, marketAddress),
  //   3
  // );

  market._accrualTimestamp = blockTimestamp;
  market.save();
}

function updateProtocol(): void {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString());
  if (!protocol) {
    log.error(
      "[updateProtocol] Protocol not found, this SHOULD NOT happen",
      []
    );
    return;
  }

  let totalValueLockedUSD = BIGDECIMAL_ZERO;
  let totalDepositBalanceUSD = BIGDECIMAL_ZERO;
  let totalBorrowBalanceUSD = BIGDECIMAL_ZERO;
  let cumulativeBorrowUSD = BIGDECIMAL_ZERO;
  let cumulativeDepositUSD = BIGDECIMAL_ZERO;
  let cumulativeLiquidateUSD = BIGDECIMAL_ZERO;
  let cumulativeTotalRevenueUSD = BIGDECIMAL_ZERO;
  let cumulativeProtocolSideRevenueUSD = BIGDECIMAL_ZERO;
  let cumulativeSupplySideRevenueUSD = BIGDECIMAL_ZERO;

  for (let i = 0; i < protocol._marketIDs.length; i++) {
    let market = Market.load(protocol._marketIDs[i]);
    if (!market) {
      log.warning("[updateProtocol] Market not found: {}", [
        protocol._marketIDs[i],
      ]);
      // best effort
      continue;
    }
    totalValueLockedUSD = totalValueLockedUSD.plus(market.totalValueLockedUSD);
    totalDepositBalanceUSD = totalDepositBalanceUSD.plus(
      market.totalDepositBalanceUSD
    );
    totalBorrowBalanceUSD = totalBorrowBalanceUSD.plus(
      market.totalBorrowBalanceUSD
    );
    cumulativeBorrowUSD = cumulativeBorrowUSD.plus(market.cumulativeBorrowUSD);
    cumulativeDepositUSD = cumulativeDepositUSD.plus(
      market.cumulativeDepositUSD
    );
    cumulativeLiquidateUSD = cumulativeLiquidateUSD.plus(
      market.cumulativeLiquidateUSD
    );
    cumulativeTotalRevenueUSD = cumulativeTotalRevenueUSD.plus(
      market._cumulativeTotalRevenueUSD
    );
    cumulativeProtocolSideRevenueUSD = cumulativeProtocolSideRevenueUSD.plus(
      market._cumulativeProtocolSideRevenueUSD
    );
    cumulativeSupplySideRevenueUSD = cumulativeSupplySideRevenueUSD.plus(
      market._cumulativeSupplySideRevenueUSD
    );
  }
  protocol.totalValueLockedUSD = totalValueLockedUSD;
  protocol.totalDepositBalanceUSD = totalDepositBalanceUSD;
  protocol.totalBorrowBalanceUSD = totalBorrowBalanceUSD;
  protocol.cumulativeBorrowUSD = cumulativeBorrowUSD;
  protocol.cumulativeDepositUSD = cumulativeDepositUSD;
  protocol.cumulativeLiquidateUSD = cumulativeLiquidateUSD;
  protocol.cumulativeTotalRevenueUSD = cumulativeTotalRevenueUSD;
  protocol.cumulativeProtocolSideRevenueUSD = cumulativeProtocolSideRevenueUSD;
  protocol.cumulativeSupplySideRevenueUSD = cumulativeSupplySideRevenueUSD;
  protocol.save();
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
function snapshotFinancials(blockNumber: BigInt, blockTimestamp: BigInt): void {
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

function setSupplyInterestRate(marketID: string, rate: BigDecimal): void {
  setInterestRate(marketID, rate, true);
}

function setBorrowInterestRate(marketID: string, rate: BigDecimal): void {
  setInterestRate(marketID, rate, false);
}

function setInterestRate(
  marketID: string,
  rate: BigDecimal,
  isSupply: boolean
): void {
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[setInterestRate] Market not found: {}", [marketID]);
    return;
  }
  if (market.rates.length < 2) {
    log.warning("[setInterestRate] Market has less than 2 rates: {}", [
      marketID,
    ]);
    return;
  }
  let supplyInterestRateID = market.rates[0];
  let borrowInterestRateID = market.rates[1];
  let supplyInterestRate = InterestRate.load(supplyInterestRateID);
  if (!supplyInterestRate) {
    log.warning("[setInterestRate] Supply interest rate not found: {}", [
      supplyInterestRateID,
    ]);
    return;
  }
  let borrowInterestRate = InterestRate.load(borrowInterestRateID);
  if (!borrowInterestRate) {
    log.warning("[setInterestRate] Borrow interest rate not found: {}", [
      borrowInterestRateID,
    ]);
    return;
  }
  if (isSupply) {
    supplyInterestRate.rate = rate;
    supplyInterestRate.save();
  } else {
    borrowInterestRate.rate = rate;
    borrowInterestRate.save();
  }
  market.rates = [supplyInterestRateID, borrowInterestRateID];
  market.save();
}

function setMOVRReward(
  market: Market,
  result: ethereum.CallResult<BigInt>,
  rewardIndex: i32
): void {
  if (result.reverted) {
    log.warning("[setMOVRReward] result reverted", []);
    return;
  }
  let rewardRatePerBlock = result.value;
  let rewardRatePerDay = rewardRatePerBlock.times(
    BigInt.fromI32(BLOCKS_PER_DAY)
  );
  if (market.rewardTokenEmissionsAmount) {
    let rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount!;
    rewardTokenEmissionsAmount[rewardIndex] = rewardRatePerDay;
    market.rewardTokenEmissionsAmount = rewardTokenEmissionsAmount;
  }
  let rewardToken = Token.load(MOVRAddr.toHexString());
  if (
    rewardToken &&
    rewardToken.lastPriceUSD &&
    market.rewardTokenEmissionsUSD
  ) {
    let rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD!;
    rewardTokenEmissionsUSD[rewardIndex] = rewardRatePerBlock
      .toBigDecimal()
      .div(exponentToBigDecimal(rewardToken.decimals))
      .times(rewardToken.lastPriceUSD!); // need ! otherwise not compile
    market.rewardTokenEmissionsUSD = rewardTokenEmissionsUSD;
  }
}

function setMFAMReward(
  market: Market,
  result: ethereum.CallResult<BigInt>,
  rewardIndex: i32
): void {
  if (result.reverted) {
    log.warning("[setMFAMReward] result reverted", []);
    return;
  }
  let rewardRatePerBlock = result.value;
  let rewardRatePerDay = rewardRatePerBlock.times(
    BigInt.fromI32(BLOCKS_PER_DAY)
  );
  if (market.rewardTokenEmissionsAmount) {
    let rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount!;
    rewardTokenEmissionsAmount[rewardIndex] = rewardRatePerDay;
    market.rewardTokenEmissionsAmount = rewardTokenEmissionsAmount;
    // TODO
    // Interact with the solarbeam pair contract (0xE6Bfc609A2e58530310D6964ccdd236fc93b4ADB on moonriver)
    // - Call getReserves()
    // let [MOVRReserve, MFAMReserve, _blockTimestampLast] = await contract.getReserves()
    // - Calculate MOVRReserve / MFAMReserve, divide by an 18 digit mantissa, and multiply that by the price of MOVR.
    // MOVRReserve.div(MFAMReserve).times(cachedPrice[this.$store.state.nativeAssetTicker])
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

function convertRatePerTimestampToAPY(ratePerTimestamp: BigInt): BigDecimal {
  return ratePerTimestamp
    .times(BigInt.fromI32(SECONDS_PER_YEAR))
    .toBigDecimal()
    .div(mantissaFactorBD)
    .times(BIGDECIMAL_HUNDRED);
}

function getTokenPriceUSD(
  cTokenAddr: Address,
  underlyingDecimals: i32
): BigDecimal {
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString());
  if (!protocol) {
    log.error(
      "[getTokenPriceUSD] Protocol not found, this SHOULD NOT happen",
      []
    );
    return BIGDECIMAL_ZERO;
  }
  let oracleAddress = Address.fromString(protocol._priceOracle);
  let mantissaDecimalFactor = 18 - underlyingDecimals + 18;
  let bdFactor = exponentToBigDecimal(mantissaDecimalFactor);
  let oracle = PriceOracle.bind(oracleAddress);
  return getOrElse<BigInt>(
    oracle.try_getUnderlyingPrice(cTokenAddr),
    BIGINT_ZERO
  )
    .toBigDecimal()
    .div(bdFactor);
}

function getOrElse<T>(result: ethereum.CallResult<T>, defaultValue: T): T {
  if (result.reverted) {
    return defaultValue;
  }
  return result.value;
}

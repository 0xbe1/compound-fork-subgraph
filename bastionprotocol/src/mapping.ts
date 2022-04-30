import {
  Address,
  BigInt,
  BigDecimal,
  log,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  Comptroller,
  MarketListed,
  NewCollateralFactor,
  NewLiquidationIncentive,
  NewPriceOracle,
} from "../generated/Comptroller/Comptroller";
import {
  AccrueInterest,
  CToken,
  LiquidateBorrow,
  NewReserveFactor,
} from "../generated/Comptroller/CToken";
import { CToken as CTokenTemplate } from "../generated/templates";
import { ERC20 } from "../generated/Comptroller/ERC20";
import {
  Mint,
  Redeem,
  Borrow as BorrowEvent,
  RepayBorrow,
} from "../generated/templates/CToken/CToken";
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
} from "../generated/schema";
import {
  BIGDECIMAL_ZERO,
  cETHAddr,
  comptrollerAddr,
  cTokenDecimals,
  cTokenDecimalsBD,
  ETHAddr,
  exponentToBigDecimal,
  LendingType,
  mantissaFactor,
  mantissaFactorBD,
  Network,
  ProtocolType,
  RiskType,
  SECONDS_PER_DAY,
  BLOCKS_PER_DAY,
  SECONDS_PER_HOUR,
  BIGDECIMAL_HUNDRED,
  BIGINT_ZERO,
  // MFAMAddr,
  RewardTokenType,
  InterestRateSide,
  InterestRateType,
  SECONDS_PER_YEAR,
} from "./constants";
import { PriceOracle } from "../generated/templates/CToken/PriceOracle";

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
  protocol._priceOracle = event.params.newPriceOracle.toHexString();
  protocol.save();
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

  //
  // create cToken
  //
  let cTokenContract = CToken.bind(event.params.cToken);

  // get underlying token
  let underlyingTokenAddr: Address;

  // if we cannot fetch the underlying token of a non-cETH cToken
  // then fail early
  if (cTokenAddr == cETHAddr) {
    underlyingTokenAddr = ETHAddr;
  } else {
    let underlyingTokenAddrResult = cTokenContract.try_underlying();
    if (underlyingTokenAddrResult.reverted) {
      log.warning(
        "[handleMarketListed] could not fetch underlying token of cToken: {}",
        [cTokenAddr.toHexString()]
      );
      return;
    }
    underlyingTokenAddr = underlyingTokenAddrResult.value;
  }

  cToken = new Token(cTokenAddr.toHexString());
  if (cTokenAddr == cETHAddr) {
    cToken.name = "Bastion Ether";
    cToken.symbol = "cETH";
    cToken.decimals = cTokenDecimals;
  } else {
    cToken.name = getOrElse<string>(cTokenContract.try_name(), "unknown");
    cToken.symbol = getOrElse<string>(cTokenContract.try_symbol(), "unknown");
    cToken.decimals = cTokenDecimals;
  }
  cToken.save();

  //
  // create underlying token
  //
  let underlyingToken = new Token(underlyingTokenAddr.toHexString());
  if (underlyingTokenAddr == ETHAddr) {
    // don't want to call CEther contract, hardcode instead
    underlyingToken.name = "Ether";
    underlyingToken.symbol = "ETH";
    underlyingToken.decimals = 18;
  } else {
    let underlyingTokenContract = ERC20.bind(underlyingTokenAddr);
    underlyingToken.name = getOrElse<string>(
      underlyingTokenContract.try_name(),
      "unknown"
    );
    underlyingToken.symbol = getOrElse<string>(
      underlyingTokenContract.try_symbol(),
      "unknown"
    );
    underlyingToken.decimals = getOrElse<i32>(
      underlyingTokenContract.try_decimals(),
      0
    );
  }
  underlyingToken.save();

  //
  // create market
  //
  let market = new Market(cTokenAddr.toHexString());
  let protocol = getOrCreateProtocol();
  market.name = cToken.name;
  market.protocol = protocol.id;
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
  market.liquidationPenalty = protocol._liquidationIncentive;

  let reserveFactorMantissaResult = cTokenContract.try_reserveFactorMantissa();
  if (!reserveFactorMantissaResult.reverted) {
    market._reserveFactor = reserveFactorMantissaResult.value
      .toBigDecimal()
      .div(mantissaFactorBD);
  }

  market.createdTimestamp = event.block.timestamp;
  market.createdBlockNumber = event.block.number;
  market.save();

  //
  // update protocol
  //
  let marketIDs = protocol._marketIDs;
  marketIDs.push(market.id);
  protocol._marketIDs = marketIDs;
  protocol.save();
}

//
//
// event.params.cToken:
// event.params.oldCollateralFactorMantissa:
// event.params.newCollateralFactorMantissa:
export function handleNewCollateralFactor(event: NewCollateralFactor): void {
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
export function handleNewLiquidationIncentive(
  event: NewLiquidationIncentive
): void {
  let protocol = getOrCreateProtocol();
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
// - oldReserveFactorMantissa
// - newReserveFactorMantissa
export function handleNewReserveFactor(event: NewReserveFactor): void {
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
// event.params
// - minter
// - mintAmount: The amount of underlying assets to mint
// - mintTokens: The amount of cTokens minted
export function handleMint(event: Mint): void {
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
  let protocol = getOrCreateProtocol();
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
export function handleRedeem(event: Redeem): void {
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
  let protocol = getOrCreateProtocol();
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
    event.block.number,
    event.block.timestamp,
    event.params.redeemer.toHexString(),
    EventType.Withdraw
  );
}

//
//
// event.params
// - borrower
// - borrowAmount
// - accountBorrows
// - totalBorrows
export function handleBorrow(event: BorrowEvent): void {
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[handleBorrow] Market not found: {}", [marketID]);
    return;
  }
  let underlyingToken = Token.load(market.inputToken);
  if (!underlyingToken) {
    log.warning("[handleBorrow] Failed to load underlying token: {}", [
      market.inputToken,
    ]);
    return;
  }

  let borrowID = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.transactionLogIndex.toString());
  let borrow = new Borrow(borrowID);
  let protocol = getOrCreateProtocol();
  borrow.hash = event.transaction.hash.toHexString();
  borrow.logIndex = event.transactionLogIndex.toI32();
  borrow.protocol = protocol.id;
  borrow.to = event.params.borrower.toHexString();
  borrow.from = marketID;
  borrow.blockNumber = event.block.number;
  borrow.timestamp = event.block.timestamp;
  borrow.market = marketID;
  borrow.asset = market.inputToken;
  borrow.amount = event.params.borrowAmount;
  let borrowUSD = market.inputTokenPriceUSD.times(
    event.params.borrowAmount
      .toBigDecimal()
      .div(exponentToBigDecimal(underlyingToken.decimals))
  );
  borrow.amountUSD = borrowUSD;
  borrow.save();

  market.cumulativeBorrowUSD = market.cumulativeBorrowUSD.plus(borrowUSD);
  market.save();

  updateMarketSnapshots(
    marketID,
    event.block.timestamp.toI32(),
    borrowUSD,
    EventType.Borrow
  );

  snapshotUsage(
    event.block.number,
    event.block.timestamp,
    event.params.borrower.toHexString(),
    EventType.Borrow
  );
}

//
//
// event.params
// - payer
// - borrower
// - repayAmount
// - accountBorrows
// - totalBorrows
export function handleRepayBorrow(event: RepayBorrow): void {
  let marketID = event.address.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[handleRepayBorrow] Market not found: {}", [marketID]);
    return;
  }
  let underlyingToken = Token.load(market.inputToken);
  if (!underlyingToken) {
    log.warning("[handleRepayBorrow] Failed to load underlying token: {}", [
      market.inputToken,
    ]);
    return;
  }

  let repayID = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.transactionLogIndex.toString());
  let repay = new Repay(repayID);
  let protocol = getOrCreateProtocol();
  repay.hash = event.transaction.hash.toHexString();
  repay.logIndex = event.transactionLogIndex.toI32();
  repay.protocol = protocol.id;
  repay.to = marketID;
  repay.from = event.params.payer.toHexString();
  repay.blockNumber = event.block.number;
  repay.timestamp = event.block.timestamp;
  repay.market = marketID;
  repay.asset = market.inputToken;
  repay.amount = event.params.repayAmount;
  repay.amountUSD = market.inputTokenPriceUSD.times(
    event.params.repayAmount
      .toBigDecimal()
      .div(exponentToBigDecimal(underlyingToken.decimals))
  );
  repay.save();

  snapshotUsage(
    event.block.number,
    event.block.timestamp,
    event.params.payer.toHexString(),
    EventType.Repay
  );
}

//
//
// event.params
// - liquidator
// - borrower
// - repayAmount
// - cTokenCollateral
// - seizeTokens
export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  let repayTokenMarketID = event.address.toHexString();
  let repayTokenMarket = Market.load(repayTokenMarketID);
  if (!repayTokenMarket) {
    log.warning("[handleLiquidateBorrow] Repay Token Market not found: {}", [
      repayTokenMarketID,
    ]);
    return;
  }
  if (!repayTokenMarket.inputToken) {
    log.warning(
      "[handleLiquidateBorrow] Repay Token Market {} has no input token",
      [repayTokenMarketID]
    );
    return;
  }
  let repayToken = Token.load(repayTokenMarket.inputToken);
  if (!repayToken) {
    log.warning("[handleLiquidateBorrow] Failed to load repay token: {}", [
      repayTokenMarket.inputToken,
    ]);
    return;
  }

  let liquidatedCTokenMarketID = event.params.cTokenCollateral.toHexString();
  let liquidatedCTokenMarket = Market.load(liquidatedCTokenMarketID);
  if (!liquidatedCTokenMarket) {
    log.warning(
      "[handleLiquidateBorrow] Liquidated CToken Market not found: {}",
      [liquidatedCTokenMarketID]
    );
    return;
  }
  let liquidatedCTokenID = liquidatedCTokenMarket.outputToken;
  if (!liquidatedCTokenID) {
    log.warning(
      "[handleLiquidateBorrow] Liquidated CToken Market {} has no output token",
      [liquidatedCTokenMarketID]
    );
    return;
  }
  // compiler is too silly to figure out this is not null, so add a !
  let liquidatedCToken = Token.load(liquidatedCTokenID!);
  if (!liquidatedCToken) {
    log.warning(
      "[handleLiquidateBorrow] Failed to load liquidated cToken: {}",
      [liquidatedCTokenID!]
    );
    return;
  }

  let liquidateID = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.transactionLogIndex.toString());
  let liquidate = new Liquidate(liquidateID);
  let protocol = getOrCreateProtocol();
  liquidate.hash = event.transaction.hash.toHexString();
  liquidate.logIndex = event.transactionLogIndex.toI32();
  liquidate.protocol = protocol.id;
  liquidate.to = repayTokenMarketID;
  liquidate.from = event.params.liquidator.toHexString();
  liquidate.blockNumber = event.block.number;
  liquidate.timestamp = event.block.timestamp;
  liquidate.market = repayTokenMarketID;
  if (liquidatedCTokenID) {
    // this is logically redundant since nullcheck has been done before, but removing the if check will fail 'graph build'
    liquidate.asset = liquidatedCTokenID;
  }
  liquidate.amount = event.params.seizeTokens;
  let gainUSD = event.params.seizeTokens
    .toBigDecimal()
    .div(cTokenDecimalsBD)
    .times(liquidatedCTokenMarket.outputTokenPriceUSD);
  let lossUSD = event.params.repayAmount
    .toBigDecimal()
    .div(exponentToBigDecimal(repayToken.decimals))
    .times(repayTokenMarket.inputTokenPriceUSD);
  liquidate.amountUSD = gainUSD;
  liquidate.profitUSD = gainUSD.minus(lossUSD);
  liquidate.save();

  liquidatedCTokenMarket.cumulativeLiquidateUSD =
    liquidatedCTokenMarket.cumulativeLiquidateUSD.plus(gainUSD);
  liquidatedCTokenMarket.save();

  updateMarketSnapshots(
    liquidatedCTokenMarketID,
    event.block.timestamp.toI32(),
    gainUSD,
    EventType.Liquidate
  );

  snapshotUsage(
    event.block.number,
    event.block.timestamp,
    event.params.liquidator.toHexString(),
    EventType.Liquidate
  );
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
  let protocol = LendingProtocol.load(comptrollerAddr.toHexString());
  if (!protocol) {
    protocol = new LendingProtocol(comptrollerAddr.toHexString());
    protocol.name = "Bastion Protocol";
    protocol.slug = "bastion-protocol";
    protocol.schemaVersion = "1.2.0";
    protocol.subgraphVersion = "1.0.0";
    protocol.methodologyVersion = "1.0.0";
    protocol.network = Network.AURORA;
    protocol.type = ProtocolType.LENDING;
    protocol.lendingType = LendingType.POOLED;
    protocol.riskType = RiskType.GLOBAL;

    let comptroller = Comptroller.bind(comptrollerAddr);
    protocol._liquidationIncentive = comptroller
      .liquidationIncentiveMantissa()
      .toBigDecimal()
      .div(mantissaFactorBD)
      .times(BIGDECIMAL_HUNDRED);
    protocol.save();
  }
  return protocol;
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

  let supplyRatePerTimestampResult = cTokenContract.try_supplyRatePerBlock();
  if (supplyRatePerTimestampResult.reverted) {
    log.warning(
      "[updateMarket] Failed to get supplyRatePerBlock of Market {}",
      [marketID]
    );
  } else {
    setSupplyInterestRate(
      marketID,
      convertRatePerTimestampToAPY(supplyRatePerTimestampResult.value)
    );
  }

  let borrowRatePerTimestampResult = cTokenContract.try_borrowRatePerBlock();
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
  let rewardToken = Token.load(ETHAddr.toHexString());
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

import { Address, BigInt, ethereum, log } from "@graphprotocol/graph-ts";
// import from the generated at root in order to reuse methods from root
import {
  NewPriceOracle,
  MarketListed,
  NewCollateralFactor,
  NewLiquidationIncentive,
} from "../../generated/Comptroller/Comptroller";
import {
  Mint,
  Redeem,
  Borrow as BorrowEvent,
  RepayBorrow,
  LiquidateBorrow,
  AccrueInterest,
  NewReserveFactor,
} from "../../generated/templates/CToken/CToken";
import {
  LendingProtocol,
  Market,
  RewardToken,
  Token,
} from "../../generated/schema";
import {
  cTokenDecimals,
  Network,
  BIGINT_ZERO,
  SECONDS_PER_YEAR,
  InterestRateSide,
  RewardTokenType,
  BIGDECIMAL_ZERO,
  exponentToBigDecimal,
} from "../../src/constants";
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
  UpdateMarketData,
  AccruePer,
  templateHandleAccrueInterest,
  getOrElse,
} from "../../src/mapping";
// otherwise import from the specific subgraph root
import { CToken } from "../generated/Comptroller/CToken";
import { Comptroller } from "../generated/Comptroller/Comptroller";
import { CToken as CTokenTemplate } from "../generated/templates";
import { ERC20 } from "../generated/Comptroller/ERC20";
import {
  comptrollerAddr,
  MFAMAddr,
  MOVRAddr,
  nativeCToken,
  nativeToken,
} from "./constants";
import { PriceOracle } from "../generated/templates/CToken/PriceOracle";

export function handleNewPriceOracle(event: NewPriceOracle): void {
  let protocol = getOrCreateProtocol();
  templateHandleNewPriceOracle(protocol, event);
}

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
    initMarketRewards(cTokenAddr.toHexString());
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
  initMarketRewards(cTokenAddr.toHexString());
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
  let marketAddress = event.address;

  setMarketRewards(marketAddress);

  let cTokenContract = CToken.bind(marketAddress);
  let protocol = getOrCreateProtocol();
  let oracleContract = PriceOracle.bind(
    Address.fromString(protocol._priceOracle)
  );
  let updateMarketData = new UpdateMarketData(
    cTokenContract.try_totalSupply(),
    cTokenContract.try_exchangeRateStored(),
    cTokenContract.try_totalBorrows(),
    cTokenContract.try_supplyRatePerTimestamp(),
    cTokenContract.try_borrowRatePerTimestamp(),
    AccruePer.Timestamp,
    oracleContract.try_getUnderlyingPrice(marketAddress),
    SECONDS_PER_YEAR
  );

  templateHandleAccrueInterest(updateMarketData, comptrollerAddr, event);
}

function getOrCreateProtocol(): LendingProtocol {
  let comptroller = Comptroller.bind(comptrollerAddr);
  let protocolData = new ProtocolData(
    comptrollerAddr,
    "Moonwell",
    "moonwell",
    "1.2.0",
    "1.0.0",
    "1.0.0",
    Network.MOONRIVER,
    comptroller.try_liquidationIncentiveMantissa()
  );

  return templateGetOrCreateProtocol(protocolData);
}

// assumptions: reward 0 is MFAM, reward 1 is MOVR
// [MFAM-supply, MOVR-supply, MFAM-borrow, MOVR-borrow]
function initMarketRewards(marketID: string): void {
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[initMarketRewards] market not found: {}", [marketID]);
    return;
  }

  let MFAMToken = Token.load(MFAMAddr.toHexString());
  if (!MFAMToken) {
    MFAMToken = new Token(MFAMAddr.toHexString());
    MFAMToken.name = "MFAM";
    MFAMToken.symbol = "MFAM";
    MFAMToken.decimals = 18;
    MFAMToken.save();
  }
  let MOVRToken = Token.load(MOVRAddr.toHexString());
  if (!MOVRToken) {
    MOVRToken = new Token(MOVRAddr.toHexString());
    MOVRToken.name = "MOVR";
    MOVRToken.symbol = "MOVR";
    MOVRToken.decimals = 18;
    MOVRToken.save();
  }

  let supplyRewardToken0 = RewardToken.load(
    InterestRateSide.LENDER.concat("-").concat(MFAMAddr.toHexString())
  );
  if (!supplyRewardToken0) {
    supplyRewardToken0 = new RewardToken(
      InterestRateSide.LENDER.concat("-").concat(MFAMAddr.toHexString())
    );
    supplyRewardToken0.token = MFAMToken.id;
    supplyRewardToken0.type = RewardTokenType.DEPOSIT;
    supplyRewardToken0.save();
  }

  let supplyRewardToken1 = RewardToken.load(
    InterestRateSide.LENDER.concat("-").concat(MOVRAddr.toHexString())
  );
  if (!supplyRewardToken1) {
    supplyRewardToken1 = new RewardToken(
      InterestRateSide.LENDER.concat("-").concat(MOVRAddr.toHexString())
    );
    supplyRewardToken1.token = MOVRToken.id;
    supplyRewardToken1.type = RewardTokenType.DEPOSIT;
    supplyRewardToken1.save();
  }

  let borrowRewardToken0 = RewardToken.load(
    InterestRateSide.BORROWER.concat("-").concat(MFAMAddr.toHexString())
  );
  if (!borrowRewardToken0) {
    borrowRewardToken0 = new RewardToken(
      InterestRateSide.BORROWER.concat("-").concat(MFAMAddr.toHexString())
    );
    borrowRewardToken0.token = MFAMToken.id;
    borrowRewardToken0.type = RewardTokenType.BORROW;
    borrowRewardToken0.save();
  }

  let borrowRewardToken1 = RewardToken.load(
    InterestRateSide.BORROWER.concat("-").concat(MOVRAddr.toHexString())
  );
  if (!borrowRewardToken1) {
    borrowRewardToken1 = new RewardToken(
      InterestRateSide.BORROWER.concat("-").concat(MOVRAddr.toHexString())
    );
    borrowRewardToken1.token = MOVRToken.id;
    borrowRewardToken1.type = RewardTokenType.BORROW;
    borrowRewardToken1.save();
  }

  market.rewardTokens = [
    supplyRewardToken0.id,
    supplyRewardToken1.id,
    borrowRewardToken0.id,
    borrowRewardToken1.id,
  ];
  market.rewardTokenEmissionsAmount = [
    BIGINT_ZERO,
    BIGINT_ZERO,
    BIGINT_ZERO,
    BIGINT_ZERO,
  ];
  market.rewardTokenEmissionsUSD = [
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
    BIGDECIMAL_ZERO,
  ];
  market.save();
}

function setMarketRewards(marketAddress: Address): void {
  let marketID = marketAddress.toHexString();
  let market = Market.load(marketID);
  if (!market) {
    log.warning("[setMarketRewards] Market not found: {}", [marketID]);
    return;
  }
  let comptroller = Comptroller.bind(comptrollerAddr);
  // set MFAM
  setMFAMReward(
    market,
    comptroller.try_supplyRewardSpeeds(0, marketAddress),
    0
  );
  setMFAMReward(
    market,
    comptroller.try_borrowRewardSpeeds(0, marketAddress),
    2
  );
  // set MOVR
  setMOVRReward(
    market,
    comptroller.try_supplyRewardSpeeds(1, marketAddress),
    1
  );
  setMOVRReward(
    market,
    comptroller.try_borrowRewardSpeeds(1, marketAddress),
    3
  );
}

function setMOVRReward(
  market: Market,
  rewardSpeedsResult: ethereum.CallResult<BigInt>,
  rewardIndex: i32
): void {
  if (rewardSpeedsResult.reverted) {
    log.warning("[setMOVRReward] result reverted", []);
    return;
  }
  let rewardAmountPerSecond = rewardSpeedsResult.value;
  let rewardAmountPerYear = rewardAmountPerSecond.times(
    BigInt.fromI32(SECONDS_PER_YEAR)
  );
  if (market.rewardTokenEmissionsAmount) {
    let rewardTokenEmissionsAmount = market.rewardTokenEmissionsAmount!;
    rewardTokenEmissionsAmount[rewardIndex] = rewardAmountPerYear;
    market.rewardTokenEmissionsAmount = rewardTokenEmissionsAmount;
  }
  let rewardToken = Token.load(MOVRAddr.toHexString());
  if (
    rewardToken &&
    rewardToken.lastPriceUSD &&
    market.rewardTokenEmissionsUSD
  ) {
    let rewardTokenEmissionsUSD = market.rewardTokenEmissionsUSD!;
    rewardTokenEmissionsUSD[rewardIndex] = rewardAmountPerYear
      .toBigDecimal()
      .div(exponentToBigDecimal(rewardToken.decimals))
      .times(rewardToken.lastPriceUSD!); // need ! otherwise not compile
    market.rewardTokenEmissionsUSD = rewardTokenEmissionsUSD;
  }
  market.save()
}

// Interact with the solarbeam pair contract (0xE6Bfc609A2e58530310D6964ccdd236fc93b4ADB on moonriver)
// Call getReserves()
// let [MOVRReserve, MFAMReserve, _blockTimestampLast] = await contract.getReserves()
// Calculate MOVRReserve / MFAMReserve, divide by an 18 digit mantissa, and multiply that by the price of MOVR.
// MOVRReserve.div(MFAMReserve).times(cachedPrice[this.$store.state.nativeAssetTicker])
function setMFAMReward(
  market: Market,
  rewardSpeedsResult: ethereum.CallResult<BigInt>,
  rewardIndex: i32
): void {}

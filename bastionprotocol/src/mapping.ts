import { Address, BigInt, log } from "@graphprotocol/graph-ts";
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
import { LendingProtocol, Token } from "../../generated/schema";
import {
  cTokenDecimals,
  Network,
  BIGINT_ZERO,
  SECONDS_PER_YEAR,
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
import { comptrollerAddr, nativeCToken, nativeToken } from "./constants";
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

export function handleAccrueInterest(event: AccrueInterest): void {
  let marketAddress = event.address;
  let cTokenContract = CToken.bind(marketAddress);
  let protocol = getOrCreateProtocol();
  let oracleContract = PriceOracle.bind(
    Address.fromString(protocol._priceOracle)
  );
  let updateMarketData = new UpdateMarketData(
    cTokenContract.try_totalSupply(),
    cTokenContract.try_exchangeRateStored(),
    cTokenContract.try_totalBorrows(),
    cTokenContract.try_supplyRatePerBlock(),
    cTokenContract.try_borrowRatePerBlock(),
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
    "Bastion Protocol",
    "bastion-protocol",
    "1.2.0",
    "1.0.0",
    "1.0.0",
    Network.AURORA,
    comptroller.try_liquidationIncentiveMantissa()
  );
  return templateGetOrCreateProtocol(protocolData);
}

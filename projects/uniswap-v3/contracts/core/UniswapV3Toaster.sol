// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.7.6;
pragma abicoder v2;

import "../interfaces/IUniswapV3Menu.sol";
import "../interfaces/IUniswapV3Toaster.sol";
import "@uniswap/v3-periphery/contracts/base/SelfPermit.sol";
import "@uniswap/v3-periphery/contracts/base/PeripheryImmutableState.sol";
import "../external/V3SwapRouter.sol";
import "../external/base/ApproveAndCall.sol";
import "../external/base/MulticallExtended.sol";

contract UniswapV3Toaster is
    V3SwapRouter,
    IUniswapV3Toaster,
    ApproveAndCall,
    MulticallExtended,
    SelfPermit
{
    address public immutable menu;

    constructor(
        address factoryV3,
        address _positionManager,
        address _WETH9,
        address _menu
    )
        ImmutableState(address(0), _positionManager)
        PeripheryImmutableState(factoryV3, _WETH9)
    {
        menu = _menu;
    }

    function exactInputSingleBySelf(
        ExactInputBySelfParams memory params
    ) external payable returns (uint256 amountOut) {
        require(
            params.slippage == 0 ||
                (params.slippage > 1e2 && params.slippage < 1e5),
            "Slippage must be 0 or between 0.01% and 100%"
        );
        uint160 sqrtPriceLimitX96;
        {
            bool inputTokenIsSmaller = params.tokenIn < params.tokenOut;
            (address tokenA, address tokenB) = inputTokenIsSmaller
                ? (params.tokenIn, params.tokenOut)
                : (params.tokenOut, params.tokenIn);
            (uint160 crtSqrtPriceX96, , , , , , ) = IUniswapV3Pool(
                IUniswapV3Factory(factory).getPool(tokenA, tokenB, params.fee)
            ).slot0();
            sqrtPriceLimitX96 = inputTokenIsSmaller
                ? (crtSqrtPriceX96 * (1e6 - params.slippage)) / 1e6
                : (crtSqrtPriceX96 * (1e6 + params.slippage)) / 1e6;
        }

        amountOut = exactInputInternal(
            params.amountIn,
            address(this),
            sqrtPriceLimitX96,
            SwapCallbackData({
                path: abi.encodePacked(
                    params.tokenIn,
                    params.fee,
                    params.tokenOut
                ),
                payer: address(this)
            })
        );
    }

    function getSwapAmountForAddLiquidity(
        SwapAmountForAddLiquidityParams calldata params
    )
        external
        view
        returns (uint256 amountIn, uint256 amountOut, bool isSwapX)
    {
        return IUniswapV3Menu(menu).getSwapAmountForAddLiquidity(params);
    }

    function getSwapAmountForIncreaseLiquidity(
        SwapAmountForIncreaseLiquidityParams calldata params
    )
        external
        view
        returns (uint256 amountIn, uint256 amountOut, bool isSwapX)
    {
        return IUniswapV3Menu(menu).getSwapAmountForIncreaseLiquidity(params);
    }

    function total(
        INonfungiblePositionManager positionManager,
        uint256 tokenId
    )
        external
        view
        returns (uint256 amount0, uint256 amount1, uint160 sqrtRatioX96)
    {
        sqrtRatioX96 = getSqrtRatioX96FromId(tokenId, positionManager);
        (amount0, amount1) = IUniswapV3Menu(menu).total(
            positionManager,
            tokenId,
            sqrtRatioX96
        );
    }

    function principal(
        INonfungiblePositionManager positionManager,
        uint256 tokenId
    )
        external
        view
        returns (uint256 amount0, uint256 amount1, uint160 sqrtRatioX96)
    {
        sqrtRatioX96 = getSqrtRatioX96FromId(tokenId, positionManager);
        (amount0, amount1) = IUniswapV3Menu(menu).principal(
            positionManager,
            tokenId,
            sqrtRatioX96
        );
    }

    function fees(
        INonfungiblePositionManager positionManager,
        uint256 tokenId
    ) external view returns (uint256 amount0, uint256 amount1) {
        return IUniswapV3Menu(menu).fees(positionManager, tokenId);
    }

    function getSqrtRatioX96FromId(
        uint tokenId,
        INonfungiblePositionManager positionManager
    ) internal view returns (uint160 sqrtRatioX96) {
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            ,
            ,
            ,
            ,
            ,
            ,

        ) = positionManager.positions(tokenId);
        (sqrtRatioX96, , , , , , ) = IUniswapV3Pool(
            IUniswapV3Factory(factory).getPool(token0, token1, fee)
        ).slot0();
    }
}

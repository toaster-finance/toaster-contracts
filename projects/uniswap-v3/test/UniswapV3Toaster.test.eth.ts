import { expect } from "chai";
import { ethers } from "hardhat";
import CONFIG from "../config/mainet-fork.json";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ContractTransactionReceipt, N } from "ethers";
import {
  IApproveAndCall,
  IERC20,
  IUniswapV3Pool,
  IWETH9,
  UniswapV3Menu,
  UniswapV3Toaster,
} from "../typechain-types";
import makeWETH from "../scripts/utils/makeWETH";
import { IUniswapV3Toaster } from "../typechain-types/contracts/core/UniswapV3Toaster";
import makeResultFromReceipt from "./utils";


const UNISWAPV3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAPV3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const test_case: {
  randomMax: number;
  caseNumber: number;
  randomAmount: number;
  randomETH: bigint;
  randomUpperTick: bigint;
  randomLowerTick: bigint;
}[] = [];
let c = 0;
for (let i = 1; i <= 3; i++) {
  for (let j = 1; j < 3; j++) {
    c++;
    let randomMax: number = Math.random() * 200;
    let randomAmount: number = Math.random() * randomMax;
    let randomUpperTick: bigint = BigInt(Math.floor(Math.random() * 2000));
    let randomLowerTick: bigint = BigInt(Math.floor(Math.random() * 2000));
    let randomETH: bigint = ethers.parseEther((Math.random() * 100).toString());

    test_case.push({
      randomMax: randomMax,
      caseNumber: c,
      randomAmount: randomAmount,
      randomETH: randomETH,
      randomUpperTick: randomUpperTick,
      randomLowerTick: randomLowerTick,
    });
  }
}
describe("UniswapV3Toaster", () => {
  let menu: UniswapV3Menu;
  let toaster: UniswapV3Toaster;
  let pool: IUniswapV3Pool;
  let signer: HardhatEthersSigner;
  let weth: IWETH9;
  let matic: IERC20;

  before("Deploy UniswapV3 Toaster", async () => {
    // Deploy menu & Deploy UniswapV3Toaster
    [signer] = await ethers.getSigners();
    const menu_f = await ethers.getContractFactory("UniswapV3Menu");
    menu = await menu_f.deploy();
    const toaster_f = await ethers.getContractFactory("UniswapV3Toaster");

    toaster = await toaster_f
      .deploy(
        UNISWAPV3_FACTORY,
        UNISWAPV3_POSITION_MANAGER,
        CONFIG.WETH,
        await menu.getAddress()
      )
      .then((tx) => tx.waitForDeployment());

    weth = await ethers.getContractAt("IWETH9", CONFIG.WETH);
    matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
  });
  it("Make WETH & MATIC", async () => {
    await makeWETH("10", CONFIG.WETH);
    await toaster.exactInputSingle({
      tokenIn: CONFIG.WETH,
      tokenOut: CONFIG.MATIC,
      fee: 3000,
      recipient: signer.address,
      amountIn: ethers.parseEther("5"),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
  });

  it("1️⃣ Swap WETH, Supply WETH from lack of ETH:Multicall UniswapV3Toaster with 100 MATIC & 1 WETH & 1ETH    ", async () => {
    const toasterItf = toaster.interface;
    const amount0 = ethers.parseEther("100"); // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = ethers.parseEther("1"); // WETH
    const token1 = CONFIG.WETH;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
    const nativeInputAmount = ethers.parseEther("1");
    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, swapAmountOut, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: 60n * ((tick - 200n) / 60n),
      tickUpper: 60n * ((tick + 200n) / 60n),
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);

    const result = makeResultFromReceipt(receipt);

    expect(await weth.balanceOf(await toaster.getAddress())).to.be.equal(0);

    expect(await matic.balanceOf(await toaster.getAddress())).to.be.equal(0);
  });
  it("2️⃣ Swap MATIC, No Native Token: Multicall UniswapV3Toaster with 10000 MATIC & 1 WETH ", async () => {
    const toasterItf = toaster.interface;
    const amount0 = ethers.parseEther("1000"); // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = 0n; // WETH
    const token1 = CONFIG.WETH;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
    const nativeInputAmount = ethers.parseEther("1");
    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, _, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: 60n * ((tick - 200n) / 60n),
      tickUpper: 60n * ((tick + 200n) / 60n),
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);

    const result = makeResultFromReceipt(receipt);
  });

  it("3️⃣ Swap WETH, with Native Coin: Multicall UniswapV3Toaster with 100 MATIC & 1ETH", async () => {
    const toasterItf = toaster.interface;
    const amount0 = ethers.parseEther("100"); // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = 0n; // WETH
    const token1 = CONFIG.WETH;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
    const nativeInputAmount = ethers.parseEther("1");
    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, swapAmountOut, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: 60n * ((tick - 200n) / 60n),
      tickUpper: 60n * ((tick + 200n) / 60n),
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);

    const result = makeResultFromReceipt(receipt);
  });
  it("4️⃣ Invest only WETH , Swap WETH: Multicall UniswapV3Toaster with 1ETH", async () => {
    const toasterItf = toaster.interface;
    const amount0 = 0n; // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = ethers.parseEther("0.1"); // WETH
    const token1 = CONFIG.WETH;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
    const nativeInputAmount = 0n;
    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, swapAmountOut, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: -80100,
      tickUpper: -79500,
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);

    const result = makeResultFromReceipt(receipt);
  });
  it("5️⃣ Invest WETH & MATIC, Swap WETH:Multicall UniswapV3Toaster with 1WETH & 100MATIC", async () => {
    const toasterItf = toaster.interface;
    const amount0 = ethers.parseEther("100"); // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = ethers.parseEther("1"); // WETH
    const token1 = CONFIG.WETH;
    const nativeInputAmount = 0n;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);

    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, swapAmountOut, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: 60n * ((tick - 200n) / 60n),
      tickUpper: 60n * ((tick + 200n) / 60n),
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);
    const result = makeResultFromReceipt(receipt);
  });
  it("6️⃣ Invest only MATIC , Swap MATIC: Multicall UniswapV3Toaster with 100MATIC", async () => {
    const toasterItf = toaster.interface;
    const amount0 = ethers.parseEther("100"); // MATIC
    const token0 = CONFIG.MATIC;
    const amount1 = 0n; // WETH
    const token1 = CONFIG.WETH;
    const nativeInputAmount = 0n;
    const weth = await ethers.getContractAt("IERC20", CONFIG.WETH);
    const matic = await ethers.getContractAt("IERC20", CONFIG.MATIC);
    await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
    await matic.approve(await toaster.getAddress(), ethers.MaxUint256);

    const tick = await ethers
      .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
      .then((l) => l.slot0())
      .then((slot0) => slot0.tick);
    const [swapAmountIn, swapAmountOut, isSwap0] =
      await menu.getSwapAmountForAddLiquidity({
        pool: CONFIG.POOL_MATIC_WETH,
        tickUpper: 60n * ((tick + 200n) / 60n),
        tickLower: 60n * ((tick - 200n) / 60n),
        amount0: amount0,
        amount1: amount1 + nativeInputAmount,
        height: 72,
      });
    const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
      ? [token0, token1, amount0, amount1]
      : [token1, token0, amount1, amount0];
    const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
      {
        tokenIn,
        tokenOut,
        fee: 3000,
        amountIn: swapAmountIn,
        slippage: 1e4 // 1% slippage
      };

    const mintParams: IApproveAndCall.MintParamsStruct = {
      token0: tokenIn < tokenOut ? tokenIn : tokenOut,
      token1: tokenOut < tokenIn ? tokenIn : tokenOut,
      fee: 3000,
      tickLower: 60n * ((tick - 200n) / 60n),
      tickUpper: 60n * ((tick + 200n) / 60n),
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
    };

    const multicallData: string[] = [];
    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
      );
    }

    if (amountIn > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
      );
    }
    if (amountOut > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
      );
    }

    multicallData.push(
      toasterItf.encodeFunctionData("exactInputSingleBySelf", [
        exactInputSingleBySelfParams,
      ])
    );

    multicallData.push(
      toasterItf.encodeFunctionData("approveMax", [tokenIn]),
      toasterItf.encodeFunctionData("approveMax", [tokenOut]),
      toasterItf.encodeFunctionData("mint", [mintParams])
    );

    if (nativeInputAmount > 0n) {
      multicallData.push(
        toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn == token1 ? tokenOut : tokenIn,
          0n,
        ])
      );
    } else {
      multicallData.push(
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenIn,
          0n,
        ]), // sweepToken tokenIn
        toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
          tokenOut,
          0n,
        ])
      );
    }

    const receipt = await toaster["multicall(bytes[])"](multicallData, {
      value: nativeInputAmount,
    })
      .then((t) => t.wait())
      .then((receipt) => receipt as ContractTransactionReceipt);
    const result = makeResultFromReceipt(receipt);
  });

  test_case.forEach((c) => {
    it(`🧪 ${c.caseNumber}: Make WETH & MATIC Randomly Test Case `, async () => {
      await weth.deposit({ value: ethers.parseEther(c.randomMax.toString()) });

      await toaster.exactInputSingle({
        tokenIn: CONFIG.WETH,
        tokenOut: CONFIG.MATIC,
        fee: 3000,
        recipient: signer.address,
        amountIn: ethers.parseEther(c.randomAmount.toString()),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });
    });

    it(`🧪 Test Case ${c.caseNumber}`, async () => {
      const toasterItf = toaster.interface;
      const amount0 = await matic.balanceOf(signer.address); // MATIC
      const token0 = CONFIG.MATIC;
      const amount1 = await weth.balanceOf(signer.address); // WETH
      const token1 = CONFIG.WETH;

      await weth.approve(await toaster.getAddress(), ethers.MaxUint256);
      await matic.approve(await toaster.getAddress(), ethers.MaxUint256);
      const nativeInputAmount = c.randomETH;

      const tick = await ethers
        .getContractAt("IUniswapV3Pool", CONFIG.POOL_MATIC_WETH)
        .then((l) => l.slot0())
        .then((slot0) => slot0.tick);
      const [swapAmountIn, swapAmountOut, isSwap0] =
        await menu.getSwapAmountForAddLiquidity({
          pool: CONFIG.POOL_MATIC_WETH,
          tickUpper: 60n * ((tick + c.randomUpperTick) / 60n),
          tickLower: 60n * ((tick - c.randomLowerTick) / 60n),
          amount0: amount0,
          amount1: amount1 + nativeInputAmount,
          height: 120,
        });

      const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
        ? [token0, token1, amount0, amount1]
        : [token1, token0, amount1, amount0];
      const exactInputSingleBySelfParams: IUniswapV3Toaster.ExactInputBySelfParamsStruct =
        {
          tokenIn,
          tokenOut,
          fee: 3000,
          amountIn: swapAmountIn,
          slippage: 1e4 // 1% slippage
        };

      const mintParams: IApproveAndCall.MintParamsStruct = {
        token0: tokenIn < tokenOut ? tokenIn : tokenOut,
        token1: tokenOut < tokenIn ? tokenIn : tokenOut,
        fee: 3000,
        tickLower: 60n * ((tick - c.randomLowerTick) / 60n),
        tickUpper: 60n * ((tick + c.randomUpperTick) / 60n),
        amount0Min: 0,
        amount1Min: 0,
        recipient: signer.address,
      };

      const multicallData: string[] = [];
      if (nativeInputAmount > 0n) {
        multicallData.push(
          toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
        );
      }

      if (amountIn > 0n) {
        multicallData.push(
          toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
        );
      }
      if (amountOut > 0n) {
        multicallData.push(
          toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
        );
      }

      multicallData.push(
        toasterItf.encodeFunctionData("exactInputSingleBySelf", [
          exactInputSingleBySelfParams,
        ])
      );

      multicallData.push(
        toasterItf.encodeFunctionData("approveMax", [tokenIn]),
        toasterItf.encodeFunctionData("approveMax", [tokenOut]),
        toasterItf.encodeFunctionData("mint", [mintParams])
      );

      if (nativeInputAmount > 0n) {
        multicallData.push(
          toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
          toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
            tokenIn == token1 ? tokenOut : tokenIn,
            0n,
          ])
        );
      } else {
        multicallData.push(
          toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
            tokenIn,
            0n,
          ]), // sweepToken tokenIn
          toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
            tokenOut,
            0n,
          ])
        );
      }

      const receipt = await toaster["multicall(bytes[])"](multicallData, {
        value: nativeInputAmount,
      })
        .then((t) => t.wait())
        .then((receipt) => receipt as ContractTransactionReceipt);

      const result = makeResultFromReceipt(receipt);
      expect(
        Number(result.addLiquidityAmount0) /
          Number(amount0 + (isSwap0 ? -swapAmountIn : swapAmountOut))
      ).to.be.equal(1, "100% of MATIC is added to liquidity");

      expect(
        Number(result.addLiquidityAmount1) /
          Number(
            amount1 +
              nativeInputAmount +
              (isSwap0 ? swapAmountOut : -swapAmountIn)
          )
      ).to.be.equal(1, "100% of WETH + ETH is added to liquidity");
    });
    it(`🧪 Check reserve of WETH & MATIC`, async () => {
      expect(
        await weth.balanceOf(await toaster.getAddress()),
        "WETH Balance of Toaster"
      ).to.be.equal(0n);
      expect(
        await matic.balanceOf(await toaster.getAddress()),
        "MATIC Balance of Toaster"
      ).to.be.equal(0n);
      expect(
        await ethers.provider.getBalance(await toaster.getAddress()),
        "ETH Balance of Toaster"
      ).to.be.equal(0n);
    });
  });
});


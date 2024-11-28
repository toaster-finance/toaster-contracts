import { ContractTransactionReceipt } from 'ethers';
import { ethers } from 'hardhat';
const V3_SWAP_EVENT_SIGNATURE =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const V3_MINT_EVENT_SIGNATURE =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INCREASE_EVENT_SIGNATURE =
  "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";

export default function makeResultFromReceipt(receipt: ContractTransactionReceipt) {
  const tokenId = getTokenIdFromReceipt(receipt);

  const [swapAmountInResult, swapAmountOutResult]: bigint[] =
    getAmountInAndOutFromReceipt(receipt);
  const [addLiquidityAmount0, addLiquidityAmount1]: bigint[] =
    getAddLiquidityAmountFromReceipt(receipt);

  const { leftTokenAddress, leftTokenAmount } =
    getLeftTokensFromReceipt(receipt);
  const result = {
    tokenId: tokenId.toString(),
    addLiquidityAmount0: addLiquidityAmount0.toString(),
    addLiquidityAmount1: addLiquidityAmount1.toString(),
    swapAmountIn: swapAmountInResult.toString(),
    swapAmountOut: swapAmountOutResult.toString(),
    leftTokenAddress: leftTokenAddress,
    leftTokenAmount: leftTokenAmount.toString(),
  };
  return result;
}

function splitHash(hash: string): string[] {
  if (hash.slice(0, 2) !== "0x" || (hash.length - 2) % 64 > 0) return [];

  hash = hash.slice(2);
  const numChunks = Math.ceil(hash.length / 64);
  const chunks = new Array(numChunks);

  for (let i = 0, o = 0; i < numChunks; ++i, o += 64) {
    chunks[i] = "0x" + hash.slice(o, o + 64);
  }
  return chunks;
}

function getAmountInAndOutFromReceipt(
  receipt: ContractTransactionReceipt
): bigint[] {
  const swapLogs = receipt.logs.filter(
    (l) => l.topics[0] === V3_SWAP_EVENT_SIGNATURE
  );
  const { data: swapData } = swapLogs[swapLogs.length - 1];
  // amount0, amount1, sqrtPriceX96, liquidity, tick
  const [amount0, amount1] = splitHash(swapData).map(BigInt);
  const [amountIn, amountOut] =
    amount0 > 0n ? [amount0, amount1] : [amount1, amount0];
  return [amountIn, ethers.MaxUint256 - amountOut + 1n];
}

function getAddLiquidityAmountFromReceipt(
  receipt: ContractTransactionReceipt
): bigint[] {
  const mintLogs = receipt.logs.filter(
    (l) => l.topics[0] === V3_MINT_EVENT_SIGNATURE
  );
  const { data: mintData } = mintLogs[mintLogs.length - 1];
  // amount0, amount1, sqrtPriceX96, liquidity, tick
  const [sender, amount, amount0, amount1] = splitHash(mintData).map(BigInt);
  return [amount0, amount1];
}

function getTokenIdFromReceipt(receipt: ContractTransactionReceipt): bigint {
  const tokenIdLog = receipt.logs.filter(
    (l) => l.topics[0] == INCREASE_EVENT_SIGNATURE
  );
  const tokenId = tokenIdLog[tokenIdLog.length - 1].topics[1];
  return BigInt(tokenId);
}

function getLeftTokensFromReceipt(receipt: ContractTransactionReceipt): {
  leftTokenAddress: string;
  leftTokenAmount: bigint;
} {
  // last Transfer event should be happened by sweepToken()
  const sweepTokenLog = receipt.logs[receipt.logs.length - 1];

  if (sweepTokenLog.topics[0] == TRANSFER_EVENT_SIGNATURE) {
    const leftTokenAddress = sweepTokenLog.address;
    const leftTokenAmount = BigInt(sweepTokenLog.data);

    return { leftTokenAddress, leftTokenAmount };
  }
  return { leftTokenAddress: "", leftTokenAmount: 0n };
}

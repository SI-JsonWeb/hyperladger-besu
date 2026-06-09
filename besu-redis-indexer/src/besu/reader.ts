import { ethers, JsonRpcProvider, WebSocketProvider, TransactionResponse } from 'ethers';
import { config } from '../config';

export interface BlockWithTxs {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  transactions: TransactionResponse[];
}

export async function createHttpProvider(): Promise<JsonRpcProvider> {
  return new ethers.JsonRpcProvider(config.RPC_HTTP_URL);
}

export async function createWsProvider(): Promise<WebSocketProvider> {
  return new ethers.WebSocketProvider(config.RPC_WS_URL);
}

export async function getBlockWithTxs(
  provider: JsonRpcProvider,
  blockNumber: number
): Promise<BlockWithTxs | null> {
  const block = await provider.getBlock(blockNumber, true);
  if (!block) return null;
  return {
    number: block.number,
    hash: block.hash ?? '',
    parentHash: block.parentHash ?? '',
    timestamp: Number(block.timestamp),
    transactions: (block.transactions as unknown as TransactionResponse[]) ?? [],
  };
}

export async function getTransactionReceipt(
  provider: JsonRpcProvider,
  txHash: string
) {
  return provider.getTransactionReceipt(txHash);
}

export async function getLogs(
  provider: JsonRpcProvider,
  address: string,
  fromBlock: number,
  toBlock: number
) {
  return provider.getLogs({ address, fromBlock, toBlock });
}

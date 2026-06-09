import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export interface BlockWithTxs {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  transactions: Transaction[];
}

export interface Transaction {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  gasLimit: bigint;
  data: string;
  index: number;
}

export interface DecodedEvent {
  chainId: number;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  txIndex: number;
  logIndex: number;
  assetId?: string;
  owner?: string;
  borrower?: string;
  lender?: string;
  account?: string;
  amountWei?: string;
  reason?: string;
  fileURI?: string;
  fileHash?: string;
}

export async function writeBlockDoc(
  client: RedisClient,
  chainId: number,
  block: BlockWithTxs
): Promise<void> {
  const key = `besu:block:${chainId}:${block.number}`;
  await client.hSet(key, {
    chainId: String(chainId),
    number: String(block.number),
    hash: block.hash ?? '',
    parentHash: block.parentHash ?? '',
    timestamp: String(block.timestamp),
    txCount: String(block.transactions.length),
    gasUsed: '0',
  });
}

export async function writeTxDoc(
  client: RedisClient,
  chainId: number,
  tx: Transaction,
  blockNumber: number,
  blockHash: string,
  txStatus: string = '1'
): Promise<void> {
  const key = `besu:tx:${chainId}:${tx.hash}`;
  await client.hSet(key, {
    chainId: String(chainId),
    hash: tx.hash,
    blockNumber: String(blockNumber),
    blockHash: blockHash,
    txIndex: String(tx.index),
    from: tx.from.toLowerCase(),
    to: (tx.to ?? '').toLowerCase(),
    status: txStatus,
    input4byte: tx.data.slice(0, 10),
    valueWei: tx.value.toString(),
    gasUsed: '0',
  });
}

export async function writeEventDoc(
  client: RedisClient,
  chainId: number,
  event: DecodedEvent
): Promise<void> {
  const key = `dfp:event:${chainId}:${event.blockNumber}:${event.txIndex}:${event.logIndex}`;
  const fields: Record<string, string> = {
    chainId: String(chainId),
    contractAddress: event.contractAddress,
    eventName: event.eventName,
    blockNumber: String(event.blockNumber),
    blockHash: event.blockHash,
    txHash: event.txHash,
    txIndex: String(event.txIndex),
    logIndex: String(event.logIndex),
  };

  if (event.assetId !== undefined) fields.assetId = event.assetId;
  if (event.owner !== undefined) fields.owner = event.owner;
  if (event.borrower !== undefined) fields.borrower = event.borrower;
  if (event.lender !== undefined) fields.lender = event.lender;
  if (event.account !== undefined) fields.account = event.account;
  if (event.amountWei !== undefined) fields.amountWei = event.amountWei;
  if (event.reason !== undefined) fields.reason = event.reason;
  if (event.fileURI !== undefined) fields.fileURI = event.fileURI;
  if (event.fileHash !== undefined) fields.fileHash = event.fileHash;

  await client.hSet(key, fields);
}

export async function writeCursor(
  client: RedisClient,
  chainId: number,
  blockNumber: number,
  blockHash: string
): Promise<void> {
  const key = `indexer:${chainId}:cursor`;
  await client.hSet(key, {
    lastBlockNumber: String(blockNumber),
    lastBlockHash: blockHash,
    updatedAt: new Date().toISOString(),
  });
}

export async function readCursor(
  client: RedisClient,
  chainId: number
): Promise<{ lastBlockNumber: number; lastBlockHash: string } | null> {
  const key = `indexer:${chainId}:cursor`;
  const data = await client.hGetAll(key);
  if (!data || Object.keys(data).length === 0) {
    return null;
  }
  return {
    lastBlockNumber: parseInt(data.lastBlockNumber, 10),
    lastBlockHash: data.lastBlockHash,
  };
}

export async function addBlockStream(
  client: RedisClient,
  chainId: number,
  blockNumber: number,
  docKey: string
): Promise<void> {
  const streamKey = `stream:besu:${chainId}:blocks`;
  await client.xAdd(streamKey, '*', {
    docKey,
    chainId: String(chainId),
    blockNumber: String(blockNumber),
  });
}

export async function addTxStream(
  client: RedisClient,
  chainId: number,
  txHash: string,
  docKey: string
): Promise<void> {
  const streamKey = `stream:besu:${chainId}:txs`;
  await client.xAdd(streamKey, '*', {
    docKey,
    chainId: String(chainId),
    txHash,
  });
}

export async function addEventStream(
  client: RedisClient,
  chainId: number,
  eventName: string,
  docKey: string
): Promise<void> {
  const streamKey = `stream:dfp:${chainId}:events`;
  await client.xAdd(streamKey, '*', {
    docKey,
    chainId: String(chainId),
    eventName,
  });
}

export async function deleteEventDoc(
  client: RedisClient,
  chainId: number,
  event: DecodedEvent
): Promise<void> {
  const key = `dfp:event:${chainId}:${event.blockNumber}:${event.txIndex}:${event.logIndex}`;
  await client.del(key);
}

export async function addRemovalStream(
  client: RedisClient,
  chainId: number,
  eventName: string,
  docKey: string
): Promise<void> {
  const streamKey = `stream:dfp:${chainId}:removals`;
  await client.xAdd(streamKey, '*', {
    docKey,
    chainId: String(chainId),
    eventName,
    removed: 'true',
  });
}

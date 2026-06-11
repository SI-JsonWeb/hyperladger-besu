import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { config } from '../config';
import { getBlockWithTxs, getTransactionReceipt, getLogs, BlockWithTxs } from '../besu/reader';
import {
  writeBlockDoc,
  writeTxDoc,
  writeEventDoc,
  writeCursor,
  readCursor,
  addBlockStream,
  addTxStream,
  addEventStream,
  deleteEventDoc,
  addRemovalStream,
  RedisClient,
  Transaction,
} from '../redis/writer';
import { parseEvents } from '../contracts/double-financing';
import {
  isFraudEventName,
  recordBlockProgress,
  writeProgressHead,
} from '../redis/progress';

export interface SingleFlightGuard {
  run<T>(fn: () => Promise<T>): Promise<void>;
}

export function createSingleFlightGuard(): SingleFlightGuard {
  let running = false;

  return {
    async run<T>(fn: () => Promise<T>): Promise<void> {
      if (running) return;
      running = true;
      try {
        await fn();
      } finally {
        running = false;
      }
    },
  };
}

async function processBlock(
  client: RedisClient,
  provider: JsonRpcProvider,
  block: BlockWithTxs,
  headBlockNumber: number
): Promise<void> {
  const chainId = config.CHAIN_ID;
  const blockKey = `besu:block:${chainId}:${block.number}`;
  const blockHash = block.hash ?? '';

  await writeBlockDoc(client, chainId, block);
  await addBlockStream(client, chainId, block.number, blockKey);

  for (const tx of block.transactions) {
    if (!tx.hash) continue;
    const txKey = `besu:tx:${chainId}:${tx.hash}`;
    const receipt = await getTransactionReceipt(provider, tx.hash);
    const txStatus = receipt?.status ? '1' : '0';
    const txDoc: Transaction = {
      hash: tx.hash,
      from: tx.from ?? '',
      to: tx.to ?? null,
      value: tx.value,
      gasLimit: tx.gasLimit,
      data: tx.data,
      index: tx.index,
    };
    await writeTxDoc(client, chainId, txDoc, block.number, blockHash, txStatus);
    await addTxStream(client, chainId, tx.hash, txKey);
  }

  const logs = await getLogs(provider, config.CONTRACT_ADDRESS, block.number, block.number);
  const events = parseEvents(logs);

  const currentEvents = events.filter((e) => !e.removed);
  const removedEvents = events.filter((e) => e.removed);

  for (const event of removedEvents) {
    const eventKey = `dfp:event:${chainId}:${event.blockNumber}:${event.txIndex}:${event.logIndex}`;
    await deleteEventDoc(client, chainId, event);
    await addRemovalStream(client, chainId, event.eventName, eventKey);
  }

  for (const event of currentEvents) {
    const eventKey = `dfp:event:${chainId}:${event.blockNumber}:${event.txIndex}:${event.logIndex}`;
    await writeEventDoc(client, chainId, event);
    await addEventStream(client, chainId, event.eventName, eventKey);
  }

  await writeCursor(client, chainId, block.number, blockHash);

  const eventNames = currentEvents.map((event) => event.eventName);
  const ts = new Date().toISOString();
  await recordBlockProgress(client, chainId, {
    blockNumber: block.number,
    headBlockNumber,
    txCount: block.transactions.length,
    eventNames,
    isFraud: eventNames.some(isFraudEventName),
    ts,
  });
}

export async function runCatchUp(
  client: RedisClient,
  provider: JsonRpcProvider
): Promise<void> {
  const chainId = config.CHAIN_ID;

  const cursor = await readCursor(client, chainId);
  const startBlock = cursor
    ? cursor.lastBlockNumber + 1
    : config.INDEX_BLOCKS_FROM_GENESIS
      ? 0
      : config.CONTRACT_START_BLOCK;

  const currentBlock = await provider.getBlockNumber();
  await writeProgressHead(client, chainId, currentBlock);

  if (startBlock > currentBlock) {
    return;
  }

  for (let blockNumber = startBlock; blockNumber <= currentBlock; blockNumber++) {
    const block = await getBlockWithTxs(provider, blockNumber);
    if (!block) continue;
    await processBlock(client, provider, block, currentBlock);
  }

  console.log(`catchup from ${startBlock} to ${currentBlock} complete`);
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export async function startWsSubscription(
  wsProvider: WebSocketProvider,
  client: RedisClient,
  httpProvider: JsonRpcProvider
): Promise<void> {
  const guard = createSingleFlightGuard();

  wsProvider.on('block', async (_blockNumber: number) => {
    await guard.run(() => runCatchUp(client, httpProvider));
  });
}

export function startHttpPolling(
  client: RedisClient,
  httpProvider: JsonRpcProvider,
  intervalMs: number
): void {
  const guard = createSingleFlightGuard();

  pollingInterval = setInterval(async () => {
    await guard.run(() => runCatchUp(client, httpProvider));
  }, intervalMs);
}

export function stopHttpPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

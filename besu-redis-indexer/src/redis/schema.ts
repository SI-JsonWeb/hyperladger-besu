import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

export async function ensureSchemas(client: RedisClient, chainId: number): Promise<void> {
  await createBlocksIndex(client, chainId);
  await createTxsIndex(client, chainId);
  await createEventsIndex(client, chainId);
}

async function createBlocksIndex(client: RedisClient, chainId: number): Promise<void> {
  const indexName = 'idx:besu_blocks';
  const prefix = `besu:block:${chainId}:`;

  try {
    await client.sendCommand([
      'FT.CREATE', indexName,
      'ON', 'HASH',
      'PREFIX', '1', prefix,
      'SCHEMA',
      'chainId', 'TAG',
      'number', 'NUMERIC', 'SORTABLE',
      'hash', 'TAG',
      'parentHash', 'TAG',
      'timestamp', 'NUMERIC', 'SORTABLE',
      'txCount', 'NUMERIC', 'SORTABLE',
      'gasUsed', 'TAG',
    ]);
    console.log(`Created index: ${indexName}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      console.log('schema already exists, skipping');
    } else {
      throw err;
    }
  }
}

async function createTxsIndex(client: RedisClient, chainId: number): Promise<void> {
  const indexName = 'idx:besu_txs';
  const prefix = `besu:tx:${chainId}:`;

  try {
    await client.sendCommand([
      'FT.CREATE', indexName,
      'ON', 'HASH',
      'PREFIX', '1', prefix,
      'SCHEMA',
      'chainId', 'TAG',
      'hash', 'TAG',
      'blockNumber', 'NUMERIC', 'SORTABLE',
      'blockHash', 'TAG',
      'txIndex', 'NUMERIC', 'SORTABLE',
      'from', 'TAG',
      'to', 'TAG',
      'status', 'TAG',
      'input4byte', 'TAG',
      'valueWei', 'TAG',
      'gasUsed', 'TAG',
    ]);
    console.log(`Created index: ${indexName}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      console.log('schema already exists, skipping');
    } else {
      throw err;
    }
  }
}

async function createEventsIndex(client: RedisClient, chainId: number): Promise<void> {
  const indexName = 'idx:dfp_events';
  const prefix = `dfp:event:${chainId}:`;

  try {
    await client.sendCommand([
      'FT.CREATE', indexName,
      'ON', 'HASH',
      'PREFIX', '1', prefix,
      'SCHEMA',
      'chainId', 'TAG',
      'contractAddress', 'TAG',
      'eventName', 'TAG',
      'blockNumber', 'NUMERIC', 'SORTABLE',
      'blockHash', 'TAG',
      'txHash', 'TAG',
      'txIndex', 'NUMERIC', 'SORTABLE',
      'logIndex', 'NUMERIC', 'SORTABLE',
      'assetId', 'TAG',
      'owner', 'TAG',
      'borrower', 'TAG',
      'lender', 'TAG',
      'account', 'TAG',
      'amountWei', 'TAG',
      'reason', 'TEXT',
      'fileURI', 'TEXT',
      'fileHash', 'TAG',
    ]);
    console.log(`Created index: ${indexName}`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already exists')) {
      console.log('schema already exists, skipping');
    } else {
      throw err;
    }
  }
}
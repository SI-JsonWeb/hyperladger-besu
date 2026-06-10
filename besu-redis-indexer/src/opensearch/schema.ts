import { OpenSearchClient } from './client';
import { SearchIndex, openSearchIndexName } from './index-names';

export async function ensureOpenSearchSchemas(
  client: OpenSearchClient,
  chainId: number,
  prefix: string
): Promise<void> {
  await ensureIndex(client, openSearchIndexName(prefix, 'blocks', chainId), blockMappings());
  await ensureIndex(client, openSearchIndexName(prefix, 'txs', chainId), txMappings());
  await ensureIndex(client, openSearchIndexName(prefix, 'events', chainId), eventMappings());
}

async function ensureIndex(
  client: OpenSearchClient,
  index: string,
  mappings: Record<string, unknown>
): Promise<void> {
  const exists = await client.indices.exists({ index });
  if (Boolean(exists.body)) {
    console.log(`OpenSearch index already exists, skipping: ${index}`);
    return;
  }

  await client.indices.create({
    index,
    body: {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      },
      mappings,
    },
  });
  console.log(`Created OpenSearch index: ${index}`);
}

function baseProperties(): Record<string, unknown> {
  return {
    chainId: { type: 'integer' },
  };
}

function keywordFields(fields: string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, { type: 'keyword' }]));
}

function textWithKeyword(): Record<string, unknown> {
  return {
    type: 'text',
    fields: {
      keyword: { type: 'keyword', ignore_above: 2048 },
    },
  };
}

function blockMappings(): Record<string, unknown> {
  return {
    dynamic: false,
    properties: {
      ...baseProperties(),
      number: { type: 'long' },
      ...keywordFields(['hash', 'parentHash', 'gasUsed']),
      timestamp: { type: 'long' },
      txCount: { type: 'integer' },
    },
  };
}

function txMappings(): Record<string, unknown> {
  return {
    dynamic: false,
    properties: {
      ...baseProperties(),
      ...keywordFields(['hash', 'blockHash', 'from', 'to', 'status', 'input4byte', 'valueWei', 'gasUsed']),
      blockNumber: { type: 'long' },
      txIndex: { type: 'integer' },
    },
  };
}

function eventMappings(): Record<string, unknown> {
  return {
    dynamic: false,
    properties: {
      ...baseProperties(),
      ...keywordFields([
        'contractAddress',
        'eventName',
        'blockHash',
        'txHash',
        'assetId',
        'owner',
        'borrower',
        'lender',
        'account',
        'amountWei',
        'fileHash',
      ]),
      blockNumber: { type: 'long' },
      txIndex: { type: 'integer' },
      logIndex: { type: 'integer' },
      reason: textWithKeyword(),
      fileURI: textWithKeyword(),
    },
  };
}

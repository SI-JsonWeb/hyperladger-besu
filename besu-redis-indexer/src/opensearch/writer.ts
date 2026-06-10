import { BlockWithTxs, DecodedEvent, Transaction } from '../redis/writer';
import { OpenSearchClient } from './client';
import { openSearchDocumentKey, openSearchIndexName } from './index-names';

export async function writeOpenSearchBlockDoc(
  client: OpenSearchClient,
  indexPrefix: string,
  chainId: number,
  block: BlockWithTxs
): Promise<void> {
  await client.index({
    index: openSearchIndexName(indexPrefix, 'blocks', chainId),
    id: openSearchDocumentKey('blocks', chainId, block.number),
    body: {
      chainId,
      number: block.number,
      hash: block.hash ?? '',
      parentHash: block.parentHash ?? '',
      timestamp: block.timestamp,
      txCount: block.transactions.length,
      gasUsed: '0',
    },
  });
}

export async function writeOpenSearchTxDoc(
  client: OpenSearchClient,
  indexPrefix: string,
  chainId: number,
  tx: Transaction,
  blockNumber: number,
  blockHash: string,
  txStatus: string = '1'
): Promise<void> {
  await client.index({
    index: openSearchIndexName(indexPrefix, 'txs', chainId),
    id: openSearchDocumentKey('txs', chainId, tx.hash),
    body: {
      chainId,
      hash: tx.hash,
      blockNumber,
      blockHash,
      txIndex: tx.index,
      from: tx.from.toLowerCase(),
      to: (tx.to ?? '').toLowerCase(),
      status: txStatus,
      input4byte: tx.data.slice(0, 10),
      valueWei: tx.value.toString(),
      gasUsed: '0',
    },
  });
}

export async function writeOpenSearchEventDoc(
  client: OpenSearchClient,
  indexPrefix: string,
  chainId: number,
  event: DecodedEvent
): Promise<void> {
  await client.index({
    index: openSearchIndexName(indexPrefix, 'events', chainId),
    id: openSearchEventDocId(chainId, event),
    body: {
      chainId,
      contractAddress: event.contractAddress,
      eventName: event.eventName,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      txHash: event.txHash,
      txIndex: event.txIndex,
      logIndex: event.logIndex,
      assetId: event.assetId,
      owner: event.owner,
      borrower: event.borrower,
      lender: event.lender,
      account: event.account,
      amountWei: event.amountWei,
      reason: event.reason,
      fileURI: event.fileURI,
      fileHash: event.fileHash,
    },
  });
}

export async function deleteOpenSearchEventDoc(
  client: OpenSearchClient,
  indexPrefix: string,
  chainId: number,
  event: DecodedEvent
): Promise<void> {
  try {
    await client.delete({
      index: openSearchIndexName(indexPrefix, 'events', chainId),
      id: openSearchEventDocId(chainId, event),
    });
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 404) {
      throw err;
    }
  }
}

function openSearchEventDocId(chainId: number, event: DecodedEvent): string {
  return openSearchDocumentKey('events', chainId, `${event.blockNumber}:${event.txIndex}:${event.logIndex}`);
}

export type SearchIndex = 'blocks' | 'txs' | 'events';

export function openSearchIndexName(prefix: string, index: SearchIndex, chainId: number): string {
  return `${prefix}-${index}-${chainId}`;
}

export function openSearchDocumentKey(index: SearchIndex, chainId: number, id: string | number): string {
  switch (index) {
    case 'blocks':
      return `besu:block:${chainId}:${id}`;
    case 'txs':
      return `besu:tx:${chainId}:${id}`;
    case 'events':
      return `dfp:event:${chainId}:${id}`;
  }
}

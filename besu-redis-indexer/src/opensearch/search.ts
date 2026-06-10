import { OpenSearchClient } from './client';
import { SearchIndex, openSearchIndexName } from './index-names';

const SEARCH_LIMIT = 20;
const EVENT_NAMES = new Set([
  'AssetRegistered',
  'FinancingRecorded',
  'LienReleased',
  'FraudAttemptDetected',
  'AccountFlagged',
  'FileRegistered',
]);
const EVENT_SEARCH_FIELDS = new Set([
  'eventName',
  'assetId',
  'owner',
  'borrower',
  'lender',
  'account',
  'txHash',
  'fileHash',
  'reason',
  'fileURI',
]);
const EVENT_TEXT_FIELDS = new Set(['reason', 'fileURI']);
const EVENT_SEARCH_FIELD_ALIASES: Record<string, string> = {
  event: 'eventName',
  eventname: 'eventName',
  asset: 'assetId',
  assetid: 'assetId',
  asset_id: 'assetId',
  owner: 'owner',
  borrower: 'borrower',
  borower: 'borrower',
  lender: 'lender',
  account: 'account',
  tx: 'txHash',
  txhash: 'txHash',
  tx_hash: 'txHash',
  file: 'fileURI',
  fileuri: 'fileURI',
  file_uri: 'fileURI',
  filehash: 'fileHash',
  file_hash: 'fileHash',
  reason: 'reason',
};

export interface SearchResult {
  key: string;
  fields: Record<string, string>;
}

export interface SearchResponse {
  query: string;
  index: SearchIndex;
  command: string;
  total: number;
  returned: number;
  results: SearchResult[];
}

export async function searchOpenSearch(
  client: OpenSearchClient,
  chainId: number,
  indexPrefix: string,
  index: SearchIndex,
  query: string
): Promise<SearchResponse> {
  const body = {
    size: SEARCH_LIMIT,
    query: buildQuery(index, query),
  };
  const response = await client.search({
    index: openSearchIndexName(indexPrefix, index, chainId),
    body,
  });
  const hits = parseHits(response.body);

  return {
    query,
    index,
    command: JSON.stringify(body, null, 2),
    total: hits.total,
    returned: hits.results.length,
    results: hits.results,
  };
}

function buildQuery(index: SearchIndex, query: string): Record<string, unknown> {
  if (index === 'blocks') return buildBlocksQuery(query);
  if (index === 'txs') return buildTxsQuery(query);
  return buildEventsQuery(query);
}

function buildBlocksQuery(query: string): Record<string, unknown> {
  const numeric = Number(query);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return { term: { number: numeric } };
  }

  return {
    bool: {
      should: [
        { term: { hash: query } },
        { term: { parentHash: query } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildTxsQuery(query: string): Record<string, unknown> {
  const normalized = query.toLowerCase();
  return {
    bool: {
      should: [
        { term: { hash: query } },
        { term: { from: normalized } },
        { term: { to: normalized } },
      ],
      minimum_should_match: 1,
    },
  };
}

function buildEventsQuery(query: string): Record<string, unknown> {
  const scoped = parseScopedEventQuery(query);
  if (scoped) {
    return scoped.isText
      ? { match_phrase_prefix: { [scoped.field]: scoped.value } }
      : { term: { [scoped.field]: normalizeExactValue(scoped.field, scoped.value) } };
  }

  if (EVENT_NAMES.has(query)) {
    return { term: { eventName: query } };
  }

  const exact = normalizeAddressLike(query);
  return {
    bool: {
      should: [
        { term: { eventName: query } },
        { term: { assetId: query } },
        { term: { owner: exact } },
        { term: { borrower: exact } },
        { term: { lender: exact } },
        { term: { account: exact } },
        { term: { txHash: query } },
        { term: { fileHash: query } },
        { match_phrase_prefix: { reason: query } },
        { match_phrase_prefix: { fileURI: query } },
      ],
      minimum_should_match: 1,
    },
  };
}

function parseScopedEventQuery(query: string): { field: string; value: string; isText: boolean } | null {
  const match = query.match(/^([A-Za-z][A-Za-z0-9_]*):(.*)$/);
  if (!match) return null;

  const [, field, rawValue] = match;
  const canonicalField = EVENT_SEARCH_FIELD_ALIASES[field.toLowerCase()] ?? field;
  const value = rawValue.trim();
  if (!EVENT_SEARCH_FIELDS.has(canonicalField) || !value) return null;

  return {
    field: canonicalField,
    value,
    isText: EVENT_TEXT_FIELDS.has(canonicalField),
  };
}

function normalizeExactValue(field: string, value: string): string {
  if (field === 'owner' || field === 'borrower' || field === 'lender' || field === 'account') {
    return normalizeAddressLike(value);
  }
  return value;
}

function normalizeAddressLike(value: string): string {
  return value.startsWith('0x') ? value.toLowerCase() : value;
}

function parseHits(raw: unknown): { total: number; results: SearchResult[] } {
  const body = raw as {
    hits?: {
      total?: number | { value?: number };
      hits?: Array<{ _id?: string; _source?: Record<string, unknown> }>;
    };
  };
  const total = typeof body.hits?.total === 'number'
    ? body.hits.total
    : body.hits?.total?.value ?? 0;
  const results = (body.hits?.hits ?? []).map((hit) => ({
    key: hit._id ?? '',
    fields: stringifyFields(hit._source ?? {}),
  }));
  return { total, results };
}

function stringifyFields(source: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) {
      fields[key] = String(value);
    }
  }
  return fields;
}

import http, { Server } from 'http';
import { createClient } from 'redis';
import { config } from '../config';
import { PROGRESS_CHANNEL, readProgressSnapshot } from './progress';
import { OpenSearchClient } from '../opensearch/client';
import { searchOpenSearch, SearchResponse, SearchResult } from '../opensearch/search';

type RedisClient = ReturnType<typeof createClient>;
type SearchIndex = 'blocks' | 'txs' | 'events';

const SEARCH_LIMIT = 20;
const SEARCH_INDEXES: Record<SearchIndex, string> = {
  blocks: 'idx:besu_blocks',
  txs: 'idx:besu_txs',
  events: 'idx:dfp_events',
};
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

interface RedisInfo {
  generatedAt: string;
  chainId: number;
  redis: {
    status: 'connected' | 'error';
    version: string;
    mode: string;
    uptime: string;
    usedMemory: string;
    connectedClients: string;
    totalCommands: string;
    keyspaceHits: string;
    keyspaceMisses: string;
    totalKeys: number | null;
  };
  indexes: Array<{ name: string; count: number | null }>;
  streams: Array<{ name: string; length: number | null }>;
  cursor: Record<string, string> | null;
  error?: string;
}

export function startRedisInfoServer(client: RedisClient, openSearchClient: OpenSearchClient | null): Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (url.pathname === '/') {
        const info = await collectRedisInfo(client);
        sendHtml(res, renderDashboard(info));
        return;
      }

      if (url.pathname === '/api/redis') {
        const info = await collectRedisInfo(client);
        sendJson(res, 200, info);
        return;
      }

      if (url.pathname === '/api/snapshot') {
        const snapshot = await readProgressSnapshot(client, config.CHAIN_ID);
        sendJson(res, 200, snapshot);
        return;
      }

      if (url.pathname === '/api/progress') {
        await streamProgress(client, req, res);
        return;
      }

      if (url.pathname === '/api/search') {
        const result = await searchDocuments(client, openSearchClient, url);
        sendJson(res, result.statusCode, result.body);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const info = createErrorInfo(message);

      if (url.pathname === '/') {
        sendHtml(res, renderDashboard(info), 503);
        return;
      }

      sendJson(res, 503, info);
    }
  });

  server.listen(config.REDIS_INFO_PORT, config.REDIS_INFO_HOST, () => {
    console.log(`redis info site listening on http://${config.REDIS_INFO_HOST}:${config.REDIS_INFO_PORT}`);
  });

  return server;
}

async function streamProgress(
  client: RedisClient,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n');

  const subscriber = client.duplicate();
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await subscriber.unsubscribe(PROGRESS_CHANNEL);
    } catch {
      // ignore unsubscribe errors during connection close
    }
    try {
      await subscriber.disconnect();
    } catch {
      // ignore disconnect errors during connection close
    }
  };

  req.on('close', () => {
    void close();
  });

  try {
    await subscriber.connect();
    await subscriber.subscribe(PROGRESS_CHANNEL, (message) => {
      res.write(`data: ${message}\n\n`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
    await close();
  }
}

export async function closeRedisInfoServer(server: Server | null): Promise<void> {
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function collectRedisInfo(client: RedisClient): Promise<RedisInfo> {
  const [serverInfo, memoryInfo, clientsInfo, statsInfo, totalKeys, cursor, indexes, streams] = await Promise.all([
    client.info('server'),
    client.info('memory'),
    client.info('clients'),
    client.info('stats'),
    client.dbSize(),
    readCursor(client),
    readIndexCounts(client),
    readStreamLengths(client),
  ]);

  const server = parseRedisInfo(serverInfo);
  const memory = parseRedisInfo(memoryInfo);
  const clients = parseRedisInfo(clientsInfo);
  const stats = parseRedisInfo(statsInfo);

  return {
    generatedAt: new Date().toISOString(),
    chainId: config.CHAIN_ID,
    redis: {
      status: 'connected',
      version: valueOrDash(server.redis_version),
      mode: valueOrDash(server.redis_mode),
      uptime: formatSeconds(server.uptime_in_seconds),
      usedMemory: valueOrDash(memory.used_memory_human),
      connectedClients: valueOrDash(clients.connected_clients),
      totalCommands: valueOrDash(stats.total_commands_processed),
      keyspaceHits: valueOrDash(stats.keyspace_hits),
      keyspaceMisses: valueOrDash(stats.keyspace_misses),
      totalKeys,
    },
    indexes,
    streams,
    cursor,
  };
}

async function searchDocuments(
  client: RedisClient,
  openSearchClient: OpenSearchClient | null,
  url: URL
): Promise<{ statusCode: number; body: SearchResponse | { error: string } }> {
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) {
    return { statusCode: 400, body: { error: 'query parameter "q" is required' } };
  }

  const index = parseSearchIndex(url.searchParams.get('index'));
  if (config.SEARCH_BACKEND === 'opensearch') {
    if (!openSearchClient) {
      return { statusCode: 503, body: { error: 'OpenSearch client is not available' } };
    }

    try {
      return {
        statusCode: 200,
        body: await searchOpenSearch(
          openSearchClient,
          config.CHAIN_ID,
          config.OPENSEARCH_INDEX_PREFIX,
          index,
          query
        ),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { statusCode: 503, body: { error: message } };
    }
  }

  return searchRedis(client, index, query);
}

async function searchRedis(
  client: RedisClient,
  index: SearchIndex,
  query: string
): Promise<{ statusCode: number; body: SearchResponse | { error: string } }> {
  try {
    if (index === 'txs') {
      return { statusCode: 200, body: await searchTransactions(client, query) };
    }

    const built = buildSearchCommand(index, query);
    const raw = await client.sendCommand(built.args);
    const parsed = parseSearchResult(raw);
    return {
      statusCode: 200,
      body: {
        query,
        index,
        command: built.display,
        total: parsed.total,
        returned: parsed.results.length,
        results: parsed.results,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { statusCode: 503, body: { error: message } };
  }
}

async function searchTransactions(client: RedisClient, query: string): Promise<SearchResponse> {
  const fields = ['hash', 'from', 'to'];
  const merged = new Map<string, SearchResult>();
  const commands: string[] = [];

  for (const field of fields) {
    const redisQuery = `@${field}:{${escapeTagValue(query)}}`;
    const args = ['FT.SEARCH', SEARCH_INDEXES.txs, redisQuery, 'LIMIT', '0', String(SEARCH_LIMIT)];
    commands.push(formatCommand(args));
    const parsed = parseSearchResult(await client.sendCommand(args));
    for (const result of parsed.results) {
      if (!merged.has(result.key)) {
        merged.set(result.key, result);
      }
      if (merged.size >= SEARCH_LIMIT) break;
    }
  }

  const results = Array.from(merged.values()).slice(0, SEARCH_LIMIT);
  return {
    query,
    index: 'txs',
    command: commands.join(' ; '),
    total: merged.size,
    returned: results.length,
    results,
  };
}

function buildSearchCommand(index: Exclude<SearchIndex, 'txs'>, query: string): { args: string[]; display: string } {
  const redisQuery = index === 'events'
    ? buildEventsQuery(query)
    : buildBlocksQuery(query);
  const args = ['FT.SEARCH', SEARCH_INDEXES[index], redisQuery, 'LIMIT', '0', String(SEARCH_LIMIT)];
  return { args, display: formatCommand(args) };
}

function buildEventsQuery(query: string): string {
  const scoped = parseScopedEventQuery(query);
  if (scoped) {
    const value = scoped.isText ? escapeTextValue(scoped.value) : escapeTagValue(scoped.value);
    return scoped.isText
      ? `@${scoped.field}:${value}*`
      : `@${scoped.field}:{${value}}`;
  }

  if (EVENT_NAMES.has(query)) {
    return `@eventName:{${escapeTagValue(query)}}`;
  }

  const tagValue = escapeTagValue(query);
  const textValue = escapeTextValue(query);
  return `(${[
    `@eventName:{${tagValue}}`,
    `@assetId:{${tagValue}}`,
    `@owner:{${tagValue}}`,
    `@borrower:{${tagValue}}`,
    `@lender:{${tagValue}}`,
    `@account:{${tagValue}}`,
    `@txHash:{${tagValue}}`,
    `@fileHash:{${tagValue}}`,
    `@reason:${textValue}*`,
    `@fileURI:${textValue}*`,
  ].join(' | ')})`;
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

function buildBlocksQuery(query: string): string {
  const numeric = Number(query);
  if (Number.isInteger(numeric) && numeric >= 0) {
    return `@number:[${numeric} ${numeric}]`;
  }

  const tagValue = escapeTagValue(query);
  return `(@hash:{${tagValue}} | @parentHash:{${tagValue}})`;
}

function parseSearchIndex(raw: string | null): SearchIndex {
  if (raw === 'blocks' || raw === 'txs' || raw === 'events') {
    return raw;
  }
  return 'events';
}

function parseSearchResult(raw: unknown): { total: number; results: SearchResult[] } {
  if (!Array.isArray(raw) || typeof raw[0] !== 'number') {
    return { total: 0, results: [] };
  }

  const results: SearchResult[] = [];
  for (let i = 1; i < raw.length; i += 2) {
    const key = raw[i];
    const fields = raw[i + 1];
    if (typeof key !== 'string') continue;
    results.push({ key, fields: parseSearchFields(fields) });
  }

  return { total: raw[0], results };
}

function parseSearchFields(raw: unknown): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!Array.isArray(raw)) return parsed;

  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i];
    const value = raw[i + 1];
    if (typeof key === 'string') {
      parsed[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  return parsed;
}

function escapeTagValue(value: string): string {
  return value.replace(/([\\{}[\]|,.<>:"';!@#$%^&*()\-+=~ ])/g, '\\$1');
}

function escapeTextValue(value: string): string {
  return value.replace(/([\\@{}[\]()"':;,.<>~*?+|=&!%-])/g, '\\$1');
}

function formatCommand(args: string[]): string {
  return args.join(' ');
}

function createErrorInfo(message: string): RedisInfo {
  return {
    generatedAt: new Date().toISOString(),
    chainId: config.CHAIN_ID,
    redis: {
      status: 'error',
      version: '-',
      mode: '-',
      uptime: '-',
      usedMemory: '-',
      connectedClients: '-',
      totalCommands: '-',
      keyspaceHits: '-',
      keyspaceMisses: '-',
      totalKeys: null,
    },
    indexes: [],
    streams: [],
    cursor: null,
    error: message,
  };
}

async function readCursor(client: RedisClient): Promise<Record<string, string> | null> {
  const cursor = await client.hGetAll(`indexer:${config.CHAIN_ID}:cursor`);
  return Object.keys(cursor).length > 0 ? cursor : null;
}

async function readIndexCounts(client: RedisClient): Promise<Array<{ name: string; count: number | null }>> {
  const names = ['idx:besu_blocks', 'idx:besu_txs', 'idx:dfp_events'];
  return Promise.all(names.map(async (name) => ({ name, count: await readIndexCount(client, name) })));
}

async function readIndexCount(client: RedisClient, name: string): Promise<number | null> {
  try {
    const result = await client.sendCommand(['FT.SEARCH', name, '*', 'LIMIT', '0', '0']);
    if (Array.isArray(result) && typeof result[0] === 'number') {
      return result[0];
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`unable to read ${name} count: ${message}`);
    return null;
  }
}

async function readStreamLengths(client: RedisClient): Promise<Array<{ name: string; length: number | null }>> {
  const names = [
    `stream:besu:${config.CHAIN_ID}:blocks`,
    `stream:besu:${config.CHAIN_ID}:txs`,
    `stream:dfp:${config.CHAIN_ID}:events`,
  ];

  return Promise.all(names.map(async (name) => {
    try {
      return { name, length: await client.xLen(name) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`unable to read ${name} length: ${message}`);
      return { name, length: null };
    }
  }));
}

function parseRedisInfo(info: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of info.split('\r\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    parsed[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return parsed;
}

function formatSeconds(raw: string | undefined): string {
  const seconds = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(seconds)) return '-';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function valueOrDash(value: string | undefined): string {
  return value ?? '-';
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res: http.ServerResponse, html: string, statusCode = 200): void {
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderDashboard(info: RedisInfo): string {
  const initialInfoJson = serializeForScript(info);
  const searchBackendLabel = config.SEARCH_BACKEND === 'opensearch' ? 'OpenSearch' : 'Redis Search';
  const indexRows = info.indexes
    .map((index) => `<tr><th>${escapeHtml(index.name)}</th><td>${formatNullable(index.count)}</td></tr>`)
    .join('');
  const streamRows = info.streams
    .map((stream) => `<tr><th>${escapeHtml(stream.name)}</th><td>${formatNullable(stream.length)}</td></tr>`)
    .join('');
  const cursorRows = renderCursorRows(info.cursor);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Besu Redis Indexer</title>
  <style>
    :root {
      --bg: #f5f7fa;
      --panel: #ffffff;
      --panel-strong: #eef2f7;
      --text: #17202a;
      --muted: #64748b;
      --line: #d9e1ea;
      --accent: #0f766e;
      --accent-soft: #d9f4ef;
      --warn: #b45309;
      --warn-soft: #fff4d6;
      --danger: #b42318;
      --danger-soft: #fee4e2;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      padding: 24px;
    }

    main { max-width: 1240px; margin: 0 auto; }
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .subtle {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 11px;
      background: var(--panel);
      color: var(--muted);
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${info.redis.status === 'connected' ? 'var(--accent)' : 'var(--danger)'};
    }

    .dot.live { background: var(--accent); }
    .dot.warn { background: var(--warn); }
    .dot.error { background: var(--danger); }
    .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .panel, .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }

    .panel { margin-top: 16px; overflow: hidden; }
    .panel h2 {
      margin: 0;
      padding: 14px 16px;
      background: var(--panel-strong);
      border-bottom: 1px solid var(--line);
      font-size: 15px;
      line-height: 1.3;
    }

    .card { padding: 16px; min-height: 104px; }
    .card.danger { border-color: #f2b8b5; background: #fffafa; }
    .label {
      color: var(--muted);
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
    }

    .value {
      margin-top: 14px;
      font-size: 28px;
      font-weight: 750;
      line-height: 1;
      letter-spacing: 0;
      word-break: break-word;
    }

    .small { font-size: 17px; }
    .wide { grid-column: span 2; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 16px; border-top: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { width: 44%; color: var(--muted); font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0; }
    td { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #243447; word-break: break-word; }
    .error-box { margin: 0 0 16px; padding: 12px 14px; border: 1px solid #f2b8b5; border-radius: 8px; background: var(--danger-soft); color: var(--danger); }
    .search-body { padding: 16px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .tab-button {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      cursor: pointer;
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 8px 12px;
    }
    .tab-button.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .search-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    .search-input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      font: 14px ui-sans-serif, system-ui, sans-serif;
      padding: 11px 12px;
    }
    .search-button {
      border: 1px solid var(--accent);
      border-radius: 8px;
      background: var(--accent);
      color: #ffffff;
      cursor: pointer;
      font: 750 13px ui-sans-serif, system-ui, sans-serif;
      padding: 0 16px;
    }
    .event-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .event-preset, .field-chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #ffffff;
      color: #334155;
      cursor: pointer;
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      padding: 7px 10px;
    }
    .event-preset:hover { border-color: var(--accent); color: var(--accent); }
    .event-preset.fraud { border-color: #f2b8b5; color: var(--danger); background: #fffafa; }
    .field-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }
    .field-chip {
      background: #f8fafc;
    }
    .field-chip:hover, .field-chip.active {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
    }
    .search-hint {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .search-hint code {
      color: #243447;
      font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .command {
      display: none;
      margin: 12px 0 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #f8fafc;
      color: var(--muted);
      font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
      padding: 10px 12px;
    }
    .search-message { margin-top: 12px; color: var(--muted); font-size: 13px; }
    .search-message.error { color: var(--danger); }
    .results-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .result-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
      padding: 14px;
      min-width: 0;
    }
    .result-card.fraud { border-color: #f2b8b5; background: #fffafa; }
    .result-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 18px; font-weight: 750; line-height: 1.25; overflow-wrap: anywhere; }
    .result-title span:first-child { min-width: 0; overflow-wrap: anywhere; }
    .badge { border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 750 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 4px 7px; white-space: nowrap; }
    .badge.danger { background: var(--danger-soft); color: var(--danger); }
    .result-fields { display: grid; gap: 8px; margin-top: 12px; }
    .result-row { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; font-size: 13px; }
    .result-row span:first-child { color: var(--muted); font: 700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .result-row span:last-child { overflow-wrap: anywhere; }
    .activity { list-style: none; margin: 0; padding: 0; }
    .activity li { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 12px; padding: 13px 16px; border-top: 1px solid var(--line); align-items: center; }
    .activity li:first-child { border-top: 0; }
    .activity li.fraud { background: var(--danger-soft); }
    .block-number { font: 750 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .event-list { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .meta { color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
    .footer { margin-top: 14px; color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

    @media (max-width: 980px) {
      .layout, .topbar { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 620px) {
      body { padding: 14px; }
      .grid { grid-template-columns: 1fr; }
      .search-form, .results-grid { grid-template-columns: 1fr; }
      .search-button { min-height: 42px; }
      .wide { grid-column: auto; }
      .activity li { grid-template-columns: 1fr; gap: 6px; }
      .meta { white-space: normal; }
    }
  </style>
</head>
<body>
  <main>
    <section class="topbar">
      <div>
        <h1>Besu Redis Indexer</h1>
        <div class="subtle">Chain ${info.chainId} - generated <span id="generated-at">${escapeHtml(info.generatedAt)}</span></div>
      </div>
      <div class="pill"><span class="dot"></span>Redis <span id="redis-status">${escapeHtml(info.redis.status)}</span></div>
      <div class="pill"><span id="sse-dot" class="dot warn"></span><span id="sse-status">connecting</span></div>
    </section>

    ${info.error ? `<p class="error-box">${escapeHtml(info.error)}</p>` : ''}

    <section class="grid">
      <article class="card"><div class="label">Head block</div><div id="head-block" class="value">-</div></article>
      <article class="card"><div class="label">Indexed block</div><div id="indexed-block" class="value">-</div></article>
      <article class="card"><div class="label">Lag</div><div id="lag" class="value">-</div></article>
      <article class="card danger"><div class="label">Fraud detected</div><div id="fraud-detected" class="value">0</div></article>
      <article class="card"><div class="label">Blocks indexed</div><div id="blocks-indexed" class="value">0</div></article>
      <article class="card"><div class="label">Transactions</div><div id="txs-indexed" class="value">0</div></article>
      <article class="card"><div class="label">Events</div><div id="events-indexed" class="value">0</div></article>
      <article class="card"><div class="label">Last block at</div><div id="last-block-at" class="value small">-</div></article>
    </section>

    <section class="panel">
      <h2>${searchBackendLabel}</h2>
      <div class="search-body">
        <div class="tabs" role="tablist" aria-label="Search index">
          <button class="tab-button" type="button" data-search-index="blocks">Blocks</button>
          <button class="tab-button" type="button" data-search-index="txs">Transactions</button>
          <button class="tab-button active" type="button" data-search-index="events">Events</button>
        </div>
        <form id="search-form" class="search-form">
          <input id="search-input" class="search-input" name="q" type="search" placeholder="Search events by assetId, owner, borrower, lender..." autocomplete="off">
          <button class="search-button" type="submit">Search</button>
        </form>
        <div id="event-presets" class="event-presets" aria-label="Predefined events">
          <button class="event-preset" type="button" data-event-name="AssetRegistered">AssetRegistered</button>
          <button class="event-preset" type="button" data-event-name="FinancingRecorded">FinancingRecorded</button>
          <button class="event-preset" type="button" data-event-name="LienReleased">LienReleased</button>
          <button class="event-preset fraud" type="button" data-event-name="FraudAttemptDetected">FraudAttemptDetected</button>
          <button class="event-preset fraud" type="button" data-event-name="AccountFlagged">AccountFlagged</button>
          <button class="event-preset" type="button" data-event-name="FileRegistered">FileRegistered</button>
        </div>
        <div id="field-filters" class="field-filters" aria-label="Event field filters">
          <button class="field-chip" type="button" data-event-field="assetId">assetId</button>
          <button class="field-chip" type="button" data-event-field="owner">owner</button>
          <button class="field-chip" type="button" data-event-field="borrower">borrower</button>
          <button class="field-chip" type="button" data-event-field="lender">lender</button>
          <button class="field-chip" type="button" data-event-field="account">account</button>
          <button class="field-chip" type="button" data-event-field="txHash">txHash</button>
        </div>
        <div id="search-hint" class="search-hint">Use a field prefix for exact event searches, for example <code>assetId:1</code>, <code>owner:0x...</code>, <code>borrower:0x...</code>, or <code>lender:0x...</code>.</div>
        <pre id="search-command" class="command"></pre>
        <div id="search-message" class="search-message">Enter a query to search ${searchBackendLabel}.</div>
        <div id="search-results" class="results-grid"></div>
      </div>
    </section>

    <section class="layout">
      <div>
        <section class="panel">
          <h2>Recent Activity</h2>
          <ul id="activity" class="activity"><li><span class="event-list">No indexed blocks yet.</span></li></ul>
        </section>

        <section class="panel">
          <h2>Indexer Cursor</h2>
          <table><tbody id="cursor-rows">${cursorRows}</tbody></table>
        </section>
      </div>

      <div>
        <section class="panel">
          <h2>Redis</h2>
          <table><tbody>
            <tr><th>Version</th><td>${escapeHtml(info.redis.version)}</td></tr>
            <tr><th>Keys</th><td>${formatNullable(info.redis.totalKeys)}</td></tr>
            <tr><th>Memory</th><td>${escapeHtml(info.redis.usedMemory)}</td></tr>
            <tr><th>Uptime</th><td>${escapeHtml(info.redis.uptime)}</td></tr>
            <tr><th>Commands</th><td>${escapeHtml(info.redis.totalCommands)}</td></tr>
            <tr><th>Clients</th><td>${escapeHtml(info.redis.connectedClients)}</td></tr>
          </tbody></table>
        </section>

        <section class="panel">
          <h2>Indexes</h2>
          <table><tbody>${indexRows}</tbody></table>
        </section>

        <section class="panel">
          <h2>Streams</h2>
          <table><tbody>${streamRows}</tbody></table>
        </section>
      </div>
    </section>

    <p class="footer">JSON endpoints: <code>/api/redis</code>, <code>/api/snapshot</code>, <code>/api/progress</code>.</p>
  </main>
  <script>
    const initialInfo = ${initialInfoJson};
    const fraudEventNames = new Set(['FraudAttemptDetected', 'AccountFlagged']);
    const searchPlaceholders = {
      blocks: 'Search by block number, hash...',
      txs: 'Search by tx hash, from/to address...',
      events: 'Search events by assetId, owner, borrower, lender...'
    };
    let activeSearchIndex = 'events';
    let snapshotState = null;
    let recentState = [];

    function setText(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    function formatNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '-';
    }

    function parseNumber(value) {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function countFraud(eventNames) {
      return eventNames.filter((name) => fraudEventNames.has(name)).length;
    }

    function renderSnapshot(snapshot) {
      snapshotState = snapshot;
      recentState = Array.isArray(snapshot.recent) ? snapshot.recent.slice(0, 50) : [];

      const headBlock = parseNumber(snapshot.head && snapshot.head.blockNumber);
      const cursorBlock = parseNumber(snapshot.cursor && snapshot.cursor.lastBlockNumber);
      setText('head-block', formatNumber(headBlock));
      setText('indexed-block', formatNumber(cursorBlock));
      setText('lag', headBlock !== null && cursorBlock !== null ? formatNumber(Math.max(headBlock - cursorBlock, 0)) : '-');
      setText('blocks-indexed', formatNumber(snapshot.stats.blocksIndexed));
      setText('txs-indexed', formatNumber(snapshot.stats.txsIndexed));
      setText('events-indexed', formatNumber(snapshot.stats.eventsIndexed));
      setText('fraud-detected', formatNumber(snapshot.stats.fraudDetected));
      setText('last-block-at', snapshot.stats.lastBlockAt || '-');
      renderCursor(snapshot.cursor);
      renderActivity();
    }

    function renderCursor(cursor) {
      const tbody = document.getElementById('cursor-rows');
      if (!tbody) return;
      tbody.textContent = '';
      if (!cursor || Object.keys(cursor).length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 2;
        cell.textContent = 'No cursor has been written yet.';
        row.appendChild(cell);
        tbody.appendChild(row);
        return;
      }

      for (const [key, value] of Object.entries(cursor)) {
        const row = document.createElement('tr');
        const th = document.createElement('th');
        const td = document.createElement('td');
        th.textContent = key;
        td.textContent = String(value);
        row.append(th, td);
        tbody.appendChild(row);
      }
    }

    function renderActivity() {
      const list = document.getElementById('activity');
      if (!list) return;
      list.textContent = '';
      if (recentState.length === 0) {
        const item = document.createElement('li');
        const text = document.createElement('span');
        text.className = 'event-list';
        text.textContent = 'No indexed blocks yet.';
        item.appendChild(text);
        list.appendChild(item);
        return;
      }

      for (const event of recentState.slice(0, 50)) {
        list.appendChild(createActivityItem(event));
      }
    }

    function createActivityItem(event) {
      const item = document.createElement('li');
      if (event.isFraud) item.className = 'fraud';

      const block = document.createElement('span');
      block.className = 'block-number';
      block.textContent = '#' + formatNumber(event.blockNumber);

      const details = document.createElement('span');
      details.className = 'event-list';
      const events = event.eventNames && event.eventNames.length > 0 ? event.eventNames.join(', ') : 'no contract events';
      details.textContent = formatNumber(event.txCount) + ' tx - ' + events;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = event.ts || '-';

      item.append(block, details, meta);
      return item;
    }

    function applyProgress(event) {
      if (!snapshotState) {
        snapshotState = {
          head: { blockNumber: null, timestamp: null },
          cursor: null,
          stats: { blocksIndexed: 0, txsIndexed: 0, eventsIndexed: 0, fraudDetected: 0, lastBlockAt: null },
          recent: []
        };
      }

      snapshotState.stats.blocksIndexed += 1;
      snapshotState.stats.txsIndexed += event.txCount;
      snapshotState.stats.eventsIndexed += event.eventNames.length;
      snapshotState.stats.fraudDetected += countFraud(event.eventNames);
      snapshotState.stats.lastBlockAt = event.ts;
      const currentHeadBlock = parseNumber(snapshotState.head && snapshotState.head.blockNumber);
      const eventHeadBlock = parseNumber(event.headBlockNumber);
      const nextHeadBlock = eventHeadBlock !== null
        ? eventHeadBlock
        : currentHeadBlock !== null
          ? Math.max(currentHeadBlock, event.blockNumber)
          : event.blockNumber;
      snapshotState.head = {
        blockNumber: nextHeadBlock,
        timestamp: event.ts
      };
      snapshotState.cursor = Object.assign({}, snapshotState.cursor || {}, {
        lastBlockNumber: String(event.blockNumber),
        updatedAt: event.ts
      });

      recentState = [event].concat(recentState.filter((item) => item.blockNumber !== event.blockNumber)).slice(0, 50);
      renderSnapshot(Object.assign({}, snapshotState, { recent: recentState }));
    }

    async function loadSnapshot() {
      const response = await fetch('/api/snapshot', { cache: 'no-store' });
      if (!response.ok) throw new Error('snapshot request failed with HTTP ' + response.status);
      renderSnapshot(await response.json());
    }

    function setSseStatus(status, className) {
      setText('sse-status', status);
      const dot = document.getElementById('sse-dot');
      if (dot) dot.className = 'dot ' + className;
    }

    function connectProgressStream() {
      const events = new EventSource('/api/progress');
      events.onopen = () => setSseStatus('live', 'live');
      events.onerror = () => setSseStatus('reconnecting', 'warn');
      events.onmessage = (message) => {
        try {
          applyProgress(JSON.parse(message.data));
        } catch (err) {
          console.warn('unable to parse progress event', err);
        }
      };
    }

    function setupSearch() {
      const tabs = Array.from(document.querySelectorAll('[data-search-index]'));
      const eventPresets = Array.from(document.querySelectorAll('[data-event-name]'));
      const fieldChips = Array.from(document.querySelectorAll('[data-event-field]'));
      const eventPresetWrap = document.getElementById('event-presets');
      const fieldFilterWrap = document.getElementById('field-filters');
      const searchHint = document.getElementById('search-hint');
      const input = document.getElementById('search-input');
      const form = document.getElementById('search-form');
      if (!input || !form) return;

      const syncEventPresets = () => {
        const isEventSearch = activeSearchIndex === 'events';
        if (eventPresetWrap) {
          eventPresetWrap.style.display = isEventSearch ? 'flex' : 'none';
        }
        if (fieldFilterWrap) {
          fieldFilterWrap.style.display = isEventSearch ? 'flex' : 'none';
        }
        if (searchHint) {
          searchHint.style.display = isEventSearch ? 'block' : 'none';
        }
      };

      for (const tab of tabs) {
        tab.addEventListener('click', () => {
          activeSearchIndex = tab.getAttribute('data-search-index') || 'events';
          for (const button of tabs) {
            button.classList.toggle('active', button === tab);
          }
          input.placeholder = searchPlaceholders[activeSearchIndex] || searchPlaceholders.events;
          syncEventPresets();
          clearSearch(false);
        });
      }

      for (const preset of eventPresets) {
        preset.addEventListener('click', () => {
          const eventName = preset.getAttribute('data-event-name') || '';
          activeSearchIndex = 'events';
          for (const button of tabs) {
            button.classList.toggle('active', button.getAttribute('data-search-index') === 'events');
          }
          input.placeholder = searchPlaceholders.events;
          input.value = eventName;
          syncEventPresets();
          void runSearch(eventName);
        });
      }

      for (const chip of fieldChips) {
        chip.addEventListener('click', () => {
          const fieldName = chip.getAttribute('data-event-field') || '';
          activeSearchIndex = 'events';
          for (const button of tabs) {
            button.classList.toggle('active', button.getAttribute('data-search-index') === 'events');
          }
          for (const button of fieldChips) {
            button.classList.toggle('active', button === chip);
          }
          input.placeholder = fieldName + ':value';
          input.value = fieldName + ':';
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          syncEventPresets();
          clearSearch(false);
        });
      }

      input.addEventListener('input', () => {
        const fieldName = input.value.split(':', 1)[0];
        for (const button of fieldChips) {
          button.classList.toggle('active', button.getAttribute('data-event-field') === fieldName);
        }
      });

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void runSearch(input.value);
      });

      syncEventPresets();
    }

    function clearSearch(clearInput) {
      const command = document.getElementById('search-command');
      const results = document.getElementById('search-results');
      if (command) {
        command.style.display = 'none';
        command.textContent = '';
      }
      if (results) results.textContent = '';
      setSearchMessage('Enter a query to search ${searchBackendLabel}.');
      if (clearInput) {
        const input = document.getElementById('search-input');
        if (input) input.value = '';
      }
    }

    async function runSearch(rawQuery) {
      const query = rawQuery.trim();
      if (!query) {
        clearSearch(false);
        setSearchMessage('Enter a query to search ${searchBackendLabel}.');
        return;
      }

      setSearchMessage('Searching...');
      const command = document.getElementById('search-command');
      const results = document.getElementById('search-results');
      if (results) results.textContent = '';
      if (command) {
        command.style.display = 'none';
        command.textContent = '';
      }

      try {
        const params = new URLSearchParams({ q: query, index: activeSearchIndex });
        const response = await fetch('/api/search?' + params.toString(), { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'search request failed with HTTP ' + response.status);
        }
        renderSearchResponse(payload);
      } catch (err) {
        setSearchMessage(err instanceof Error ? err.message : String(err), true);
      }
    }

    function renderSearchResponse(payload) {
      const command = document.getElementById('search-command');
      const results = document.getElementById('search-results');
      if (command) {
        command.style.display = 'block';
        command.textContent = payload.command || '';
      }
      if (!results) return;
      results.textContent = '';

      if (!payload.results || payload.results.length === 0) {
        setSearchMessage("No results for '" + payload.query + "' in index '" + payload.index + "'");
        return;
      }

      setSearchMessage(payload.returned + ' of ' + payload.total + ' result(s)');
      for (const result of payload.results) {
        results.appendChild(createResultCard(payload.index, result));
      }
    }

    function setSearchMessage(message, isError = false) {
      const el = document.getElementById('search-message');
      if (!el) return;
      el.textContent = message;
      el.className = isError ? 'search-message error' : 'search-message';
    }

    function createResultCard(index, result) {
      if (index === 'blocks') return createBlockCard(result);
      if (index === 'txs') return createTxCard(result);
      return createEventCard(result);
    }

    function createEventCard(result) {
      const fields = result.fields || {};
      const isFraud = fraudEventNames.has(fields.eventName);
      const card = createBaseResultCard(fields.eventName || result.key, isFraud ? 'FRAUD' : null);
      if (isFraud) card.classList.add('fraud');
      const rows = [
        ['block', fields.blockNumber],
        ['tx', fields.txHash],
      ];

      switch (fields.eventName) {
        case 'FraudAttemptDetected':
        case 'AccountFlagged':
          rows.push(['assetId', fields.assetId]);
          rows.push(['account', fields.account]);
          rows.push(['reason', fields.reason]);
          break;
        case 'FinancingRecorded':
          rows.push(['assetId', fields.assetId]);
          rows.push(['borrower', fields.borrower]);
          rows.push(['lender', fields.lender]);
          rows.push(['amountWei', fields.amountWei]);
          break;
        case 'AssetRegistered':
          rows.push(['assetId', fields.assetId]);
          rows.push(['owner', fields.owner]);
          break;
        case 'LienReleased':
          rows.push(['assetId', fields.assetId]);
          break;
        case 'FileRegistered':
          rows.push(['fileURI', fields.fileURI]);
          rows.push(['fileHash', fields.fileHash]);
          break;
        default:
          rows.push(['assetId', fields.assetId]);
          rows.push(['owner', fields.owner]);
          rows.push(['borrower', fields.borrower]);
          rows.push(['lender', fields.lender]);
          rows.push(['account', fields.account]);
          rows.push(['key', result.key]);
      }

      appendResultRows(card, rows);
      return card;
    }

    function createBlockCard(result) {
      const fields = result.fields || {};
      const card = createBaseResultCard('#' + (fields.number || result.key), null);
      const timestamp = parseNumber(fields.timestamp);
      appendResultRows(card, [
        ['timestamp', timestamp === null ? '-' : new Date(timestamp * 1000).toLocaleString()],
        ['txCount', fields.txCount],
        ['hash', fields.hash],
      ]);
      return card;
    }

    function createTxCard(result) {
      const fields = result.fields || {};
      const status = fields.status === '0' ? 'failed' : 'success';
      const card = createBaseResultCard(fields.hash || result.key, status);
      const badge = card.querySelector('.badge');
      if (badge && status === 'failed') badge.classList.add('danger');
      appendResultRows(card, [
        ['from', fields.from],
        ['to', fields.to],
        ['valueWei', fields.valueWei],
        ['block', fields.blockNumber],
      ]);
      return card;
    }

    function createBaseResultCard(title, badgeText) {
      const card = document.createElement('article');
      card.className = 'result-card';
      const heading = document.createElement('div');
      heading.className = 'result-title';
      const text = document.createElement('span');
      text.textContent = title || '-';
      heading.appendChild(text);
      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = badgeText === 'FRAUD' ? 'badge danger' : 'badge';
        badge.textContent = badgeText;
        heading.appendChild(badge);
      }
      card.appendChild(heading);
      return card;
    }

    function appendResultRows(card, rows) {
      const wrap = document.createElement('div');
      wrap.className = 'result-fields';
      for (const [label, value] of rows) {
        if (value === undefined || value === null || value === '') continue;
        const row = document.createElement('div');
        row.className = 'result-row';
        const labelEl = document.createElement('span');
        const valueEl = document.createElement('span');
        labelEl.textContent = label;
        valueEl.textContent = String(value);
        row.append(labelEl, valueEl);
        wrap.appendChild(row);
      }
      card.appendChild(wrap);
    }

    setText('redis-status', initialInfo.redis.status);
    setupSearch();
    loadSnapshot()
      .catch((err) => {
        setSseStatus('snapshot error', 'error');
        console.error(err);
      })
      .finally(connectProgressStream);
  </script>
</body>
</html>`;
}

function renderCursorRows(cursor: Record<string, string> | null): string {
  return cursor
    ? Object.entries(cursor).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')
    : '<tr><td colspan="2">No cursor has been written yet.</td></tr>';
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function formatNullable(value: number | null): string {
  return value === null ? '-' : value.toLocaleString('en-US');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

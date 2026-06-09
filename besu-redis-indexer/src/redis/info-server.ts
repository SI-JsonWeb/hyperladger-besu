import http, { Server } from 'http';
import { createClient } from 'redis';
import { config } from '../config';
import { PROGRESS_CHANNEL, readProgressSnapshot } from './progress';

type RedisClient = ReturnType<typeof createClient>;

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

export function startRedisInfoServer(client: RedisClient): Server {
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

    setText('redis-status', initialInfo.redis.status);
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

import { RedisClient } from './writer';

export const PROGRESS_CHANNEL = 'indexer:progress';

const FRAUD_EVENT_NAMES = new Set(['FraudAttemptDetected', 'AccountFlagged']);

export interface ProgressPayload {
  blockNumber: number;
  txCount: number;
  eventNames: string[];
  isFraud: boolean;
  ts: string;
}

export interface ProgressStats {
  blocksIndexed: number;
  txsIndexed: number;
  eventsIndexed: number;
  fraudDetected: number;
  lastBlockAt: string | null;
}

export interface ProgressHead {
  blockNumber: number | null;
  timestamp: string | null;
}

export interface ProgressSnapshot {
  head: ProgressHead;
  cursor: Record<string, string> | null;
  stats: ProgressStats;
  recent: ProgressPayload[];
}

function key(chainId: number, suffix: string): string {
  return `indexer:${chainId}:${suffix}`;
}

export function isFraudEventName(eventName: string): boolean {
  return FRAUD_EVENT_NAMES.has(eventName);
}

export async function writeProgressHead(
  client: RedisClient,
  chainId: number,
  blockNumber: number
): Promise<void> {
  await client.hSet(key(chainId, 'head'), {
    blockNumber: String(blockNumber),
    timestamp: new Date().toISOString(),
  });
}

export async function recordBlockProgress(
  client: RedisClient,
  chainId: number,
  payload: ProgressPayload
): Promise<void> {
  const statsKey = key(chainId, 'stats');
  const recentKey = key(chainId, 'recent');
  const fraudCount = payload.eventNames.filter(isFraudEventName).length;

  await client.hIncrBy(statsKey, 'blocksIndexed', 1);
  await client.hIncrBy(statsKey, 'txsIndexed', payload.txCount);
  await client.hIncrBy(statsKey, 'eventsIndexed', payload.eventNames.length);
  if (fraudCount > 0) {
    await client.hIncrBy(statsKey, 'fraudDetected', fraudCount);
  }
  await client.hSet(statsKey, { lastBlockAt: payload.ts });

  const message = JSON.stringify(payload);
  await client.lPush(recentKey, message);
  await client.lTrim(recentKey, 0, 49);
  await client.publish(PROGRESS_CHANNEL, message);
}

export async function readProgressSnapshot(
  client: RedisClient,
  chainId: number
): Promise<ProgressSnapshot> {
  const [headRaw, statsRaw, recentRaw, cursor] = await Promise.all([
    client.hGetAll(key(chainId, 'head')),
    client.hGetAll(key(chainId, 'stats')),
    client.lRange(key(chainId, 'recent'), 0, 49),
    client.hGetAll(key(chainId, 'cursor')),
  ]);

  return {
    head: parseHead(headRaw),
    cursor: Object.keys(cursor).length > 0 ? cursor : null,
    stats: parseStats(statsRaw),
    recent: recentRaw.map(parseProgressPayload).filter((item): item is ProgressPayload => item !== null),
  };
}

function parseHead(raw: Record<string, string>): ProgressHead {
  const blockNumber = parseNumber(raw.blockNumber);
  return {
    blockNumber,
    timestamp: raw.timestamp ?? null,
  };
}

function parseStats(raw: Record<string, string>): ProgressStats {
  return {
    blocksIndexed: parseNumber(raw.blocksIndexed) ?? 0,
    txsIndexed: parseNumber(raw.txsIndexed) ?? 0,
    eventsIndexed: parseNumber(raw.eventsIndexed) ?? 0,
    fraudDetected: parseNumber(raw.fraudDetected) ?? 0,
    lastBlockAt: raw.lastBlockAt ?? null,
  };
}

function parseProgressPayload(raw: string): ProgressPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ProgressPayload>;
    if (
      typeof parsed.blockNumber !== 'number' ||
      typeof parsed.txCount !== 'number' ||
      !Array.isArray(parsed.eventNames) ||
      typeof parsed.isFraud !== 'boolean' ||
      typeof parsed.ts !== 'string'
    ) {
      return null;
    }

    return {
      blockNumber: parsed.blockNumber,
      txCount: parsed.txCount,
      eventNames: parsed.eventNames.filter((name): name is string => typeof name === 'string'),
      isFraud: parsed.isFraud,
      ts: parsed.ts,
    };
  } catch {
    return null;
  }
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

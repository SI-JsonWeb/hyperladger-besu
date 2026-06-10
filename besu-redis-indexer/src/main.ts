import { Server } from 'http';
import { config } from './config';
import { abi, requiredEvents } from './artifacts';
import { createRedisClient, closeRedisClient } from './redis/client';
import { ensureSchemas } from './redis/schema';
import { startRedisInfoServer, closeRedisInfoServer } from './redis/info-server';
import { createOpenSearchClient, closeOpenSearchClient } from './opensearch/client';
import { ensureOpenSearchSchemas } from './opensearch/schema';
import { createHttpProvider, createWsProvider } from './besu/reader';
import { runCatchUp, startWsSubscription, startHttpPolling, stopHttpPolling } from './indexer/catchup';

async function withRetry<T>(label: string, fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`${label} (attempt ${attempt}/${maxRetries})...`);
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`${label} failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        console.log(`retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error(`${label} failed after ${maxRetries} attempts`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--print-config')) {
    console.log('config:', JSON.stringify(config, null, 2));
    console.log('required events:', requiredEvents);
    return;
  }

  // Graceful shutdown — registered early so it fires during retry loops
  let redisClient: ReturnType<typeof createRedisClient> extends Promise<infer T> ? T : never;
  let openSearchClient: (ReturnType<typeof createOpenSearchClient> extends Promise<infer T> ? T : never) | null = null;
  let redisInfoServer: Server | null = null;
  const shutdown = async () => {
    console.log('indexer stopping...');
    stopHttpPolling();
    try {
      await closeRedisInfoServer(redisInfoServer);
    } catch (err) {
      console.warn('redis info site close failed:', err);
    }
    try {
      await closeOpenSearchClient(openSearchClient);
    } catch (err) {
      console.warn('opensearch close failed:', err);
    }
    try {
      await closeRedisClient(redisClient);
    } catch {
      // ignore close errors during shutdown
    }
    console.log('indexer stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to Redis with retry
  redisClient = await withRetry('redis ready', async () => {
    const client = await createRedisClient({ REDIS_URL: config.REDIS_URL });
    return client;
  });
  console.log('redis ready');

  // Ensure schemas
  await ensureSchemas(redisClient, config.CHAIN_ID);
  console.log('schema ready');

  if (config.SEARCH_BACKEND === 'opensearch') {
    openSearchClient = await withRetry('opensearch ready', async () => {
      const client = await createOpenSearchClient({ OPENSEARCH_URL: config.OPENSEARCH_URL });
      return client;
    });
    await ensureOpenSearchSchemas(openSearchClient, config.CHAIN_ID, config.OPENSEARCH_INDEX_PREFIX);
    console.log('opensearch schema ready');
  }

  if (args.includes('--init-schema-only')) {
    await closeOpenSearchClient(openSearchClient);
    await closeRedisClient(redisClient);
    return;
  }

  redisInfoServer = startRedisInfoServer(redisClient, openSearchClient);

  // Connect to Besu HTTP with retry
  const httpProvider = await withRetry('besu ready', () => createHttpProvider());
  console.log('besu ready');

  // Run initial catch-up
  await runCatchUp(redisClient, openSearchClient, httpProvider);

  // Start WebSocket subscription (non-blocking)
  try {
    const wsProvider = await createWsProvider();
    await startWsSubscription(wsProvider, redisClient, openSearchClient, httpProvider);
  } catch (err) {
    console.warn('WebSocket subscription failed, continuing with HTTP polling only:', err);
  }

  // Start HTTP polling
  startHttpPolling(redisClient, openSearchClient, httpProvider, config.POLL_INTERVAL_MS);

  console.log('indexer running');
}

main();

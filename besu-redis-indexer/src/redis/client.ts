import { createClient } from 'redis';

interface Config {
  REDIS_URL: string;
}

type RedisClient = ReturnType<typeof createClient>;

export async function createRedisClient(config: Config): Promise<RedisClient> {
  const client = createClient({ url: config.REDIS_URL });

  client.on('error', (err) => {
    console.error('Redis client error:', err);
  });

  await client.connect();

  const info = await client.info('server');
  const versionMatch = info.match(/redis_version:(\d+)/);
  if (!versionMatch || !versionMatch[1] || !versionMatch[1].startsWith('8')) {
    throw new Error(
      `Redis version check failed: expected major version 8, got "${versionMatch?.[1] ?? 'unknown'}". ` +
      `Please ensure Redis 8.x is running.`
    );
  }

  const ftList = await client.sendCommand(['FT._LIST']);
  if (!ftList || !Array.isArray(ftList)) {
    throw new Error(
      `FT._LIST command failed or returned unexpected type: ${typeof ftList}. ` +
      `Ensure RediSearch module is loaded.`
    );
  }

  return client;
}

export async function closeRedisClient(client: RedisClient): Promise<void> {
  await client.quit();
}
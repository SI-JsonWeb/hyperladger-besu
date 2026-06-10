import { Client } from '@opensearch-project/opensearch';

interface Config {
  OPENSEARCH_URL: string;
}

export type OpenSearchClient = Client;

export async function createOpenSearchClient(config: Config): Promise<OpenSearchClient> {
  const client = new Client({ node: config.OPENSEARCH_URL });
  await client.ping();
  return client;
}

export async function closeOpenSearchClient(client: OpenSearchClient | null): Promise<void> {
  if (!client) return;
  await client.close();
}

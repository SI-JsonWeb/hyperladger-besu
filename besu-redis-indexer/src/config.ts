import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

interface Config {
  RPC_HTTP_URL: string;
  RPC_WS_URL: string;
  REDIS_URL: string;
  SEARCH_BACKEND: 'opensearch' | 'redis';
  OPENSEARCH_URL: string;
  OPENSEARCH_INDEX_PREFIX: string;
  CHAIN_ID: number;
  CONTRACT_ADDRESS: string;
  CONTRACT_START_BLOCK: number;
  INDEX_BLOCKS_FROM_GENESIS: boolean;
  POLL_INTERVAL_MS: number;
  CONFIRMATIONS: number;
  REDIS_INFO_HOST: string;
  REDIS_INFO_PORT: number;
}

interface DeploymentJson {
  chainId: string;
  contractAddress: string;
  blockNumber: string;
}

function getConfig(): Config {
  const deploymentPath = path.resolve(__dirname, '../../smart_contracts/deployments/deployment.json');
  let deployment: DeploymentJson | null = null;

  if (fs.existsSync(deploymentPath)) {
    try {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8')) as DeploymentJson;
    } catch {
      // ignore parse errors
    }
  }

  const RPC_HTTP_URL = process.env.RPC_HTTP_URL ?? 'http://127.0.0.1:8545';
  const RPC_WS_URL = process.env.RPC_WS_URL ?? 'ws://127.0.0.1:8546';
  const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const rawSearchBackend = process.env.SEARCH_BACKEND ?? 'opensearch';
  const SEARCH_BACKEND = rawSearchBackend === 'redis' ? 'redis' : 'opensearch';
  const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? 'http://127.0.0.1:9200';
  const OPENSEARCH_INDEX_PREFIX = process.env.OPENSEARCH_INDEX_PREFIX ?? 'besu';
  const CHAIN_ID = deployment ? parseInt(deployment.chainId, 10) : parseInt(process.env.CHAIN_ID ?? '1337', 10);
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? deployment?.contractAddress ?? '';
  const CONTRACT_START_BLOCK = deployment ? parseInt(deployment.blockNumber, 10) : parseInt(process.env.CONTRACT_START_BLOCK ?? '0', 10);
  const INDEX_BLOCKS_FROM_GENESIS = process.env.INDEX_BLOCKS_FROM_GENESIS !== 'false';
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10);
  const CONFIRMATIONS = parseInt(process.env.CONFIRMATIONS ?? '0', 10);
  const REDIS_INFO_HOST = process.env.REDIS_INFO_HOST ?? '0.0.0.0';
  const REDIS_INFO_PORT = parseInt(process.env.REDIS_INFO_PORT ?? '8090', 10);

  return {
    RPC_HTTP_URL,
    RPC_WS_URL,
    REDIS_URL,
    SEARCH_BACKEND,
    OPENSEARCH_URL,
    OPENSEARCH_INDEX_PREFIX,
    CHAIN_ID,
    CONTRACT_ADDRESS,
    CONTRACT_START_BLOCK,
    INDEX_BLOCKS_FROM_GENESIS,
    POLL_INTERVAL_MS,
    CONFIRMATIONS,
    REDIS_INFO_HOST,
    REDIS_INFO_PORT,
  };
}

export const config = getConfig();

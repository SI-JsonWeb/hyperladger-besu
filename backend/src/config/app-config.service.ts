import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isAddress, type Address, type Hex } from 'viem';

type DeploymentFile = {
  contractAddress?: string;
  chainId?: string;
};

@Injectable()
export class AppConfigService {
  readonly httpAddr: string;
  readonly host: string;
  readonly port: number;
  readonly rpcUrl: string;
  readonly contractAddress: Address;
  readonly privateKey: Hex;
  readonly chainId: bigint;

  constructor() {
    dotenv.config({ path: join(process.cwd(), '.env') });

    const deployment = this.loadDeployment();
    const contractAddress = (process.env.CONTRACT_ADDRESS || deployment.contractAddress || '').trim();

    if (!isAddress(contractAddress)) {
      throw new Error(`invalid contract address: ${JSON.stringify(contractAddress)}`);
    }

    const privateKey = (process.env.PRIVATE_KEY || '').trim();
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required for transaction signing');
    }

    this.httpAddr = process.env.HTTP_ADDR || ':8080';
    const parsedListen = this.parseHttpAddr(this.httpAddr);
    this.host = parsedListen.host;
    this.port = parsedListen.port;
    this.rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
    this.contractAddress = contractAddress;
    this.privateKey = this.normalizePrivateKey(privateKey);
    this.chainId = this.parseChainId(process.env.CHAIN_ID || deployment.chainId || '1337');
  }

  private normalizePrivateKey(value: string): Hex {
    const privateKey = value.startsWith('0x') ? value : `0x${value}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error('PRIVATE_KEY must be a 32-byte hex string');
    }
    return privateKey as Hex;
  }

  private parseHttpAddr(value: string): { host: string; port: number } {
    const trimmed = value.trim();
    const portText = trimmed.startsWith(':') ? trimmed.slice(1) : trimmed.split(':').pop();
    const port = Number(portText);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`invalid HTTP_ADDR: ${JSON.stringify(value)}`);
    }
    const host = trimmed.startsWith(':') ? '0.0.0.0' : trimmed.slice(0, trimmed.lastIndexOf(':')) || '0.0.0.0';
    return { host, port };
  }

  private parseChainId(value: string): bigint {
    try {
      const parsed = BigInt(value.trim());
      if (parsed <= 0n) {
        throw new Error();
      }
      return parsed;
    } catch {
      throw new Error(`invalid CHAIN_ID: ${JSON.stringify(value)}`);
    }
  }

  private loadDeployment(): DeploymentFile {
    for (const path of [
      join(process.cwd(), '../smart_contracts/deployments/deployment.json'),
      join(process.cwd(), 'smart_contracts/deployments/deployment.json'),
    ]) {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8')) as DeploymentFile;
      }
    }
    return {};
  }
}

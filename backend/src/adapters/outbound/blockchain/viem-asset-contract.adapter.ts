import { Injectable } from '@nestjs/common';
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Account, type Address, type Chain, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AssetContractPort } from '../../../application/ports/asset-contract.port';
import { AppConfigService } from '../../../config/app-config.service';
import { Asset } from '../../../domain/asset';
import { FileRecord } from '../../../domain/file-record';
import { TransactionResult } from '../../../domain/transaction-result';

type AssetInfo = readonly [Address, boolean, Address, bigint];
type FileInfo = readonly [string, string, bigint];

@Injectable()
export class ViemAssetContractAdapter implements AssetContractPort {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: Account;
  private readonly chain: Chain;
  private readonly address: Address;
  private readonly abi: Abi;

  constructor(config: AppConfigService) {
    this.chain = defineChain({
      id: Number(config.chainId),
      name: 'Besu Dev Network',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({ account: this.account, chain: this.chain, transport: http(config.rpcUrl) });
    this.address = config.contractAddress;
    this.abi = this.loadAbi();
  }

  async registerAsset(assetId: bigint): Promise<TransactionResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      address: this.address,
      abi: this.abi,
      chain: this.chain,
      functionName: 'registerAsset',
      args: [assetId],
    });
    return this.wait(txHash);
  }

  async getAssetInfo(assetId: bigint): Promise<Asset> {
    const [owner, pledged, lender, lienAmount] = (await this.publicClient.readContract({
      address: this.address,
      abi: this.abi,
      functionName: 'getAssetInfo',
      args: [assetId],
    })) as AssetInfo;
    return { owner, pledged, lender, lienAmountWei: lienAmount.toString() };
  }

  async isAssetFree(assetId: bigint): Promise<boolean> {
    return (await this.publicClient.readContract({ address: this.address, abi: this.abi, functionName: 'isAssetFree', args: [assetId] })) as boolean;
  }

  async requestFinancing(assetId: bigint, amount: bigint): Promise<TransactionResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      address: this.address,
      abi: this.abi,
      chain: this.chain,
      functionName: 'requestFinancing',
      args: [assetId, amount],
    });
    return this.wait(txHash);
  }

  async repayAndRelease(assetId: bigint, amount: bigint): Promise<TransactionResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      address: this.address,
      abi: this.abi,
      chain: this.chain,
      functionName: 'repayAndRelease',
      args: [assetId],
      value: amount,
    });
    return this.wait(txHash);
  }

  async getFlaggedAccounts(): Promise<string[]> {
    const accounts = (await this.publicClient.readContract({ address: this.address, abi: this.abi, functionName: 'getFlaggedAccounts' })) as Address[];
    return accounts;
  }

  async clearFlaggedAccounts(): Promise<TransactionResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      address: this.address,
      abi: this.abi,
      chain: this.chain,
      functionName: 'clearFlaggedAccounts',
    });
    return this.wait(txHash);
  }

  async registerFile(assetId: bigint, fileURI: string, fileHash: string): Promise<TransactionResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      address: this.address,
      abi: this.abi,
      chain: this.chain,
      functionName: 'registerFile',
      args: [assetId, fileURI, fileHash],
    });
    return this.wait(txHash);
  }

  async verifyFile(assetId: bigint, fileHash: string): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.address,
      abi: this.abi,
      functionName: 'verifyFile',
      args: [assetId, fileHash],
    })) as boolean;
  }

  async getFileInfo(assetId: bigint): Promise<FileRecord> {
    const [fileURI, fileHash, timestamp] = (await this.publicClient.readContract({
      address: this.address,
      abi: this.abi,
      functionName: 'getFileInfo',
      args: [assetId],
    })) as FileInfo;
    return { fileURI, fileHash, timestamp: timestamp.toString() };
  }

  private async wait(txHash: Hex): Promise<TransactionResult> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error(`transaction reverted: ${txHash}`);
    }
    return { txHash };
  }

  private loadAbi(): Abi {
    for (const path of [
      join(process.cwd(), '../smart_contracts/contracts/DoubleFinancingPreventer.json'),
      join(process.cwd(), 'smart_contracts/contracts/DoubleFinancingPreventer.json'),
    ]) {
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf8')).abi as Abi;
      }
    }
    throw new Error('DoubleFinancingPreventer artifact not found');
  }
}

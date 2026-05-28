import { Inject, Injectable } from '@nestjs/common';
import { AssetContractPort } from '../ports/asset-contract.port';
import { ASSET_CONTRACT_PORT } from '../tokens';

@Injectable()
export class AssetUseCasesService {
  constructor(
    @Inject(ASSET_CONTRACT_PORT)
    private readonly contract: AssetContractPort,
  ) {}

  registerAsset(assetId: bigint) {
    return this.contract.registerAsset(assetId);
  }

  getAssetInfo(assetId: bigint) {
    return this.contract.getAssetInfo(assetId);
  }

  async isAssetFree(assetId: bigint) {
    return { free: await this.contract.isAssetFree(assetId) };
  }

  requestFinancing(assetId: bigint, amount: bigint) {
    return this.contract.requestFinancing(assetId, amount);
  }

  repayAndRelease(assetId: bigint, amount: bigint) {
    return this.contract.repayAndRelease(assetId, amount);
  }

  async getFlaggedAccounts() {
    return { accounts: await this.contract.getFlaggedAccounts() };
  }

  clearFlaggedAccounts() {
    return this.contract.clearFlaggedAccounts();
  }

  registerFile(assetId: bigint, fileURI: string, fileHash: string) {
    return this.contract.registerFile(assetId, fileURI, fileHash);
  }

  async verifyFile(assetId: bigint, fileHash: string) {
    return { valid: await this.contract.verifyFile(assetId, fileHash) };
  }

  getFileInfo(assetId: bigint) {
    return this.contract.getFileInfo(assetId);
  }
}

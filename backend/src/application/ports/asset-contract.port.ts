import { Asset } from '../../domain/asset';
import { FileRecord } from '../../domain/file-record';
import { TransactionResult } from '../../domain/transaction-result';

export interface AssetContractPort {
  registerAsset(assetId: bigint): Promise<TransactionResult>;
  getAssetInfo(assetId: bigint): Promise<Asset>;
  isAssetFree(assetId: bigint): Promise<boolean>;
  requestFinancing(assetId: bigint, amount: bigint): Promise<TransactionResult>;
  repayAndRelease(assetId: bigint, amount: bigint): Promise<TransactionResult>;
  getFlaggedAccounts(): Promise<string[]>;
  registerFile(assetId: bigint, fileURI: string, fileHash: string): Promise<TransactionResult>;
  verifyFile(assetId: bigint, fileHash: string): Promise<boolean>;
  getFileInfo(assetId: bigint): Promise<FileRecord>;
}

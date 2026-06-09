import { Interface, Result, Log } from 'ethers';
import { abi } from '../artifacts';
import { config } from '../config';

export interface DecodedEvent {
  chainId: number;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  txIndex: number;
  logIndex: number;
  assetId?: string;
  owner?: string;
  borrower?: string;
  lender?: string;
  account?: string;
  amountWei?: string;
  reason?: string;
  fileURI?: string;
  fileHash?: string;
  removed?: boolean;
}

const iface = new Interface(abi as import('ethers').InterfaceAbi);

function toDecimalString(value: bigint): string {
  return value.toString();
}

function extractAssetId(args: Result, index: number): string {
  return toDecimalString(args[index]);
}

function extractAddress(args: Result, index: number): string {
  return args[index].toLowerCase();
}

function extractString(args: Result, index: number): string {
  return args[index] as string;
}

export function parseEvents(logs: Log[]): DecodedEvent[] {
  const contractAddress = config.CONTRACT_ADDRESS.toLowerCase();
  const chainId = config.CHAIN_ID;

  return logs
    .filter((log) => log.address.toLowerCase() === contractAddress)
    .map((log) => {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (!parsed) return null;

      const { name: eventName, args: eventArgs } = parsed;
      const common = {
        chainId,
        contractAddress: config.CONTRACT_ADDRESS,
        eventName,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        txHash: log.transactionHash,
        txIndex: log.transactionIndex,
        logIndex: log.index,
        removed: log.removed,
      };

      switch (eventName) {
        case 'AssetRegistered':
          return {
            ...common,
            assetId: extractAssetId(eventArgs, 0),
            owner: extractAddress(eventArgs, 1),
          } as DecodedEvent;

        case 'FinancingRecorded':
          return {
            ...common,
            assetId: extractAssetId(eventArgs, 1),
            borrower: extractAddress(eventArgs, 0),
            lender: extractAddress(eventArgs, 3),
            amountWei: toDecimalString(eventArgs[2]),
          } as DecodedEvent;

        case 'LienReleased':
          return {
            ...common,
            assetId: extractAssetId(eventArgs, 0),
            borrower: extractAddress(eventArgs, 1),
          } as DecodedEvent;

        case 'FraudAttemptDetected':
          return {
            ...common,
            assetId: extractAssetId(eventArgs, 1),
            account: extractAddress(eventArgs, 0),
            reason: extractString(eventArgs, 2),
          } as DecodedEvent;

        case 'AccountFlagged':
          return {
            ...common,
            account: extractAddress(eventArgs, 0),
            reason: extractString(eventArgs, 1),
          } as DecodedEvent;

        case 'FileRegistered':
          return {
            ...common,
            assetId: extractAssetId(eventArgs, 0),
            fileHash: extractString(eventArgs, 1),
            fileURI: extractString(eventArgs, 2),
          } as DecodedEvent;

        default:
          return null;
      }
    })
    .filter((e): e is DecodedEvent => e !== null);
}

export function serializeEvent(event: DecodedEvent): Record<string, string> {
  const out: Record<string, string> = {
    chainId: String(event.chainId),
    contractAddress: event.contractAddress.toLowerCase(),
    eventName: event.eventName,
    blockNumber: String(event.blockNumber),
    blockHash: event.blockHash,
    txHash: event.txHash,
    txIndex: String(event.txIndex),
    logIndex: String(event.logIndex),
  };

  if (event.assetId !== undefined) out.assetId = event.assetId;
  if (event.owner !== undefined) out.owner = event.owner.toLowerCase();
  if (event.borrower !== undefined) out.borrower = event.borrower.toLowerCase();
  if (event.lender !== undefined) out.lender = event.lender.toLowerCase();
  if (event.account !== undefined) out.account = event.account.toLowerCase();
  if (event.amountWei !== undefined) out.amountWei = event.amountWei;
  if (event.reason !== undefined) out.reason = event.reason;
  if (event.fileURI !== undefined) out.fileURI = event.fileURI;
  if (event.fileHash !== undefined) out.fileHash = event.fileHash;
  if (event.removed !== undefined) out.removed = String(event.removed);

  return out;
}

export const REQUIRED_EVENTS = [
  'AssetRegistered',
  'FinancingRecorded',
  'LienReleased',
  'FraudAttemptDetected',
  'AccountFlagged',
  'FileRegistered',
] as const;
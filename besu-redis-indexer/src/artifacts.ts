import fs from 'fs';
import path from 'path';

const artifactPath = path.resolve(__dirname, '../../smart_contracts/contracts/DoubleFinancingPreventer.json');

let artifact: { abi: unknown };
try {
  artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as { abi: unknown };
} catch {
  throw new Error(`DoubleFinancingPreventer artifact not found at ${artifactPath}`);
}

const abi = artifact.abi;

const requiredEvents = [
  'AssetRegistered',
  'FinancingRecorded',
  'LienReleased',
  'FraudAttemptDetected',
  'AccountFlagged',
  'FileRegistered',
] as const;

type AbiEntry = { name?: string; type?: string };
const abiEntries = abi as AbiEntry[];
const eventNames = new Set(abiEntries.filter((e) => e.type === 'event' && e.name).map((e) => e.name));

const missing = requiredEvents.filter((e) => !eventNames.has(e));
if (missing.length > 0) {
  throw new Error(`Missing required events: ${missing.join(', ')}`);
}

export { abi, requiredEvents };

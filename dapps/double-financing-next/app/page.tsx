'use client';

import { FormEvent, useEffect, useState, useTransition } from 'react';

type Asset = {
  owner: string;
  pledged: boolean;
  lender: string;
  lienAmountWei: string;
};

type FileRecord = {
  fileURI: string;
  fileHash: string;
  timestamp: string;
};

type Result = {
  ok: boolean;
  message: string;
};

const zeroAddress = '0x0000000000000000000000000000000000000000';

function toWei(value: string) {
  const [whole, fraction = ''] = value.trim().split('.');
  const safeWhole = whole || '0';
  const paddedFraction = `${fraction}000000000000000000`.slice(0, 18);
  return (BigInt(safeWhole) * 10n ** 18n + BigInt(paddedFraction)).toString();
}

function fromWei(value: string) {
  const wei = BigInt(value || '0');
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Request failed with ${response.status}`);
  }
  return data as T;
}

function ResultBox({ result, children }: { result?: Result; children?: React.ReactNode }) {
  return <div className={`result-box ${result ? (result.ok ? 'success' : 'error') : ''}`}>{result ? result.message : children}</div>;
}

export default function Home() {
  const [health, setHealth] = useState<Result>({ ok: false, message: 'Checking backend...' });
  const [lookupId, setLookupId] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [fileRecord, setFileRecord] = useState<FileRecord | null>(null);
  const [registerId, setRegisterId] = useState('');
  const [financeId, setFinanceId] = useState('');
  const [financeAmount, setFinanceAmount] = useState('1');
  const [repayId, setRepayId] = useState('');
  const [repayAmount, setRepayAmount] = useState('1');
  const [fileAssetId, setFileAssetId] = useState('');
  const [fileURI, setFileURI] = useState('');
  const [fileHash, setFileHash] = useState('');
  const [verifyAssetId, setVerifyAssetId] = useState('');
  const [verifyHash, setVerifyHash] = useState('');
  const [flagged, setFlagged] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>(['Ready. Start by checking backend health, then register an asset.']);
  const [result, setResult] = useState<Result>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void checkHealth();
  }, []);

  function appendEvent(message: string) {
    setEvents((current) => [`${new Date().toLocaleTimeString()} - ${message}`, ...current].slice(0, 10));
  }

  async function run(action: () => Promise<string>) {
    startTransition(async () => {
      try {
        const message = await action();
        setResult({ ok: true, message });
        appendEvent(message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setResult({ ok: false, message });
        appendEvent(`Error: ${message}`);
      }
    });
  }

  async function checkHealth() {
    try {
      const data = await backend<{ status: string }>('/health');
      setHealth({ ok: true, message: `Backend ${data.status}` });
    } catch (error) {
      setHealth({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function lookupAsset(event?: FormEvent) {
    event?.preventDefault();
    if (!lookupId) return;
    await run(async () => {
      const [assetInfo, fileInfo] = await Promise.all([
        backend<Asset>(`/assets/${lookupId}`),
        backend<FileRecord>(`/assets/${lookupId}/files`).catch(() => null),
      ]);
      setAsset(assetInfo);
      setFileRecord(fileInfo && fileInfo.fileHash ? fileInfo : null);
      return `Loaded asset #${lookupId}`;
    });
  }

  async function refreshFlagged() {
    await run(async () => {
      const data = await backend<{ accounts: string[] }>('/accounts/flagged');
      setFlagged(data.accounts);
      return `Loaded ${data.accounts.length} flagged account(s)`;
    });
  }

  async function clearFlaggedAccounts() {
    if (!confirm('Clear all flagged accounts?')) return;
    await run(async () => {
      await backend('/accounts/flagged/clear', { method: 'POST', body: '{}' });
      const data = await backend<{ accounts: string[] }>('/accounts/flagged');
      setFlagged(data.accounts);
      return data.accounts.length === 0 ? 'Cleared flagged accounts' : `Clear submitted, but ${data.accounts.length} account(s) remain flagged`;
    });
  }

  async function hashSelectedFile(file?: File) {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    setFileHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Hyperledger Besu Demo</p>
          <h1>Double Financing Preventer</h1>
          <p className="subtitle">Next.js control panel for the REST backend that registers assets, records liens, detects duplicate financing, and verifies off-chain file hashes.</p>
        </div>
        <button onClick={checkHealth}>Check Backend</button>
      </section>

      <section className="status-card">
        <div>
          <span>Backend</span>
          <strong className={health.ok ? 'good' : 'bad'}>{health.message}</strong>
        </div>
        <div>
          <span>API Proxy</span>
          <strong>/api/backend</strong>
        </div>
        <div>
          <span>Writes</span>
          <strong>Signed by backend</strong>
        </div>
      </section>

      <section className="grid two">
        <form className="card wide" onSubmit={lookupAsset}>
          <h2>Asset Lookup</h2>
          <div className="row">
            <input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="Asset ID" min="1" type="number" />
            <button disabled={isPending}>Lookup</button>
          </div>
          <div className="asset-panel">
            {asset ? (
              <>
                <p><span>Owner</span><code>{asset.owner === zeroAddress ? '(none)' : asset.owner}</code></p>
                <p><span>Status</span><b className={asset.pledged ? 'danger' : 'good'}>{asset.pledged ? 'Pledged' : 'Free'}</b></p>
                <p><span>Lender</span><code>{asset.lender === zeroAddress ? '(none)' : asset.lender}</code></p>
                <p><span>Lien</span><b>{fromWei(asset.lienAmountWei)} ETH</b></p>
                {fileRecord ? (
                  <>
                    <p><span>IPFS URI</span><code>{fileRecord.fileURI || '(none)'}</code></p>
                    <p><span>File Hash</span><code>{fileRecord.fileHash}</code></p>
                    <p><span>Registered</span><b>{fileRecord.timestamp ? new Date(Number(fileRecord.timestamp) * 1000).toLocaleString() : '-'}</b></p>
                  </>
                ) : null}
              </>
            ) : 'Enter an asset ID to inspect its financing state.'}
          </div>
        </form>

        <div className="card">
          <h2>Fraud Alerts</h2>
          <div className="button-row">
            <button onClick={refreshFlagged} disabled={isPending}>Refresh Flagged Accounts</button>
            <button className="danger-button" onClick={clearFlaggedAccounts} disabled={isPending || flagged.length === 0}>Clear Flagged Accounts</button>
          </div>
          <div className="list">{flagged.length ? flagged.map((account) => <code key={account}>{account}</code>) : <span>No flagged accounts loaded.</span>}</div>
        </div>
      </section>

      <section className="grid three">
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await backend('/assets', { method: 'POST', body: JSON.stringify({ assetId: registerId }) }); return `Registered asset #${registerId}`; }); }}>
          <h2>Register Asset</h2>
          <input value={registerId} onChange={(event) => setRegisterId(event.target.value)} placeholder="Asset ID" min="1" type="number" required />
          <button disabled={isPending}>Register</button>
        </form>

        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await backend(`/assets/${financeId}/financing`, { method: 'POST', body: JSON.stringify({ amountWei: toWei(financeAmount) }) }); return `Requested ${financeAmount} ETH financing for asset #${financeId}`; }); }}>
          <h2>Request Financing</h2>
          <input value={financeId} onChange={(event) => setFinanceId(event.target.value)} placeholder="Asset ID" min="1" type="number" required />
          <input value={financeAmount} onChange={(event) => setFinanceAmount(event.target.value)} placeholder="Amount in ETH" min="0" step="0.01" type="number" required />
          <button disabled={isPending}>Pledge Asset</button>
        </form>

        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await backend(`/assets/${repayId}/repay`, { method: 'POST', body: JSON.stringify({ amountWei: toWei(repayAmount) }) }); return `Repaid ${repayAmount} ETH and released asset #${repayId}`; }); }}>
          <h2>Repay Lien</h2>
          <input value={repayId} onChange={(event) => setRepayId(event.target.value)} placeholder="Asset ID" min="1" type="number" required />
          <input value={repayAmount} onChange={(event) => setRepayAmount(event.target.value)} placeholder="Amount in ETH" min="0" step="0.01" type="number" required />
          <button disabled={isPending}>Repay & Release</button>
        </form>
      </section>

      <section className="grid two">
        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await backend(`/assets/${fileAssetId}/files`, { method: 'POST', body: JSON.stringify({ fileURI, fileHash }) }); return `Registered file hash for asset #${fileAssetId}`; }); }}>
          <h2>Register File Hash</h2>
          <input value={fileAssetId} onChange={(event) => setFileAssetId(event.target.value)} placeholder="Asset ID" min="1" type="number" required />
          <input type="file" onChange={(event) => void hashSelectedFile(event.target.files?.[0])} />
          <input value={fileURI} onChange={(event) => setFileURI(event.target.value)} placeholder="ipfs://..." required />
          {fileHash ? <code className="hash">{fileHash}</code> : <span className="hint">Select a file to compute SHA-256.</span>}
          <button disabled={isPending || !fileHash}>Register File</button>
        </form>

        <form className="card" onSubmit={(event) => { event.preventDefault(); void run(async () => { const data = await backend<{ valid: boolean }>(`/assets/${verifyAssetId}/files/verify`, { method: 'POST', body: JSON.stringify({ fileHash: verifyHash }) }); return data.valid ? 'File hash matches on-chain record' : 'File hash does not match'; }); }}>
          <h2>Verify File</h2>
          <input value={verifyAssetId} onChange={(event) => setVerifyAssetId(event.target.value)} placeholder="Asset ID" min="1" type="number" required />
          <input value={verifyHash} onChange={(event) => setVerifyHash(event.target.value)} placeholder="SHA-256 hash" required />
          <button disabled={isPending}>Verify Hash</button>
        </form>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Latest Result</h2>
          <ResultBox result={result}>No operation yet.</ResultBox>
        </div>
        <div className="card">
          <h2>Activity</h2>
          <div className="event-log">{events.map((event) => <p key={event}>{event}</p>)}</div>
        </div>
      </section>
    </main>
  );
}

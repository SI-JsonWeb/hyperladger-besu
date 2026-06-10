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

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

function StatusIndicator({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`status-indicator ${ok ? 'online' : 'offline'}`}>
      <span className="dot" />
      <span>{label}</span>
    </div>
  );
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
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [events, setEvents] = useState<string[]>(['Ready. Start by checking backend health, then register an asset.']);
  const [result, setResult] = useState<Result>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void checkHealth();
  }, []);

  function appendEvent(message: string) {
    setEvents((current) => [`${new Date().toLocaleTimeString()} — ${message}`, ...current].slice(0, 10));
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
    setShowConfirmClear(false);
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
      {/* COMMAND HEADER */}
      <section className="hero">
        <div className="hero-content">
          <h1>Double Financing Preventer</h1>
          <p className="subtitle">
            Learn how to register asset liens, detect duplicate financing on-chain,
            and verify off-chain file hashes against Ethereum records — all through a local dev proxy.
          </p>
        </div>
        <div className="hero-status">
          <StatusIndicator ok={health.ok} label={health.message} />
          <StatusIndicator ok={true} label="API Proxy active" />
          <button onClick={checkHealth} className="secondary" disabled={isPending}>
            Refresh Status
          </button>
        </div>
      </section>

      {/* MAIN GRID */}
      <div className="grid two">
        {/* ASSET LOOKUP */}
        <form className="card wide" onSubmit={lookupAsset}>
          <h2>Asset Lookup</h2>
          <label htmlFor="lookupId" className="field-label">Asset ID</label>
          <div className="row">
            <input
              id="lookupId"
              value={lookupId}
              onChange={(event) => setLookupId(event.target.value)}
              placeholder="e.g. 1"
              min="1"
              type="number"
            />
            <button disabled={isPending || !lookupId}>Lookup asset</button>
          </div>
          <span className="hint">Numeric ID of the asset to inspect. {(!lookupId) && 'Enter an ID to enable lookup.'}</span>
          <div className="asset-panel">
            {asset ? (
              <>
                <p>
                  <span className="field-label">Owner</span>
                  <span className="field-value">
                    <code className="address">{asset.owner === zeroAddress ? '(none)' : asset.owner}</code>
                  </span>
                </p>
                <p>
                  <span className="field-label">Status</span>
                  <span className={`field-value ${asset.pledged ? 'danger' : 'good'}`}>
                    {asset.pledged ? '⟳ Pledged' : '◎ Free'}
                  </span>
                </p>
                <p>
                  <span className="field-label">Lender</span>
                  <span className="field-value">
                    <code className="address">{asset.lender === zeroAddress ? '(none)' : asset.lender}</code>
                  </span>
                </p>
                <p>
                  <span className="field-label">Lien Amount</span>
                  <span className="field-value">{fromWei(asset.lienAmountWei)} ETH</span>
                </p>
                {fileRecord && (
                  <>
                    <p>
                      <span className="field-label">IPFS URI</span>
                      <span className="field-value">
                        <code className="address">{fileRecord.fileURI || '(none)'}</code>
                      </span>
                    </p>
                    <p>
                      <span className="field-label">File Hash</span>
                      <span className="field-value">
                        <code className="address">{fileRecord.fileHash}</code>
                      </span>
                    </p>
                    <p>
                      <span className="field-label">Registered</span>
                      <span className="field-value">
                        {fileRecord.timestamp
                          ? new Date(Number(fileRecord.timestamp) * 1000).toLocaleString()
                          : '-'}
                      </span>
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="hint">
                Enter an asset ID to inspect its financing state.
              </p>
            )}
          </div>
        </form>

        {/* FRAUD ALERTS */}
        <div className="card">
          <h2>Fraud Alerts</h2>
          {showConfirmClear ? (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: '0.82rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Are you sure you want to clear all flagged accounts?</p>
              <div className="button-row" style={{ marginTop: 0 }}>
                <button onClick={() => setShowConfirmClear(false)} disabled={isPending} className="secondary">
                  Cancel
                </button>
                <button
                  className="danger-button"
                  onClick={clearFlaggedAccounts}
                  disabled={isPending}
                >
                  Confirm Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="button-row" style={{ marginTop: 0 }}>
              <button onClick={refreshFlagged} disabled={isPending} className="secondary">
                Refresh flagged accounts
              </button>
              <button
                className="danger-button"
                onClick={() => setShowConfirmClear(true)}
                disabled={isPending || flagged.length === 0}
              >
                Clear flagged accounts
              </button>
            </div>
          )}
          <div className="list">
            {flagged.length ? (
              flagged.map((account) => (
                <code key={account}>{account}</code>
              ))
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                No flagged accounts detected.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ASSET OPERATIONS */}
      <section className="grid three">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await backend('/assets', { method: 'POST', body: JSON.stringify({ assetId: registerId }) });
              return `Registered asset #${registerId}`;
            });
          }}
        >
          <h2>Register Asset</h2>
          <label htmlFor="registerId" className="field-label">Asset ID</label>
          <input
            id="registerId"
            value={registerId}
            onChange={(event) => setRegisterId(event.target.value)}
            placeholder="e.g. 1"
            min="1"
            type="number"
            required
          />
          <span className="hint">Numeric ID for the new asset. {(!registerId) && 'Enter an ID to register.'}</span>
          <button disabled={isPending || !registerId}>Register asset</button>
        </form>

        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await backend(`/assets/${financeId}/financing`, {
                method: 'POST',
                body: JSON.stringify({ amountWei: toWei(financeAmount) }),
              });
              return `Requested ${financeAmount} ETH financing for asset #${financeId}`;
            });
          }}
        >
          <h2>Request Financing</h2>
          <label htmlFor="financeId" className="field-label">Asset ID</label>
          <input
            id="financeId"
            value={financeId}
            onChange={(event) => setFinanceId(event.target.value)}
            placeholder="e.g. 1"
            min="1"
            type="number"
            required
          />
          <label htmlFor="financeAmount" className="field-label">Amount (ETH)</label>
          <input
            id="financeAmount"
            value={financeAmount}
            onChange={(event) => setFinanceAmount(event.target.value)}
            placeholder="e.g. 1.5"
            min="0"
            step="0.01"
            type="number"
            required
          />
          <span className="hint">Amount in ETH to pledge. {(!financeId || !financeAmount) && 'Fill both fields to pledge.'}</span>
          <button disabled={isPending || !financeId || !financeAmount}>Request financing</button>
        </form>

        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await backend(`/assets/${repayId}/repay`, {
                method: 'POST',
                body: JSON.stringify({ amountWei: toWei(repayAmount) }),
              });
              return `Repaid ${repayAmount} ETH and released asset #${repayId}`;
            });
          }}
        >
          <h2>Repay Lien</h2>
          <label htmlFor="repayId" className="field-label">Asset ID</label>
          <input
            id="repayId"
            value={repayId}
            onChange={(event) => setRepayId(event.target.value)}
            placeholder="e.g. 1"
            min="1"
            type="number"
            required
          />
          <label htmlFor="repayAmount" className="field-label">Amount (ETH)</label>
          <input
            id="repayAmount"
            value={repayAmount}
            onChange={(event) => setRepayAmount(event.target.value)}
            placeholder="e.g. 1.5"
            min="0"
            step="0.01"
            type="number"
            required
          />
          <span className="hint">Amount in ETH to repay. {(!repayId || !repayAmount) && 'Fill both fields to repay.'}</span>
          <button disabled={isPending || !repayId || !repayAmount}>Repay lien</button>
        </form>
      </section>

      {/* FILE OPERATIONS */}
      <section className="grid two">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await backend(`/assets/${fileAssetId}/files`, {
                method: 'POST',
                body: JSON.stringify({ fileURI, fileHash }),
              });
              return `Registered file hash for asset #${fileAssetId}`;
            });
          }}
        >
          <h2>Register File Hash</h2>
          <label htmlFor="fileAssetId" className="field-label">Asset ID</label>
          <input
            id="fileAssetId"
            value={fileAssetId}
            onChange={(event) => setFileAssetId(event.target.value)}
            placeholder="e.g. 1"
            min="1"
            type="number"
            required
          />
          
          <label htmlFor="fileInput" className="field-label">File to Hash</label>
          <input id="fileInput" type="file" onChange={(event) => void hashSelectedFile(event.target.files?.[0])} />
          
          <label htmlFor="fileURI" className="field-label">IPFS URI</label>
          <input
            id="fileURI"
            value={fileURI}
            onChange={(event) => setFileURI(event.target.value)}
            placeholder="ipfs://..."
            required
          />
          <span className="hint">Format: ipfs://&lt;CID&gt;</span>

          {fileHash ? (
            <code className="hash">{fileHash}</code>
          ) : (
            <span className="hint">Select a file to compute its SHA-256 hash.</span>
          )}
          
          <span className="hint">{(!fileHash || !fileURI || !fileAssetId) && 'Provide Asset ID, File, and IPFS URI to register.'}</span>
          <button disabled={isPending || !fileHash || !fileURI || !fileAssetId}>Register file hash</button>
        </form>

        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const data = await backend<{ valid: boolean }>(`/assets/${verifyAssetId}/files/verify`, {
                method: 'POST',
                body: JSON.stringify({ fileHash: verifyHash }),
              });
              return data.valid ? '✓ File hash matches on-chain record' : '✗ File hash does not match';
            });
          }}
        >
          <h2>Verify File</h2>
          <label htmlFor="verifyAssetId" className="field-label">Asset ID</label>
          <input
            id="verifyAssetId"
            value={verifyAssetId}
            onChange={(event) => setVerifyAssetId(event.target.value)}
            placeholder="e.g. 1"
            min="1"
            type="number"
            required
          />
          <label htmlFor="verifyHash" className="field-label">SHA-256 Hash</label>
          <input
            id="verifyHash"
            value={verifyHash}
            onChange={(event) => setVerifyHash(event.target.value)}
            placeholder="e.g. a1b2c3..."
            required
          />
          <span className="hint">64-character hex string. {(!verifyAssetId || !verifyHash) && 'Fill both fields to verify.'}</span>
          <button disabled={isPending || !verifyAssetId || !verifyHash}>Verify file hash</button>
        </form>
      </section>

      {/* RESULT + ACTIVITY */}
      <section className="grid two">
        <div className="card">
          <h2>Latest Result</h2>
          <ResultBox result={result}>No operation yet.</ResultBox>
        </div>
        <div className="card">
          <h2>Activity Log</h2>
          <div className="event-log">
            {events.map((event, i) => (
              <p key={`${event}-${i}`}>{event}</p>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

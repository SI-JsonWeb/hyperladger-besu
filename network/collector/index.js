const Redis = require('ioredis');

const BESU_RPC_URL  = process.env.BESU_RPC_URL  || 'http://localhost:8545';
const REDIS_URL     = process.env.REDIS_URL     || 'redis://localhost:6379';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS) || 2000;

const redis = new Redis(REDIS_URL);
let lastBlockNumber = -1;

// ── Hex decoders ─────────────────────────────────────────────

// hex → integer
function hexToInt(hex) {
  if (!hex || hex === '0x') return 0;
  return parseInt(hex, 16);
}

// hex → ETH (from wei, 18 decimals)
function hexToEth(hex) {
  if (!hex || hex === '0x') return '0';
  const wei = BigInt(hex);
  const eth = Number(wei) / 1e18;
  return eth.toString();
}

// hex wei → wei as plain number string (no precision loss on big numbers)
function hexToWei(hex) {
  if (!hex || hex === '0x') return '0';
  return BigInt(hex).toString();
}

// unix timestamp → ISO string
function hexToDate(hex) {
  if (!hex) return null;
  return new Date(hexToInt(hex) * 1000).toISOString();
}

// decode tx input data into readable form
function decodeInput(input) {
  if (!input || input === '0x') {
    return {
      raw:    '0x',
      type:   'native_transfer',   // plain ETH send, no contract
      method: null,
      params: null
    };
  }

  // First 4 bytes = method selector (function signature hash)
  const methodId = input.slice(0, 10);  // "0x" + 8 chars

  // Common ERC-20 / ERC-721 method selectors
  const knownMethods = {
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    '0x40c10f19': 'mint(address,uint256)',
    '0x42966c68': 'burn(uint256)',
    '0x70a08231': 'balanceOf(address)',
    '0x18160ddd': 'totalSupply()',
    '0xdd62ed3e': 'allowance(address,address)',
    '0x313ce567': 'decimals()',
    '0x06fdde03': 'name()',
    '0x95d89b41': 'symbol()',
    '0x8da5cb5b': 'owner()',
    '0xf2fde38b': 'transferOwnership(address)',
    '0x5c975abb': 'paused()',
    '0x8456cb59': 'pause()',
    '0x3f4ba83a': 'unpause()',
  };

  const methodName = knownMethods[methodId] || 'unknown';

  return {
    raw:      input,
    type:     'contract_call',
    methodId: methodId,
    method:   methodName,
    // raw params after method selector (each param = 32 bytes = 64 hex chars)
    paramsRaw: input.slice(10)
  };
}


// ── Add to environment config ────────────────────────────────
const TESSERA_URL = process.env.TESSERA_URL || "http://tessera1:9081";  // e.g. http://tessera1:9081

// ── Tessera detection ────────────────────────────────────────
function isPrivateTransaction(tx) {
  const markerAddr = '0x000000000000000000000000000000000000007e';
  const v = parseInt(tx.v || '0x0', 16);

  // Normalize values
  const toAddr = (tx.to || '').toLowerCase();
  const input = tx.input || '';
  const len = input.length;

  // Common indicators of a private transaction:
  // - v = 37 or 38 (privacy chain ids)
  // - to = privacy marker contract (0x...7e)
  // - input length matching common enclave/key encodings (observed values include 130/132 and short marker inputs 66/68)
  const likelyEnclaveInput = (len === 130 || len === 132 || len === 66 || len === 68);

  return v === 37 || v === 38 || toAddr === markerAddr || likelyEnclaveInput;
}

// ── Fetch private receipt from besu priv_ API ────────────────
async function fetchPrivateReceipt(txHash) {
  try {
    const receipt = await rpc('priv_getTransactionReceipt', [txHash]);
    if (!receipt) return { accessible: false };

    return {
      accessible:     true,
      privacyGroupId: receipt.privacyGroupId,
      status:         receipt.status === '0x1' ? 'success' : 'failed',
      output:         receipt.output,
      logs:           receipt.logs || [],
      gasUsed:        parseInt(receipt.gasUsed || '0x0', 16),
    };
  } catch {
    return { accessible: false };
  }
}

// ── Fetch raw payload from Tessera ThirdParty API ────────────
async function fetchTesseraPayload(enclaveKey) {
  if (!TESSERA_URL) return null;

  try {
    // Tessera ThirdParty API returns raw payload
    const res = await fetch(
      `${TESSERA_URL}/transaction/${encodeURIComponent(enclaveKey)}`
    );
    if (!res.ok) return null;

    const json = await res.json();
    // payload is base64 encoded — decode to hex for ABI decoding
    const payloadHex = '0x' + Buffer.from(json.payload, 'base64').toString('hex');

    return {
      raw:     json.payload,
      hex:     payloadHex,
      decoded: decodeInput(payloadHex)  // run through normal ABI decoder
    };
  } catch {
    return null;
  }
}


// ── Decode a raw Besu transaction ────────────────────────────
async function decodeTx(tx, blockTimestamp) {
  const isPrivate = isPrivateTransaction(tx);

  let inputDecoded;
  let privateData = null;

  if (isPrivate) {
    // Step 1: try priv_ receipt (gets logs + status)
    const receipt = await fetchPrivateReceipt(tx.hash);

    // Step 2: try Tessera directly (gets raw calldata)
    const tesseraPayload = await fetchTesseraPayload(tx.input);

    privateData = {
      accessible:     receipt.accessible,
      privacyGroupId: receipt.privacyGroupId || null,
      status:         receipt.status || null,
      logs:           receipt.logs   || [],
      gasUsed:        receipt.gasUsed || 0,
      payload:        tesseraPayload  || null,
    };
    inputDecoded = {
      raw:         tx.input,
      type:        'private_transaction',
      enclaveKey:  tx.input,
      decoded:     false,
      privateData: privateData,
    };

    // If Tessera gave us the payload, fully decode it
    if (tesseraPayload?.decoded) {
      inputDecoded.decoded      = true;
      inputDecoded.method       = tesseraPayload.decoded.method;
      inputDecoded.methodId     = tesseraPayload.decoded.methodId;
      inputDecoded.args         = tesseraPayload.decoded.args;
    }

  } else {
    inputDecoded = decodeInput(tx.input);
  }

  // const input = decodeInput(tx.input);

  return {
    hash:             tx.hash,
    blockHash:        tx.blockHash,
    blockNumber:      hexToInt(tx.blockNumber),
    from:             tx.from?.toLowerCase(),
    to:               tx.to?.toLowerCase(),
    isContractDeploy: tx.to === null,
    isPrivate:        isPrivate,
    valueWei:         hexToWei(tx.value),
    valueEth:         hexToEth(tx.value),
    gas:              hexToInt(tx.gas),
    gasPrice:         hexToWei(tx.gasPrice || '0x0'),
    nonce:            hexToInt(tx.nonce),
    transactionIndex: hexToInt(tx.transactionIndex),
    input:            inputDecoded,
    timestamp:        hexToInt(blockTimestamp),
    timestampISO:     hexToDate(blockTimestamp),
    type:             hexToInt(tx.type || '0x0'),
  };
}

// ── Parse QBFT extraData ─────────────────────────────────────

async function decodeExtraData(extraData) {
  if (!extraData || extraData === '0x') return null;

  try {
    const hex = extraData.slice(2); // remove 0x
    let pos = 0;

    // ── Skip outer RLP list prefix ──────────────────────────
    const b0 = parseInt(hex.slice(pos, pos + 2), 16);
    if (b0 === 0xf9) {
      pos += 6;                          // f9 + 2 length bytes
    } else if (b0 === 0xf8) {
      pos += 4;                          // f8 + 1 length byte
    } else if (b0 >= 0xc0) {
      pos += 2;                          // short list
    }

    // ── Skip 32-byte vanity ─────────────────────────────────
    // a0 = RLP prefix for 32-byte string
    pos += 2;   // skip a0
    pos += 64;  // skip 32 bytes = 64 hex chars

    // ── Read validator list ─────────────────────────────────
    const validators = [];

    const vb = parseInt(hex.slice(pos, pos + 2), 16);
    let valListLen = 0;

    if (vb === 0xf9) {
      valListLen = parseInt(hex.slice(pos + 2, pos + 6), 16);
      pos += 6;
    } else if (vb === 0xf8) {
      valListLen = parseInt(hex.slice(pos + 2, pos + 4), 16);
      pos += 4;
    } else if (vb >= 0xc0) {
      valListLen = vb - 0xc0;
      pos += 2;
    }

    // Each validator entry = 1 byte prefix (94) + 20 bytes address
    // = 2 hex chars prefix + 40 hex chars address = 42 hex chars total
    const valEnd = pos + valListLen * 2;
    while (pos < valEnd && pos < hex.length) {
      const prefix = parseInt(hex.slice(pos, pos + 2), 16);
      if (prefix !== 0x94) break;       // 0x94 = RLP prefix for 20-byte value
      pos += 2;                          // skip 94
      validators.push('0x' + hex.slice(pos, pos + 40));
      pos += 40;                         // exactly 40 hex = 20 bytes
    }

    // ── Read round ──────────────────────────────────────────
    // c0 = empty list = round 0
    // c1 = round 1, etc
    const roundByte = parseInt(hex.slice(pos, pos + 2), 16);
    let round = 0;
    if (roundByte === 0xc0) {
      round = 0;
      pos += 2;
    } else if (roundByte >= 0xc1 && roundByte <= 0xf7) {
      // Short RLP list with round number inside
      pos += 2;
      round = parseInt(hex.slice(pos, pos + 2), 16);
      pos += 2;
    }

    // ── Read commit seals list ──────────────────────────────
    let sealCount = 0;

    if (pos < hex.length) {
      const sb = parseInt(hex.slice(pos, pos + 2), 16);
      let sealListLen = 0;

      if (sb === 0xf9) {
        sealListLen = parseInt(hex.slice(pos + 2, pos + 6), 16);
        pos += 6;
      } else if (sb === 0xf8) {
        sealListLen = parseInt(hex.slice(pos + 2, pos + 4), 16);
        pos += 4;
      } else if (sb >= 0xc0) {
        sealListLen = sb - 0xc0;
        pos += 2;
      }

      // Each seal = b841 (2 bytes prefix) + 65 bytes signature
      // = 4 hex chars prefix + 130 hex chars = 134 hex chars total
      const sealEnd = pos + sealListLen * 2;
      while (pos < sealEnd && pos < hex.length) {
        const sp = hex.slice(pos, pos + 4);
        if (sp === 'b841') {
          sealCount++;
          pos += 4 + 130;  // b841 + 65 bytes
        } else {
          break;
        }
      }
    }

    const quorum = Math.floor((2 * validators.length) / 3) + 1;

    return {
      validators,
      validatorCount: validators.length,
      round,
      // commitSeals:    sealCount,
      // quorumReached:  sealCount >= quorum,
      // quorumRequired: quorum
    };

  } catch (err) {
    // Fallback — return raw so we never lose data
    return {
      raw:        extraData,
      parseError: err.message
    };
  }
}

// ── Updated decodeBlock ──────────────────────────────────────

async function decodeBlock(block) {
  const extraDataDecoded = await decodeExtraData(block.extraData);

  const transactions = await Promise.all(
    (block.transactions || []).map(tx => decodeTx(tx, block.timestamp))
  )

  return {
    hash:             block.hash,
    parentHash:       block.parentHash,
    number:           hexToInt(block.number),
    timestamp:        hexToInt(block.timestamp),
    timestampISO:     hexToDate(block.timestamp),
    miner:            block.miner?.toLowerCase(),
    gasLimit:         hexToInt(block.gasLimit),
    gasUsed:          hexToInt(block.gasUsed),
    gasUsedPercent:   block.gasLimit !== '0x0'
                        ? ((hexToInt(block.gasUsed) / hexToInt(block.gasLimit)) * 100).toFixed(2)
                        : '0',
    size:             hexToInt(block.size),
    transactions,
    transactionCount: block.transactions.length,
    extraData:        extraDataDecoded,
  };
}

// ── RPC helper ───────────────────────────────────────────────
async function rpc(method, params = []) {
  const res = await fetch(BESU_RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ── Store decoded block in Redis ─────────────────────────────
async function storeBlock(rawBlock) {
  const block    = await decodeBlock(rawBlock);
  const pipeline = redis.pipeline();

  // Full decoded block
  pipeline.set(`block:${block.number}`, JSON.stringify(block));
  pipeline.set(`blockhash:${block.hash}`, JSON.stringify(block));

  // Sorted set for range queries (score = block number)
  pipeline.zadd('blocks', block.number, block.hash);

  // Latest block
  pipeline.set('latest_block', JSON.stringify(block));

  // Each transaction decoded and stored individually
  for (const tx of block.transactions) {
    pipeline.set(`tx:${tx.hash}`, JSON.stringify(tx));

    // Index by sender
    pipeline.lpush(`addr:${tx.from}:txs`, tx.hash);

    // Index by receiver
    if (tx.to) {
      pipeline.lpush(`addr:${tx.to}:txs`, tx.hash);
    }

    // Index by method (e.g. all transfer() calls)
    if (tx.input.methodId) {
      pipeline.lpush(`method:${tx.input.methodId}:txs`, tx.hash);
    }
  }

  // Stats
  pipeline.incr('stats:total_blocks');
  pipeline.incrby('stats:total_transactions', block.transactions.length);

  await pipeline.exec();

  console.log(
    `[Block #${block.number}] ${block.timestampISO}` +
    ` txs=${block.transactionCount}` +
    ` gasUsed=${block.gasUsedPercent}%` +
    ` miner=${block.miner?.slice(0, 10)}...`
  );
}

// ── Main poll loop ───────────────────────────────────────────
async function poll() {
  try {
    const rawBlock = await rpc('eth_getBlockByNumber', ['latest', true]);
    if (!rawBlock) return;

    const blockNum = hexToInt(rawBlock.number);

    if (blockNum > lastBlockNumber) {
      // Backfill missed blocks on restart
      if (lastBlockNumber > 0 && blockNum > lastBlockNumber + 1) {
        console.log(`Backfilling blocks ${lastBlockNumber + 1} → ${blockNum - 1}`);
        for (let i = lastBlockNumber + 1; i < blockNum; i++) {
          const missed = await rpc('eth_getBlockByNumber', [`0x${i.toString(16)}`, true]);
          if (missed) await storeBlock(missed);
        }
      }

      await storeBlock(rawBlock);
      lastBlockNumber = blockNum;
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

// ── Startup ──────────────────────────────────────────────────
async function start() {
  console.log(`Besu RPC : ${BESU_RPC_URL}`);
  console.log(`Redis    : ${REDIS_URL}`);
  console.log(`Interval : ${POLL_INTERVAL}ms`);

  const lastStored = await redis.zrange('blocks', -1, -1, 'WITHSCORES');
  if (lastStored.length > 0) {
    lastBlockNumber = parseInt(lastStored[1]);
    console.log(`Resuming from block #${lastBlockNumber}`);
  }

  setInterval(poll, POLL_INTERVAL);
  poll();
}

redis.on('connect', () => console.log('Redis connected ✓'));
redis.on('error',   (e) => console.error('Redis error:', e.message));

start();
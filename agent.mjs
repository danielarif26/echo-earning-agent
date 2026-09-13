/**
 * Penniless Agent watcher — safe V1.
 *
 * Runs on GitHub Actions and only READS public/blockchain data:
 *   1) receive-only Base USDC balance (optional public address)
 *   2) receive-only Solana USDC + SOL balances (optional public address)
 *   3) Superteam agent listings (optional API key)
 *   4) authored GitHub PR state
 *
 * No private keys, seed phrases, spend permissions, bids, submissions, or signups.
 */
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

const now = new Date().toISOString()
const runContext = process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'local/manual run'
const EVM_WALLET = (process.env.EVM_WALLET || '').trim()
const SOL_WALLET = (process.env.SOL_WALLET || '').trim()
const GITHUB_LOGIN = (process.env.GITHUB_LOGIN || '').trim()
const EVM_RECEIVER_LABEL = (process.env.EVM_RECEIVER_LABEL || 'Base USDC receiver').trim()
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const skipped = (reason) => ({ skipped: reason })

function validEvmAddress(v) {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

async function baseUsdc() {
  if (!EVM_WALLET) return skipped('no EVM_WALLET repository variable')
  if (!validEvmAddress(EVM_WALLET)) return { error: 'invalid EVM_WALLET format' }

  const rpcUrls = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com']
  let lastError = 'all Base RPCs failed'
  for (const rpc of rpcUrls) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{
            to: BASE_USDC,
            data: '0x70a08231000000000000000000000000' + EVM_WALLET.slice(2),
          }, 'latest'],
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) {
        lastError = `${rpc} HTTP ${r.status}`
        continue
      }
      const j = await r.json()
      if (!j?.result) {
        lastError = j?.error?.message || `${rpc} returned no result`
        continue
      }
      return { amount: Number(BigInt(j.result)) / 1e6 }
    } catch (e) {
      lastError = e.message
    }
  }
  return { error: lastError }
}

async function baseRpc(method, params) {
  const rpcUrls = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com']
  let lastError = 'all Base RPCs failed'
  for (const rpc of rpcUrls) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) {
        lastError = `${rpc} HTTP ${r.status}`
        continue
      }
      const j = await r.json()
      if (j?.error) {
        lastError = j.error.message || `${rpc} RPC error`
        continue
      }
      if (j?.result == null) {
        lastError = `${rpc} returned no result`
        continue
      }
      return { result: j.result }
    } catch (e) {
      lastError = e.message
    }
  }
  return { error: lastError }
}

async function baseIncomingTransfers(previousToBlock) {
  if (!EVM_WALLET) return skipped('no EVM_WALLET repository variable')
  if (!validEvmAddress(EVM_WALLET)) return { error: 'invalid EVM_WALLET format' }

  const head = await baseRpc('eth_blockNumber', [])
  if (head.error) return { error: head.error }
  const latest = Number(BigInt(head.result))
  // Stay a few blocks behind the tip to reduce reorg/noise risk.
  const target = Math.max(0, latest - 12)
  // On first activation, look back ~12k Base blocks (~hours), enough to cover setup gaps.
  let from = Number.isFinite(previousToBlock) ? previousToBlock + 1 : Math.max(0, target - 12000)
  if (from > target) return { amount: 0, events: [], fromBlock: from, toBlock: target }

  const recipientTopic = `0x${EVM_WALLET.slice(2).toLowerCase().padStart(64, '0')}`
  const events = []
  let amount = 0
  let lastScanned = from - 1

  // Base recommends keeping eth_getLogs ranges under 2,000 blocks.
  for (let chunkStart = from; chunkStart <= target; chunkStart += 1900) {
    const chunkEnd = Math.min(target, chunkStart + 1899)
    const q = await baseRpc('eth_getLogs', [{
      fromBlock: `0x${chunkStart.toString(16)}`,
      toBlock: `0x${chunkEnd.toString(16)}`,
      address: BASE_USDC,
      topics: [ERC20_TRANSFER_TOPIC, null, recipientTopic],
    }])
    if (q.error) {
      return {
        error: q.error,
        amount,
        events,
        fromBlock: from,
        toBlock: lastScanned,
        targetBlock: target,
      }
    }
    for (const log of q.result) {
      if (log?.removed) continue
      const value = Number(BigInt(log.data || '0x0')) / 1e6
      amount += value
      events.push({
        tx: log.transactionHash,
        logIndex: Number(BigInt(log.logIndex || '0x0')),
        block: Number(BigInt(log.blockNumber || '0x0')),
        amount: value,
      })
    }
    lastScanned = chunkEnd
  }

  return { amount, events, fromBlock: from, toBlock: lastScanned }
}

async function solanaBalances() {
  if (!SOL_WALLET) return skipped('no SOL_WALLET repository variable')
  try {
    const rpc = 'https://api.mainnet-beta.solana.com'
    const [tokensResp, solResp] = await Promise.all([
      fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
          params: [
            SOL_WALLET,
            { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
            { encoding: 'jsonParsed' },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      }),
      fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'getBalance', params: [SOL_WALLET],
        }),
        signal: AbortSignal.timeout(15000),
      }),
    ])
    const tokens = await tokensResp.json()
    const sol = await solResp.json()
    if (tokens?.error || sol?.error) {
      return { error: tokens?.error?.message || sol?.error?.message || 'Solana RPC error' }
    }
    const usdc = (tokens?.result?.value ?? []).reduce(
      (sum, a) => sum + (Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0),
      0,
    )
    return { usdc, sol: (sol?.result?.value ?? 0) / 1e9 }
  } catch (e) {
    return { error: e.message }
  }
}

async function superteamLive() {
  const key = process.env.SUPERTEAM_API_KEY
  if (!key) return skipped('no SUPERTEAM_API_KEY repository secret')
  try {
    const r = await fetch('https://superteam.fun/api/agents/listings/live?take=50', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    const items = Array.isArray(d) ? d : d.result || []
    const open = items
      .filter((l) => (l.deadline || '9999') > now)
      .map((l) => ({
        slug: l.slug,
        type: l.type,
        reward: l.rewardAmount,
        token: l.token,
        access: l.agentAccess,
        deadline: (l.deadline || '').slice(0, 10),
      }))
      .sort((a, b) =>
        (b.access === 'AGENT_ONLY' ? 1 : 0) - (a.access === 'AGENT_ONLY' ? 1 : 0)
        || (b.reward || 0) - (a.reward || 0),
      )
    return { total: items.length, open }
  } catch (e) {
    return { error: e.message }
  }
}

async function githubPrs() {
  if (!GITHUB_LOGIN) return skipped('no GitHub login supplied by workflow')
  try {
    const q = encodeURIComponent(`author:${GITHUB_LOGIN} type:pr is:public`)
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'penniless-agent-watcher' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const r = await fetch(`https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=30`, {
      headers,
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return { error: `HTTP ${r.status}` }
    const d = await r.json()
    const prs = (d.items || []).map((p) => ({
      repo: (p.repository_url || '').split('/').pop(),
      num: p.number,
      title: (p.title || '').slice(0, 80),
      state: p.state,
      url: p.html_url,
      merged: Boolean(p.pull_request?.merged_at),
      updatedAt: p.updated_at,
    }))
    return { total: prs.length, merged: prs.filter((p) => p.merged).length, prs }
  } catch (e) {
    return { error: e.message }
  }
}

function historySnapshots() {
  try {
    const lines = readFileSync(new URL('./history.jsonl', import.meta.url), 'utf8')
      .split('\n')
      .filter(Boolean)
    const snapshots = []
    for (const line of lines) {
      try { snapshots.push(JSON.parse(line)) } catch {}
    }
    return snapshots
  } catch {
    return []
  }
}

function moneyValue(obj, key = 'amount') {
  const value = obj?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function latestNumeric(history, getter) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const value = getter(history[i])
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

const history = historySnapshots()
const previousBaseTransferBlock = latestNumeric(history, (s) => moneyValue(s?.baseTransfers, 'toBlock'))
const base = await baseUsdc()
const baseTransfers = await baseIncomingTransfers(previousBaseTransferBlock)
const solana = await solanaBalances()
const superteam = await superteamLive()
const github = await githubPrs()

const baseNow = moneyValue(base)
const basePrev = latestNumeric(history, (s) => moneyValue(s?.base))
const solUsdcNow = moneyValue(solana, 'usdc')
const solUsdcPrev = latestNumeric(history, (s) => moneyValue(s?.solana, 'usdc'))
const solNow = moneyValue(solana, 'sol')
const solPrev = latestNumeric(history, (s) => moneyValue(s?.solana, 'sol'))

const baseDelta = baseNow != null && basePrev != null ? baseNow - basePrev : 0
const solUsdcDelta = solUsdcNow != null && solUsdcPrev != null ? solUsdcNow - solUsdcPrev : 0
const solDelta = solNow != null && solPrev != null ? solNow - solPrev : 0
const baseIncoming = moneyValue(baseTransfers) ?? 0
const historicalBaseIncoming = history.reduce((sum, snap) => sum + (moneyValue(snap?.baseTransfers) ?? 0), 0)
const baseObservedTotal = historicalBaseIncoming + baseIncoming

let seen = []
try {
  const parsed = JSON.parse(readFileSync(new URL('./seen-listings.json', import.meta.url), 'utf8'))
  if (Array.isArray(parsed)) seen = parsed
} catch {}
const openSlugs = (superteam.open || []).map((o) => o.slug).filter(Boolean)
const newListings = openSlugs.filter((s) => !seen.includes(s))
writeFileSync(
  new URL('./seen-listings.json', import.meta.url),
  JSON.stringify([...new Set([...seen, ...openSlugs])]),
)

const snapshot = {
  ts: now,
  receiver: { label: EVM_RECEIVER_LABEL, network: 'Base', asset: 'USDC', address: EVM_WALLET || null },
  base,
  baseTransfers,
  baseObservedTotal,
  solana,
  baseDelta,
  solUsdcDelta,
  solDelta,
  superteam,
  github,
  newListings,
}
appendFileSync(new URL('./history.jsonl', import.meta.url), JSON.stringify(snapshot) + '\n')
writeFileSync(new URL('./status.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n')

const renderBase = base.skipped ? base.skipped : base.error ? `error: ${base.error}` : `${base.amount} USDC`
const renderSol = solana.skipped
  ? solana.skipped
  : solana.error
    ? `error: ${solana.error}`
    : `${solana.usdc} USDC · ${solana.sol} SOL`

const listingLines = superteam.skipped
  ? `_scan skipped: ${superteam.skipped}_`
  : superteam.error
    ? `_scan error: ${superteam.error}_`
    : superteam.open?.length
      ? superteam.open.map((o) => `- ${o.access === 'AGENT_ONLY' ? '**AGENT_ONLY**' : 'open'} · \`${o.slug}\` — ${o.type || 'listing'} · ${o.reward ?? '?'} ${o.token || ''} · deadline ${o.deadline || 'n/a'}`).join('\n')
      : '_none open right now_'

const prLines = github.skipped
  ? `_${github.skipped}_`
  : github.error
    ? `_error: ${github.error}_`
    : github.prs?.length
      ? github.prs.slice(0, 15).map((p) => `- ${p.merged ? 'merged' : p.state} · [${p.repo}#${p.num}](${p.url}) — ${p.title}`).join('\n')
      : '_no authored PRs found_'

const md = `# Penniless Agent status

_Last run: ${now} (UTC), via ${runContext}._

## Verified money — receive-only wallets
- **Base USDC**${EVM_WALLET ? ` \`${EVM_WALLET}\`` : ''}: **${renderBase}**${baseDelta > 0 ? ` · +${baseDelta.toFixed(6)} received since last run` : ''}
- **Solana**${SOL_WALLET ? ` \`${SOL_WALLET}\`` : ''}: **${renderSol}**${solUsdcDelta > 0 ? ` · +${solUsdcDelta.toFixed(6)} USDC received` : ''}${solDelta > 0 ? ` · +${solDelta.toFixed(9)} SOL received` : ''}

**Receiver:** ${EVM_RECEIVER_LABEL}. Standard Base USDC transfers to the configured address are monitored.

- **USDC received in newly scanned Base transfer events:** **${baseTransfers.error ? `scan error: ${baseTransfers.error}` : `${baseIncoming} USDC`}**
- **Total incoming Base USDC observed since this watcher began tracking transfer events:** **${baseObservedTotal} USDC**

Incoming USDC transfer events are tracked separately from the current address balance, so a custodial exchange sweep cannot erase the receipt record. A merged PR or bounty marked payable is not the same as money received.

## Open agent listings — Superteam
${listingLines}

${newListings.length ? `## New listings since last run\n${newListings.map((s) => `- \`${s}\``).join('\n')}\n` : ''}
## Authored GitHub PRs
${prLines}

---
This watcher is read-only. It does not bid, submit work, create accounts, sign transactions, or move funds.
`
writeFileSync(new URL('./status.md', import.meta.url), md)

const NOTIFY = new URL('./NOTIFY.txt', import.meta.url)
const paymentReceived = baseIncoming > 0 || baseDelta > 0 || solUsdcDelta > 0 || solDelta > 0
if (paymentReceived) {
  const parts = []
  if (baseIncoming > 0) parts.push(`+${baseIncoming.toFixed(6)} Base USDC transfer observed`)
  else if (baseDelta > 0) parts.push(`+${baseDelta.toFixed(6)} Base USDC balance increase`)
  if (solUsdcDelta > 0) parts.push(`+${solUsdcDelta.toFixed(6)} Solana USDC`)
  if (solDelta > 0) parts.push(`+${solDelta.toFixed(9)} SOL`)
  writeFileSync(NOTIFY, `PAYMENT RECEIVED (${now}): ${parts.join(' · ')}\n`)
} else {
  try { unlinkSync(NOTIFY) } catch {}
}

console.log('status:', JSON.stringify(snapshot))
if (paymentReceived) console.log('::notice title=PAYMENT RECEIVED::receive-only wallet balance increased')
if (newListings.length) console.log(`::notice title=NEW LISTINGS::${newListings.join(' | ')}`)

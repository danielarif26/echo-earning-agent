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
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const skipped = (reason) => ({ skipped: reason })

function validEvmAddress(v) {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

async function baseUsdc() {
  if (!EVM_WALLET) return skipped('no EVM_WALLET repository variable')
  if (!validEvmAddress(EVM_WALLET)) return { error: 'invalid EVM_WALLET format' }
  try {
    const r = await fetch('https://mainnet.base.org', {
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
    const j = await r.json()
    if (!j?.result) return { error: j?.error?.message || 'RPC returned no result' }
    return { amount: Number(BigInt(j.result)) / 1e6 }
  } catch (e) {
    return { error: e.message }
  }
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

const base = await baseUsdc()
const solana = await solanaBalances()
const superteam = await superteamLive()
const github = await githubPrs()
const history = historySnapshots()

const baseNow = moneyValue(base)
const basePrev = latestNumeric(history, (s) => moneyValue(s?.base))
const solUsdcNow = moneyValue(solana, 'usdc')
const solUsdcPrev = latestNumeric(history, (s) => moneyValue(s?.solana, 'usdc'))
const solNow = moneyValue(solana, 'sol')
const solPrev = latestNumeric(history, (s) => moneyValue(s?.solana, 'sol'))

const baseDelta = baseNow != null && basePrev != null ? baseNow - basePrev : 0
const solUsdcDelta = solUsdcNow != null && solUsdcPrev != null ? solUsdcNow - solUsdcPrev : 0
const solDelta = solNow != null && solPrev != null ? solNow - solPrev : 0

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
  base,
  solana,
  baseDelta,
  solUsdcDelta,
  solDelta,
  superteam,
  github,
  newListings,
}
appendFileSync(new URL('./history.jsonl', import.meta.url), JSON.stringify(snapshot) + '\n')

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

Only wallet increases are counted here as verified money. A merged PR or bounty marked payable is not the same as money received.

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
const paymentReceived = baseDelta > 0 || solUsdcDelta > 0 || solDelta > 0
if (paymentReceived) {
  const parts = []
  if (baseDelta > 0) parts.push(`+${baseDelta.toFixed(6)} Base USDC`)
  if (solUsdcDelta > 0) parts.push(`+${solUsdcDelta.toFixed(6)} Solana USDC`)
  if (solDelta > 0) parts.push(`+${solDelta.toFixed(9)} SOL`)
  writeFileSync(NOTIFY, `PAYMENT RECEIVED (${now}): ${parts.join(' · ')}\n`)
} else {
  try { unlinkSync(NOTIFY) } catch {}
}

console.log('status:', JSON.stringify(snapshot))
if (paymentReceived) console.log('::notice title=PAYMENT RECEIVED::receive-only wallet balance increased')
if (newListings.length) console.log(`::notice title=NEW LISTINGS::${newListings.join(' | ')}`)

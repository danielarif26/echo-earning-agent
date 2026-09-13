const DATA='https://raw.githubusercontent.com/danielarif26/echo-earning-agent/main/status.json';
const WORKER='https://raw.githubusercontent.com/danielarif26/echo-earning-agent/main/worker-status.json';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString(undefined,{maximumFractionDigits:6}):'—';
const safeUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'?x.href:null}catch{return null}};
const githubUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'&&x.hostname==='github.com'?x.href:null}catch{return null}};
function item(html){const d=document.createElement('div');d.className='item';d.innerHTML=html;return d}
async function loadWorker(){
  try{
    const r=await fetch(`${WORKER}?t=${Date.now()}`,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const w=await r.json();
    const state=String(w.state||w.status||'unknown');
    $('worker-state').textContent=state;
    $('worker-mode').textContent=w.mode||'autonomous';
    $('worker-activity').textContent=w.activity||'No activity reported yet.';
    const links=$('worker-links'); links.replaceChildren();
    for(const [label,key] of [['Task','work_url'],['PR','pr_url'],['Submission','submission_url']]){
      const u=safeUrl(w[key]); if(!u) continue;
      const a=document.createElement('a'); a.href=u; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent=label; links.append(a);
    }
    if(w.potential_reward){const x=document.createElement('span');x.textContent=`Potential reward: ${w.potential_reward}`;links.append(x)}
    if(w.ts){const x=document.createElement('span');x.textContent=`Worker update: ${new Date(w.ts).toLocaleString()}`;links.append(x)}
  }catch(e){$('worker-state').textContent='unavailable';$('worker-activity').textContent='Worker state could not be loaded.'}
}
async function load(){
  const health=$('health');
  try{
    const r=await fetch(`${DATA}?t=${Date.now()}`,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    const base=d.base||{}, transfers=d.baseTransfers||{}, st=d.superteam||{}, gh=d.github||{}, rec=d.receiver||{};
    $('balance').textContent=base.error?'RPC error':`${fmt(base.amount)} USDC`;
    $('received').textContent=`${fmt(d.baseObservedTotal||0)} USDC`;
    $('listing-count').textContent=Array.isArray(st.open)?st.open.length:'—';
    $('pr-count').textContent=Array.isArray(gh.prs)?gh.prs.length:'—';
    $('receiver-label').textContent=rec.label||'Base USDC receiver';
    $('receiver-address').textContent=rec.address||'Not configured';
    $('last-run').textContent=d.ts?new Date(d.ts).toLocaleString():'—';
    const listings=$('listings'); listings.replaceChildren();
    if(Array.isArray(st.open)&&st.open.length){for(const x of st.open.slice(0,12)){listings.append(item(`<b>${esc(x.slug||'listing')}</b><span class="meta">${esc(x.access||'open')} · ${esc(x.reward??'?')} ${esc(x.token||'')} · ${esc(x.deadline||'')}</span>`))}} else listings.innerHTML='<p class="empty">No open agent listings right now.</p>';
    const prs=$('prs'); prs.replaceChildren();
    if(Array.isArray(gh.prs)&&gh.prs.length){for(const p of gh.prs.slice(0,12)){const u=githubUrl(p.url);const label=`${esc(p.repo)}#${esc(p.num)}`;const head=u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label}</a>`:`<b>${label}</b>`;prs.append(item(`${head}<span class="meta">${esc(p.merged?'merged':p.state)} · ${esc(p.title)}</span>`))}} else prs.innerHTML='<p class="empty">No public authored PRs found.</p>';
    const receipts=$('receipts'); receipts.replaceChildren();
    if(Array.isArray(d.recentBaseReceipts)&&d.recentBaseReceipts.length){for(const x of d.recentBaseReceipts){const tx=/^0x[0-9a-f]{64}$/i.test(x.tx||'')?x.tx:null;const head=tx?`<a href="https://basescan.org/tx/${tx}" target="_blank" rel="noopener noreferrer">${fmt(x.amount)} USDC</a>`:`<b>${fmt(x.amount)} USDC</b>`;receipts.append(item(`${head}<span class="meta">block ${esc(x.block)} · token sender ${esc(x.tokenFromType||'unknown')}</span>`))}} else receipts.innerHTML='<p class="empty">No incoming Base USDC transfer observed yet.</p>';
    const age=d.ts?Date.now()-new Date(d.ts).getTime():Infinity;
    const stale=!Number.isFinite(age)||age>90*60*1000;
    const problems=[base.error,transfers.error,st.error,gh.error].filter(Boolean);
    health.textContent=stale?'Watcher stale':problems.length?'Degraded':'Watcher healthy'; health.className=`pill ${(stale||problems.length)?'warn':'ok'}`;
  }catch(e){health.textContent='Dashboard data unavailable';health.className='pill warn'}
  await loadWorker();
}
load(); setInterval(load,60000);

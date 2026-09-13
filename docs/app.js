const DATA='https://raw.githubusercontent.com/danielarif26/echo-earning-agent/main/status.json';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString(undefined,{maximumFractionDigits:6}):'—';
function item(html){const d=document.createElement('div');d.className='item';d.innerHTML=html;return d}
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
    if(Array.isArray(gh.prs)&&gh.prs.length){for(const p of gh.prs.slice(0,12)){prs.append(item(`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.repo)}#${esc(p.num)}</a><span class="meta">${esc(p.merged?'merged':p.state)} · ${esc(p.title)}</span>`))}} else prs.innerHTML='<p class="empty">No public authored PRs found.</p>';
    const problems=[base.error,transfers.error,st.error,gh.error].filter(Boolean);
    health.textContent=problems.length?'Degraded':'Watcher healthy'; health.className=`pill ${problems.length?'warn':'ok'}`;
  }catch(e){health.textContent='Dashboard data unavailable';health.className='pill warn'}
}
load(); setInterval(load,60000);

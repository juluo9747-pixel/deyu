const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const store = {
  get(){ try{return JSON.parse(localStorage.getItem('deyu_data')||'{}')}catch{return{}} },
  set(v){ localStorage.setItem('deyu_data', JSON.stringify(v)) }
};
let DATA = store.get();
function save(){ store.set(DATA); }
function renderAuth(){ const ok=!!DATA.user; $('#loginView').classList.toggle('hidden',ok); $('#appView').classList.toggle('hidden',!ok); $('#logoutBtn').classList.toggle('hidden',!ok); renderResources(); }
$('#loginBtn').onclick=()=>{ const email=$('#email').value.trim(); if(!email) return alert('先填邮箱'); DATA.user={email,loginAt:new Date().toISOString()}; DATA.resources=DATA.resources||[]; DATA.checkins=DATA.checkins||[]; save(); renderAuth(); };
$('#logoutBtn').onclick=()=>{ delete DATA.user; save(); renderAuth(); };
$$('.tabs button').forEach(b=>b.onclick=()=>{ $$('.tabs button').forEach(x=>x.classList.remove('active')); $$('.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $('#'+b.dataset.tab).classList.add('active'); });
async function post(url, body){ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`); return j; }
$('#translateBtn').onclick=async()=>{ const text=$('#translateText').value.trim(); if(!text) return; $('#translateResult').innerHTML='翻译中...'; try{ const dir=$('#direction').value; const r=await post('/api/translate',{text,from:dir==='zh-de'?'zh':'de',to:dir==='zh-de'?'de':'zh'}); $('#translateResult').innerHTML=`<b>结果：</b>\n${esc(r.result||'')}\n\n<span class="pill">${esc(r.provider||'local')}</span>`; }catch(e){ $('#translateResult').innerHTML=`<span class="bad">${esc(e.message)}</span>`; } };
$('#correctBtn').onclick=async()=>{ const text=$('#correctText').value.trim(); if(!text) return; $('#correctResult').innerHTML='批改中...'; try{ const r=await post('/api/correct',{text,level:$('#level').value}); $('#correctResult').innerHTML=`<b>批改结果：</b>\n${esc(r.result||'')}\n\n<span class="pill">${esc(r.provider||'local')}</span>`; }catch(e){ $('#correctResult').innerHTML=`<span class="bad">${esc(e.message)}</span>`; } };
function kind(url){ if(/\.pdf(\?|$)/i.test(url))return'pdf'; if(/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(url))return'audio'; if(/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url))return'video'; return'link'; }
function renderResources(){ const list=DATA.resources||[]; $('#resourceList').innerHTML=list.map((r,i)=>{ const k=kind(r.url); const media=k==='pdf'?`<iframe src="${esc(r.url)}"></iframe>`:k==='audio'?`<audio controls src="${esc(r.url)}"></audio>`:k==='video'?`<video controls src="${esc(r.url)}"></video>`:`<a target="_blank" href="${esc(r.url)}">打开资源</a>`; return `<div class="item"><b>${esc(r.name)}</b><p class="muted">${esc(r.url)}</p>${media}<p><button onclick="delRes(${i})">删除</button></p></div>` }).join('')||'<p class="muted">暂无资源。先添加 PDF/音频/视频 URL。</p>'; }
window.delRes=i=>{ DATA.resources.splice(i,1); save(); renderResources(); };
$('#addResourceBtn').onclick=()=>{ const name=$('#resName').value.trim()||'未命名资源'; const url=$('#resUrl').value.trim(); if(!url)return alert('先填 URL'); DATA.resources=DATA.resources||[]; DATA.resources.unshift({name,url,createdAt:new Date().toISOString()}); save(); renderResources(); $('#resUrl').value=''; };
$('#netdiskListBtn').onclick=async()=>{ $('#netdiskResult').innerHTML='读取中...'; try{ const r=await post('/api/netdisk-list',{dir:$('#netdiskDir').value.trim()||'/'}); $('#netdiskResult').innerHTML=(r.items||[]).map(x=>`<div class="item"><b>${esc(x.name)}</b><p class="muted">${esc(x.path||'')}</p><span class="pill">${esc(x.kind||'file')}</span>${x.previewUrl?`<p><button onclick="addNetdisk('${esc(x.name).replace(/'/g,'&#039;')}','${esc(x.previewUrl).replace(/'/g,'&#039;')}')">加入资源预览</button></p>`:''}</div>`).join('')||'<p class="muted">目录为空，或 token/路径不可用。</p>'; }catch(e){ $('#netdiskResult').innerHTML=`<span class="bad">${esc(e.message)}</span>`; } };
window.addNetdisk=(name,url)=>{ DATA.resources=DATA.resources||[]; DATA.resources.unshift({name,url,createdAt:new Date().toISOString()}); save(); renderResources(); alert('已加入资源区'); };
$('#checkinBtn').onclick=()=>{ DATA.checkins=DATA.checkins||[]; DATA.checkins.unshift({date:new Date().toISOString().slice(0,10),minutes:Number($('#minutes').value||0),note:$('#note').value}); save(); $('#checkinResult').innerHTML='<span class="ok">已保存本地打卡。</span>'; };
$('#exportBtn').onclick=()=>{ const blob=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='deyu-data.json'; a.click(); };
$('#importBtn').onclick=()=>{ try{ DATA=JSON.parse($('#importText').value); save(); renderAuth(); alert('导入成功'); }catch{ alert('JSON 格式不对'); } };
renderAuth();

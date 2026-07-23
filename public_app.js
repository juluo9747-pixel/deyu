let DB = null;
let AUTH = { token: localStorage.getItem('deutsch_token') || '', user: null };
let CHATS = [];
let LAST_NATIVE_REPLY = '';
let CHAT_MODE = 'chat';
let VOCAB = [];
let AI_PROVIDERS = [];
let CHAT_SESSIONS = [];
let ACTIVE_SESSION_ID = localStorage.getItem('deutsch_active_ai_session') || '';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = async (url, data) => {
  const headers = { 'Content-Type':'application/json' };
  if (AUTH.token) headers.Authorization = `Bearer ${AUTH.token}`;
  const res = await fetch(url, data ? { method:'POST', headers, body:JSON.stringify(data) } : { headers });
  const json = await res.json();
  if(!res.ok) throw new Error(json.error || '请求失败');
  return json;
};
const tags = s => String(s||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean);
const ids = s => String(s||'').split(/[,，\s]+/).map(x=>x.trim()).filter(Boolean);

$$('.tabs button').forEach(btn=>btn.onclick=()=>{ $$('.tabs button').forEach(b=>b.classList.remove('active')); $$('.tab').forEach(t=>t.classList.remove('active')); btn.classList.add('active'); $('#'+btn.dataset.tab).classList.add('active'); });

async function refresh(){ DB = await api('/api/db'); render(); }
async function loadNetInfo(){
  try {
    const res = await fetch('/api/netinfo');
    const info = await res.json();
    const el = $('#netInfo');
    if (el) el.innerHTML = (info.urls || []).map(u => `<div><a href="${u}">${u}</a></div>`).join('') || '没有发现局域网地址';
  } catch {}
}
async function refreshAuth(){
  const res = await fetch('/api/auth/me', { headers: AUTH.token ? { Authorization:`Bearer ${AUTH.token}` } : {} });
  const json = await res.json();
  AUTH.user = json.user;
  if (AUTH.user) { $('#authPanel').classList.add('hidden'); $('#appShell').classList.remove('hidden'); }
  else { $('#authPanel').classList.remove('hidden'); $('#appShell').classList.add('hidden'); }
}
function materialById(id){ return DB.materials.find(m=>m.id===id); }
function render(){
  $('#stats').innerHTML = `<b>${DB.courses.length}</b> 门课程<br><b>${DB.questions.length}</b> 道题<br><b>${DB.materials.length}</b> 个资料<br><b>${DB.vocabulary?.length||0}</b> 个单词<br><b>${DB.aiChats?.length||0}</b> 条 AI 对话<br><b>${DB.questions.filter(q=>q.validationErrors?.length).length}</b> 个待修正`;
  $('#recentMaterials').innerHTML = DB.materials.slice(0,8).map(renderMaterial).join('') || '<p class="muted">暂无资料</p>';
  $('#courseList').innerHTML = DB.courses.map(renderCourse).join('') || '<p class="muted">暂无课程</p>';
  renderQuestions();
  renderWrongbook();
  renderGoethe('');
  renderChatHistory();
  renderVocab(DB.vocabulary || []);
  AI_PROVIDERS = DB.settings?.aiProviders || AI_PROVIDERS;
  CHAT_SESSIONS = DB.aiChatSessions || CHAT_SESSIONS;
  renderProviders();
  renderChatSessions();
}
function esc(s){ return String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function meta(arr){ return `<div class="meta">${arr.filter(Boolean).map(x=>`<span class="pill">${esc(x)}</span>`).join('')}</div>`; }
function renderMaterial(m){
  const player = m.kind==='video' ? `<video controls src="${m.path}"></video>` : m.kind==='audio' ? `<audio controls src="${m.path}"></audio>` : `<a href="${m.path}" target="_blank">打开文件</a>`;
  return `<div class="item"><h3>${esc(m.name)}</h3>${meta([m.id,m.kind,m.level,m.category,...(m.tags||[])])}<p class="small">来源：${esc(m.source)} · ${(m.size/1024/1024).toFixed(2)} MB</p>${player}<div class="actions"><button onclick="deleteItem('material','${m.id}')">删除资料</button></div></div>`;
}
function renderCourse(c){
  const mats = (c.materialIds||[]).map(materialById).filter(Boolean).map(m=>`<li>${esc(m.name)} <span class="small">${m.id}</span></li>`).join('');
  return `<div class="item"><h3>${esc(c.title)}</h3>${meta([c.id,c.level,c.category,c.completed?'已完成':'未完成',c.autoCreated?'视频自动归入课程':'',...(c.tags||[])])}<p>${esc(c.description||'')}</p>${mats?`<ul>${mats}</ul>`:''}<div class="actions"><button onclick="generatePractice('${c.id}')">当天课程自动生成练习</button><button onclick="completeCourse('${c.id}')">标记完成并推荐练习</button><button onclick="printCourse('${c.id}')">打印课程讲义/PDF</button><button onclick="openPpt('${c.id}')">生成PPT课件</button><button onclick="deleteItem('course','${c.id}')">删除课程</button></div><div id="rec_${c.id}"></div><div id="gen_${c.id}"></div></div>`;
}
function renderQuestions(){
  const q = ($('#search')?.value||'').toLowerCase(); const lvl = $('#filterLevel')?.value||'';
  const items = DB.questions.filter(x => (!lvl || x.level===lvl) && (!q || JSON.stringify(x).toLowerCase().includes(q)));
  $('#questionList').innerHTML = items.map(renderQuestion).join('') || '<p class="muted">暂无题目</p>';
}
function renderWrongbook(){
  const wrongIds = new Set(DB.attempts.filter(a => !a.correct).map(a => a.questionId));
  const items = DB.questions.filter(q => wrongIds.has(q.id));
  const el = $('#wrongbookList');
  if (!el) return;
  el.innerHTML = items.map(renderQuestion).join('') || '<p class="muted">目前没有错题，继续保持。</p>';
}
function renderQuestion(q){
  const audio = q.audioId ? materialById(q.audioId) : null;
  const bad = q.validationErrors?.length ? `<div>${q.validationErrors.map(e=>`<span class="pill bad">${esc(e)}</span>`).join(' ')}</div>` : '<span class="pill good">校验通过</span>';
  const opts = q.options?.length ? `<ol>${q.options.map(o=>`<li>${esc(o)}</li>`).join('')}</ol>` : '';
  return `<div class="item"><h3>${esc(q.title)}</h3>${meta([q.id,q.type,q.level,q.category,q.source,...(q.tags||[])])}${bad}<p>${esc(q.stem)}</p>${opts}${audio?`<audio controls src="${audio.path}"></audio>`:''}<div class="answer-box"><p><b>答案：</b>${esc(q.answer)}</p><p><b>解析：</b>${esc(q.explanation)}</p></div><div class="actions"><input id="ans_${q.id}" placeholder="输入你的答案"><button onclick="submitAnswer('${q.id}')">提交练习</button><button onclick="analyseEncodedSentence('${encodeURIComponent(q.stem||'')}')">讲透题干</button><button onclick="deleteItem('question','${q.id}')">删除题目</button></div><div id="fb_${q.id}" class="small"></div></div>`;
}
window.deleteItem = async (type,id) => { if(!confirm('确定删除？')) return; await api('/api/delete',{type,id}); await refresh(); await loadVocab(); };
window.completeCourse = async id => { const r = await api('/api/course/complete',{id}); await refresh(); const box = $('#rec_'+id); if(box) box.innerHTML = `<h4>推荐练习</h4>${r.recommended.map(renderQuestion).join('') || '<p class="muted">暂无匹配练习，请给课程和题目添加同类标签。</p>'}`; };
window.generatePractice = async id => { const r = await api('/api/course/practice',{id,count:8}); await refresh(); const box = $('#gen_'+id); if(box) box.innerHTML = `<h4>已生成 ${r.generated.length} 道课后练习</h4>${r.generated.map(renderQuestion).join('')}`; };
window.printCourse = id => { window.open(`/api/course-print?id=${encodeURIComponent(id)}`, '_blank'); };
window.openPpt = id => { window.open(`/api/course-ppt?id=${encodeURIComponent(id)}`, '_blank'); };
window.submitAnswer = async id => { const val = $('#ans_'+id).value; const r = await api('/api/attempt',{questionId:id, answer:val}); $('#fb_'+id).innerHTML = r.attempt.correct ? '✅ 正确' : `❌ 不完全正确。标准答案：${esc(r.question.answer)}；解析：${esc(r.question.explanation)}`; };
window.filterExam = level => { renderGoethe(level); };

function renderGoethe(level){
  const el = $('#goetheList'); if(!el || !DB) return;
  const items = DB.questions.filter(q => (!level || q.level === level) && JSON.stringify(q).includes('歌德'));
  const fallback = DB.questions.filter(q => !level || q.level === level).slice(0, 12);
  el.innerHTML = (items.length ? items : fallback).map(renderQuestion).join('') || '<p class="muted">暂无歌德题。导入题目时标签加“歌德、听力/阅读/写作/口语、A1-B2”。</p>';
}

async function loadChats(){
  if (!AUTH.token) return;
  try {
    const r = await api('/api/ai-chat' + (ACTIVE_SESSION_ID ? `?sessionId=${encodeURIComponent(ACTIVE_SESSION_ID)}` : ''));
    CHATS = r.chats || [];
    renderChatHistory();
  } catch {}
}
async function loadChatSessions(){
  if (!AUTH.token) return;
  try { const r = await api('/api/ai/sessions'); CHAT_SESSIONS = r.sessions || []; if(!ACTIVE_SESSION_ID && CHAT_SESSIONS[0]) ACTIVE_SESSION_ID = CHAT_SESSIONS[0].id; renderChatSessions(); } catch {}
}
function renderChatSessions(){
  const el = $('#chatSessionList'); if(!el) return;
  el.innerHTML = (CHAT_SESSIONS || []).map(s => `<div class="item session-card ${s.id===ACTIVE_SESSION_ID?'active':''}"><h3>${esc(s.title||'AI会话')}</h3><p class="small">${esc(s.updatedAt||s.createdAt||'')}</p>${s.summary?`<p class="small">已压缩摘要</p>`:''}<button type="button" onclick="openChatSession('${s.id}')">打开</button></div>`).join('') || '<p class="muted">暂无历史会话。</p>';
}
window.openChatSession = async id => { ACTIVE_SESSION_ID = id; localStorage.setItem('deutsch_active_ai_session', id); renderChatSessions(); await loadChats(); };
function renderChatHistory(){
  const el = $('#chatHistory'); if (!el) return;
  const source = CHATS.length ? CHATS : (DB?.aiChats || []).filter(x => !AUTH.user || x.userId === AUTH.user.id).slice(0, 30);
  if (!source.length) { el.innerHTML = '<p class="muted">暂无 AI 对话。输入一句德语，系统会在本网站内直接纠错、解释、发音。</p>'; return; }
  el.innerHTML = source.map(c => {
    const hints = (c.grammarHints || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>没有发现明显基础语法错误。</li>';
    const score = c.score ? `<p><b>口语评分：</b>总分 ${c.score.total} / 100 · 语法 ${c.score.grammar} · 流利度 ${c.score.fluency} · 发音 ${c.score.pronunciation}</p><p class="small">${esc(c.score.note)}</p>` : '';
    const sent = (c.sentenceAnalysis || []).map(s => `<div class="sentence-card"><b>第 ${s.index} 句</b><p>原句：${esc(s.original)}</p><p>修改：${esc(s.corrected)}</p>${s.problems?.length?`<ul>${s.problems.map(esc).map(x=>`<li>${x}</li>`).join('')}</ul>`:''}${s.pronunciation?.length?`<p class="small">发音不足：${s.pronunciation.map(esc).join('；')}</p>`:''}</div>`).join('');
    const pron = (c.pronunciationNotes || []).map(x=>`<li>${esc(x)}</li>`).join('');
    const structure = (c.structureProblems || []).map(x=>`<li>${esc(x)}</li>`).join('') || '<li>结构基本清楚。</li>';
    const writing = c.writingRevision ? `<div class="sentence-card"><b>写作高分改写</b><p>${esc(c.writingRevision.improvedText)}</p>${meta([`内容 ${c.writingRevision.scoreItems.content}`,`结构 ${c.writingRevision.scoreItems.structure}`,`语法 ${c.writingRevision.scoreItems.grammar}`,`词汇 ${c.writingRevision.scoreItems.vocabulary}`])}</div>` : '';
    const shadow = (c.shadowing || []).map(x=>`<li>${esc(x.text)} <span class="small">${esc(x.instruction)}</span> <button type="button" class="speak-btn" data-text="${esc(x.text)}">朗读</button></li>`).join('');
    return `<div class="bubble user-bubble"><b>我：</b>${esc(c.userText || c.text)}</div><div class="bubble ai-bubble"><h3>${esc(c.mode || 'chat')} · ${esc(c.level || '')}</h3>${meta([c.providerName||c.providerId||'本地AI',c.modelUsed,c.aiFallback?'外部失败已兜底':''])}${score}<p><b>母语者表达：</b>${esc(c.nativeReply || '')} <button type="button" class="speak-btn" data-text="${esc(c.nativeReply || '')}">站内朗读</button></p><p><b>纠正：</b>${esc(c.correctedText || c.text)}</p><p><b>语法纠错：</b></p><ul>${hints}</ul><p><b>结构问题：</b></p><ul>${structure}</ul><p><b>发音标注：</b></p><ul>${pron}</ul>${sent}${writing}${shadow?`<div class="sentence-card"><b>跟读训练</b><ol>${shadow}</ol></div>`:''}<p class="small">${esc(c.reply || '')}</p></div>`;
  }).join('');
  $$('.speak-btn').forEach(btn => btn.onclick = () => speakGermanCloud(btn.dataset.text || ''));
  LAST_NATIVE_REPLY = source[0]?.nativeReply || source[0]?.correctedText || '';
}
function speakGerman(text){
  if (!('speechSynthesis' in window)) return alert('当前浏览器不支持朗读。');
  const u = new SpeechSynthesisUtterance(text || 'Ja, gern. Wir üben Deutsch zusammen.');
  u.lang = 'de-DE';
  u.rate = 0.9;
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find(v => /de[-_]DE|German|Deutsch/i.test(`${v.lang} ${v.name}`)) || null;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
window.speakGermanText = speakGerman;

function renderProviders(){
  const select = $('#chatProvider');
  if (select) select.innerHTML = '<option value="auto">自动调度：语法DeepSeek/对话豆包/写作通义/语音讯飞</option>' + ((AI_PROVIDERS || []).filter(p=>p.enabled).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.model || p.type)}</option>`).join('') || '<option value="local-rule">本地规则模型</option>');
  const list = $('#providerList'); if(!list) return;
  list.innerHTML = (AI_PROVIDERS || []).map(p => `<div class="item"><h3>${esc(p.name)}</h3>${meta([p.id,p.type,p.model,p.enabled?'启用':'停用',p.hasApiKey?'已保存Key':'无Key'])}<p class="small">Base URL：${esc(p.baseUrl||'本地')}</p>${p.lastOkAt?`<p class="small good-text">上次可用：${esc(p.lastOkAt)}</p>`:''}${p.lastError?`<p class="small bad-text">错误：${esc(p.lastError)}</p>`:''}<div class="actions"><button type="button" onclick="fillProvider('${esc(p.id)}')">编辑</button><button type="button" onclick="testProvider('${esc(p.id)}')">测试</button></div></div>`).join('') || '<p class="muted">暂无模型配置。</p>';
}
async function loadProviders(){
  if(!AUTH.token) return;
  try { const r = await api('/api/ai/providers'); AI_PROVIDERS = r.providers || []; renderProviders(); } catch {}
}
window.fillProvider = id => {
  const p = AI_PROVIDERS.find(x=>x.id===id); if(!p) return;
  $('#providerId').value = p.id; $('#providerName').value = p.name; $('#providerType').value = p.type; $('#providerBaseUrl').value = p.baseUrl || ''; $('#providerModel').value = p.model || ''; $('#providerEnabled').value = String(Boolean(p.enabled)); $('#providerApiKey').value = '';
};
window.testProvider = async id => { const r = await api('/api/ai/test',{ providerId:id }); alert(r.ok ? `模型可用：${r.provider.name}` : `模型不可用：${r.error}`); await loadProviders(); };

function renderVocab(items){
  const el = $('#vocabList'); if(!el) return;
  const q = ($('#vocabSearch')?.value || '').toLowerCase();
  const arr = (items || VOCAB || []).filter(v => !q || JSON.stringify(v).toLowerCase().includes(q));
  el.innerHTML = arr.map(v => `<div class="item vocab-card"><h3>${esc(v.article ? v.article + ' ' : '')}${esc(v.word)}</h3>${meta([v.level,v.pos,`掌握度 ${v.mastery||0}%`,v.source])}<p><b>中文：</b>${esc(v.meaning)}</p>${v.plural?`<p><b>复数：</b>${esc(v.plural)}</p>`:''}<p><b>语法/搭配：</b>${esc(v.grammar||'')}</p>${(v.examples||[]).length?`<p><b>例句：</b>${(v.examples||[]).map(esc).join(' / ')}</p>`:''}<div class="actions"><button type="button" onclick="speakGermanText('${esc(String(v.word).replace(/'/g,'&#039;'))}')">发音</button><button type="button" onclick="lookupWordDirect('${esc(String(v.word).replace(/'/g,'&#039;'))}')">查透</button><button type="button" onclick="deleteItem('vocabulary','${v.id}')">删除</button></div></div>`).join('') || '<p class="muted">暂无单词。可以手动添加，或粘贴词汇书/课文自动提取。</p>';
}
async function loadVocab(){
  if(!AUTH.token) return;
  try { const r = await api('/api/vocabulary?q=' + encodeURIComponent($('#vocabSearch')?.value || '')); VOCAB = r.items || []; renderVocab(VOCAB); } catch {}
}
function renderLookupResult(r){
  const el = $('#lookupResult'); if(!el) return;
  if(r.words){
    el.innerHTML = `<div class="item"><h3>句子整体理解</h3><p>${esc(r.text)}</p><p><b>语法：</b>${(r.grammarHints||[]).map(esc).join('；') || '没有明显基础错误'}</p><p><b>结构：</b>${(r.structureProblems||[]).map(esc).join('；') || '结构基本清楚'}</p><p><b>发音：</b>${(r.pronunciationNotes||[]).map(esc).join('；')}</p><button type="button" onclick="speakGermanText('${esc(String(r.text).replace(/'/g,'&#039;'))}')">朗读整句</button></div>` + r.words.map(w => renderWordExplain(w)).join('');
  } else el.innerHTML = renderWordExplain(r.result || r);
}
function renderWordExplain(w){
  return `<div class="item vocab-card"><h3>${esc(w.article ? w.article + ' ' : '')}${esc(w.word)}</h3>${meta([w.level,w.pos,w.known?'已收录':'未收录'])}<p><b>中文意思：</b>${esc(w.meaning)}</p>${w.plural?`<p><b>复数：</b>${esc(w.plural)}</p>`:''}<p><b>语法/搭配：</b>${esc(w.grammar||'')}</p>${(w.examples||[]).length?`<p><b>例句：</b>${(w.examples||[]).map(esc).join(' / ')}</p>`:''}<div class="actions"><button type="button" onclick="speakGermanText('${esc(String(w.word).replace(/'/g,'&#039;'))}')">单词发音</button>${(w.examples||[])[0]?`<button type="button" onclick="speakGermanText('${esc(String(w.examples[0]).replace(/'/g,'&#039;'))}')">例句发音</button>`:''}</div></div>`;
}
window.lookupWordDirect = async word => { const r = await api('/api/lookup',{word}); renderLookupResult(r); speakGermanCloud(r.result.word); $$('.tabs button').find(b=>b.dataset.tab==='lookup')?.click(); };
window.analyseThisSentence = async text => { const r = await api('/api/sentence-analyse',{text}); renderLookupResult(r); $$('.tabs button').find(b=>b.dataset.tab==='lookup')?.click(); };
window.analyseEncodedSentence = code => window.analyseThisSentence(decodeURIComponent(code || ''));


function parseNetdiskItems(){
  const raw = $('#netdiskItems')?.value.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.items || []);
}
function netdiskPayload(){
  const items = parseNetdiskItems();
  return { accessToken: $('#baiduToken')?.value.trim(), dir: $('#baiduDir')?.value.trim() || '/', limit: Number($('#baiduLimit')?.value || 1000), ...(items ? { items } : {}) };
}
function renderNetdiskItems(items){
  const el = $('#netdiskPreview'); if(!el) return;
  el.innerHTML = (items || []).map(x => {
    const c = x.classify || x;
    return `<div class="item"><h3>${esc(c.name || x.name || x.path)}</h3>${meta([c.level,c.kind,c.category,`置信 ${(Number(c.confidence||0)*100).toFixed(0)}%`,...(c.tags||[])])}<p class="small">网盘路径：${esc(x.path || x.remotePath || '')}</p><p class="small">${esc(c.reason || '')}</p></div>`;
  }).join('') || '<p class="muted">暂无预览。可以填 token 读取百度网盘目录，或粘贴目录 JSON。</p>';
}
function renderIssues(items){
  const el = $('#issueList'); if(!el) return;
  el.innerHTML = (items || []).map(q => `<div class="item"><h3>${esc(q.title)}</h3>${meta([q.id,q.type,q.level,q.category])}<div>${(q.validationErrors||[]).map(e=>`<span class="pill bad">${esc(e)}</span>`).join(' ')}</div><p class="small">source：${esc(q.source || '')}</p>${q.sourceImage?`<p class="small">PDF原文截图：${esc(q.sourceImage)}</p>`:''}</div>`).join('') || '<p class="muted">目前没有异常习题，小虾先鼓掌三秒 🦐</p>';
}
async function loadIssues(){
  try { const r = await api('/api/question-issues'); renderIssues(r.items || []); return r; } catch(e){ const el=$('#issueList'); if(el) el.innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; }
}
async function speakGermanCloud(text){
  try {
    const r = await api('/api/tts',{ text, voice:'de-DE-KatjaNeural' });
    if (r.ok && r.audioBase64) {
      const audio = new Audio(`data:${r.mime || 'audio/mpeg'};base64,${r.audioBase64}`);
      await audio.play(); return;
    }
  } catch {}
  speakGerman(text);
}
function renderResource(m){
  const url = m.viewUrl || m.remoteUrl || m.downloadUrl || m.url || m.path || '';
  const pdf = /\.pdf(\?|$)/i.test(url) || /pdf/i.test(m.mime||m.name||'');
  const player = m.kind==='audio' ? `<audio class="speed-audio" controls src="${esc(url)}"></audio><div class="actions"><button type="button" onclick="setAudioRate(this,0.75)">0.75x</button><button type="button" onclick="setAudioRate(this,1)">1x</button><button type="button" onclick="setAudioRate(this,1.25)">1.25x</button><button type="button" onclick="setAudioRate(this,1.5)">1.5x</button></div>` : m.kind==='video' ? `<video controls src="${esc(url)}"></video>` : pdf ? `<iframe class="pdf-frame" src="${esc(url)}"></iframe><p><a target="_blank" href="${esc(url)}">新窗口打开 PDF</a></p>` : `<a target="_blank" href="${esc(url)}">打开资源</a>`;
  return `<div class="item"><h3>${esc(m.name)}</h3>${meta([m.id,m.kind,m.level,m.category,m.remoteProvider,...(m.tags||[])])}<p class="small">${esc(url || m.remotePath || '')}</p>${url ? player : '<p class="muted">暂无可直接预览 URL：可上传到免费 OSS 后填入 remoteUrl/url，或使用本地上传路径。</p>'}</div>`;
}
window.setAudioRate = (btn, rate) => { const a = btn.closest('.item')?.querySelector('audio'); if(a){ a.playbackRate = rate; a.play(); } };
async function loadResources(){
  const kind = $('#resourceKind')?.value || '';
  const r = await api('/api/resources' + (kind ? `?kind=${encodeURIComponent(kind)}` : ''));
  $('#resourceList').innerHTML = (r.items || []).map(renderResource).join('') || '<p class="muted">暂无课件/听力资源。可以先上传文件，或用网盘一键导入。</p>';
}
async function doTranslate(text){
  const dir = $('#transDirection')?.value || 'de-zh';
  const [from,to] = dir === 'zh-de' ? ['ZH','DE'] : ['DE','ZH'];
  const r = await api('/api/translate',{ text, from, to, provider:$('#transProvider')?.value || 'auto' });
  $('#transResult').innerHTML = `<div class="item"><h3>${esc(r.provider || 'translate')}</h3>${meta([r.detectedSourceLanguage, r.fallback?'本地兜底':'真实API'])}<p>${esc(r.translatedText)}</p>${r.note?`<p class="small">${esc(r.note)}</p>`:''}</div>`;
}
function renderCorrection(r){
  const hints = (r.grammarHints || []).map(x=>`<li>${esc(x)}</li>`).join('') || '<li>没有发现明显基础语法问题。</li>';
  const structure = (r.structureProblems || []).map(x=>`<li>${esc(x)}</li>`).join('') || '<li>结构基本清楚。</li>';
  const native = r.nativeReply || r.nativeVersion || r.correctedText || '';
  $('#correctResult').innerHTML = `<div class="item"><h3>批改结果</h3>${meta([r.provider?.name || r.providerName || 'DeepSeek/本地规则', r.fallback?'兜底':'真实API'])}<p><b>更自然表达：</b>${esc(native)} <button type="button" onclick="speakGermanCloud('${esc(String(native).replace(/'/g,'&#039;'))}')">微软/浏览器朗读</button></p><p><b>纠正文本：</b>${esc(r.correctedText || '')}</p><p><b>语法问题：</b></p><ul>${hints}</ul><p><b>结构建议：</b></p><ul>${structure}</ul>${r.note?`<p class="small">${esc(r.note)}</p>`:''}</div>`;
}

$('#uploadForm').onsubmit = async e => { e.preventDefault(); const files = [...$('#file').files]; if(!files.length) return; $('#uploadResult').textContent='读取文件中...'; const items = []; for (const f of files) { const dataUrl = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(f); }); items.push({ name:f.name, dataUrl, kind:$('#kind').value, level:$('#matLevel').value, category:$('#matCategory').value.trim(), source:$('#matSource').value, tags:tags($('#matTags').value) }); } const r = await api('/api/upload/batch',{ items }); $('#uploadResult').textContent = `批量上传成功：${r.materials.length} 个文件；重复自动跳过/删除：${r.deletedDuplicates || 0} 个`; $('#uploadPreview').innerHTML = [...r.materials.map(m=>`<div class="item"><h3>${esc(m.name)}</h3>${meta([m.id,m.kind,m.level,m.category,...(m.tags||[])])}<p class="small">自动归类到：${esc(m.category)}</p></div>`), ...(r.skipped||[]).map(s=>`<div class="item"><h3>${esc(s.name)}</h3><p class="small">重复文件，已跳过。重复于：${esc(s.duplicateOf)}</p></div>`)].join(''); await refresh(); };
$('#courseForm').onsubmit = async e => { e.preventDefault(); await api('/api/course',{ title:$('#courseTitle').value, level:$('#courseLevel').value, category:$('#courseCategory').value, materialIds:ids($('#courseMaterials').value), tags:tags($('#courseTags').value), description:$('#courseDesc').value }); e.target.reset(); await refresh(); };
$('#questionForm').onsubmit = async e => { e.preventDefault(); const r = await api('/api/question',{ title:$('#qTitle').value, stem:$('#qStem').value, type:$('#qType').value, level:$('#qLevel').value, category:$('#qCategory').value, options:$('#qOptions').value.split('\n').map(x=>x.trim()).filter(Boolean), answer:$('#qAnswer').value, explanation:$('#qExplanation').value, audioId:$('#qAudio').value.trim(), source:$('#qSource').value, tags:tags($('#qTags').value)}); alert(r.question.validationErrors?.length ? '已保存，但有待修正：\n'+r.question.validationErrors.join('\n') : '题目已保存，校验通过'); e.target.reset(); await refresh(); };
$('#importBtn').onclick = async () => { try { const data=JSON.parse($('#importText').value); const r=await api('/api/import-json',data); $('#importResult').textContent=`导入 ${r.added} 道题。待修正：${r.questions.filter(q=>q.validationErrors?.length).length}`; await refresh(); } catch(e){ $('#importResult').textContent='导入失败：'+e.message; } };
$('#search').oninput = renderQuestions; $('#filterLevel').onchange = renderQuestions;
$('#makePrompt').onclick = async () => { const r = await api('/api/ai-chat',{mode:$('#aiKind').value, level:$('#aiLevel').value, text:$('#aiInput').value, providerId:$('#chatProvider')?.value || 'auto', sessionId:ACTIVE_SESSION_ID, history:CHATS}); if(r.chat.sessionId){ACTIVE_SESSION_ID=r.chat.sessionId;localStorage.setItem('deutsch_active_ai_session',ACTIVE_SESSION_ID);} CHATS.unshift(r.chat); renderChatHistory(); speakGermanCloud(r.chat.nativeReply); await loadChatSessions(); $('#aiPrompt').textContent = `已用 ${r.chat.providerName || 'AI'} 生成批改并朗读母语者版本。\n\n母语者表达：${r.chat.nativeReply}\n\n逐句纠错：\n${(r.chat.sentenceAnalysis||[]).map(s=>`第${s.index}句：${s.original} -> ${s.corrected}\n问题：${(s.problems||[]).join('；')||'无明显错误'}`).join('\n\n')}\n\n发音标注：\n- ${(r.chat.pronunciationNotes||[]).join('\n- ')}`; };
$('#netSearchBtn').onclick = async () => { const q=$('#netQuery').value.trim(); const r=await api('/api/search?q='+encodeURIComponent(q)); $('#netResults').innerHTML = `<div class="item"><h3>外部搜索入口</h3>${r.webLinks.map(x=>`<p><a target="_blank" href="${x.url}">${esc(x.name)}</a></p>`).join('')}</div><div class="item"><h3>站内课程结果</h3>${r.localCourses.map(renderCourse).join('') || '<p class="muted">没有匹配课程</p>'}</div><div class="item"><h3>站内题库结果</h3>${r.localQuestions.map(renderQuestion).join('') || '<p class="muted">没有匹配题目</p>'}</div>`; };
$$('.mode-tabs button').forEach(btn => btn.addEventListener('click', () => { $$('.mode-tabs button').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); CHAT_MODE = btn.dataset.mode; }));
$('#sendChatBtn')?.addEventListener('click', async () => { try { const r = await api('/api/ai-chat',{ mode:CHAT_MODE, level:$('#chatLevel').value, providerId:$('#chatProvider')?.value || 'auto', sessionId:ACTIVE_SESSION_ID, text:$('#chatInput').value, history:CHATS }); $('#chatInput').value=''; if(r.chat.sessionId){ACTIVE_SESSION_ID=r.chat.sessionId;localStorage.setItem('deutsch_active_ai_session',ACTIVE_SESSION_ID);} CHATS.unshift(r.chat); renderChatHistory(); speakGermanCloud(r.chat.nativeReply); await loadChatSessions(); await refresh(); } catch(e){ alert(e.message); } });
$('#reloadChatBtn')?.addEventListener('click', loadChats);
$('#newChatBtn')?.addEventListener('click', async () => { const r = await api('/api/ai/session',{title:'新的 AI 会话'}); ACTIVE_SESSION_ID = r.session.id; localStorage.setItem('deutsch_active_ai_session', ACTIVE_SESSION_ID); CHATS=[]; await loadChatSessions(); renderChatHistory(); });
$('#compactChatBtn')?.addEventListener('click', async () => { const r = await api('/api/ai/compact',{sessionId:ACTIVE_SESSION_ID}); alert(`已压缩：保留 ${r.kept} 条最近消息`); await loadChatSessions(); await loadChats(); });
$('#speakReplyBtn')?.addEventListener('click', () => speakGermanCloud(LAST_NATIVE_REPLY));
$('#exportChatBtn')?.addEventListener('click', async () => { const text = CHATS.slice(0,20).map(c=>`我：${c.userText||c.text}\n纠正：${c.correctedText||''}\n母语者：${c.nativeReply||''}\n解释：${c.reply||''}`).join('\n\n---\n\n'); await navigator.clipboard.writeText(text); alert('最近聊天记录已复制，可粘贴到微信或文档。'); });
$('#loadPlanBtn')?.addEventListener('click', async () => { const r = await api('/api/plan'); $('#planResult').innerHTML = `<div class="item"><h3>当前状态</h3>${meta([`已完成课程 ${r.stats.completedCourses}`,`资料 ${r.stats.materials}`,`错题 ${r.stats.wrongQuestions}`])}<p><b>今天任务：</b>${r.today.map(esc).join('；')}</p></div>` + r.phases.map(p=>`<div class="item"><h3>${esc(p.month)} · ${esc(p.target)}</h3><p><b>每天：</b>${esc(p.daily)}</p><p><b>阶段目标：</b>${esc(p.exam)}</p></div>`).join(''); });
$('#vocabForm')?.addEventListener('submit', async e => { e.preventDefault(); await api('/api/vocabulary',{ word:$('#vocWord').value, article:$('#vocArticle').value, plural:$('#vocPlural').value, pos:$('#vocPos').value, level:$('#vocLevel').value, meaning:$('#vocMeaning').value, examples:$('#vocExamples').value.split('\n').map(x=>x.trim()).filter(Boolean), grammar:$('#vocGrammar').value, source:'手动添加' }); e.target.reset(); await refresh(); await loadVocab(); });
$('#importVocabBtn')?.addEventListener('click', async () => { const r = await api('/api/vocabulary/import',{ text:$('#vocabImportText').value, level:$('#vocLevel')?.value || 'A1', source:'词汇书/AI提取' }); alert(`已加入 ${r.added.length} 个单词`); $('#vocabImportText').value=''; await refresh(); await loadVocab(); });
$('#reloadVocabBtn')?.addEventListener('click', loadVocab);
$('#vocabSearch')?.addEventListener('input', () => renderVocab(VOCAB.length ? VOCAB : (DB?.vocabulary||[])));
$('#lookupBtn')?.addEventListener('click', async () => { const word=$('#lookupWord').value.trim(); if(!word) return; const r = await api('/api/lookup',{word}); renderLookupResult(r); speakGermanCloud(r.result.word); });
$('#analyseSentenceBtn')?.addEventListener('click', async () => { const text=$('#sentenceInput').value.trim(); if(!text) return; const r = await api('/api/sentence-analyse',{text}); renderLookupResult(r); speakGermanCloud(text); });
$('#aiProviderForm')?.addEventListener('submit', async e => { e.preventDefault(); const provider = { id:$('#providerId').value.trim(), name:$('#providerName').value.trim(), type:$('#providerType').value, baseUrl:$('#providerBaseUrl').value.trim(), model:$('#providerModel').value.trim(), apiKey:$('#providerApiKey').value, enabled:$('#providerEnabled').value === 'true' }; const r = await api('/api/ai/providers',{provider}); AI_PROVIDERS = r.providers || []; $('#providerApiKey').value=''; renderProviders(); alert('模型配置已保存'); });
$('#testProviderBtn')?.addEventListener('click', async () => { const id = $('#providerId').value.trim(); if(!id) return alert('先填写提供商 ID'); await window.testProvider(id); });

$('#netdiskPreviewBtn')?.addEventListener('click', async () => { try { $('#netdiskResult').textContent='正在读取网盘目录并分类...'; const r = await api('/api/netdisk/preview', netdiskPayload()); $('#netdiskResult').textContent = `${r.note}\n识别 ${r.items.length} 个资源。`; renderNetdiskItems(r.items); } catch(e){ $('#netdiskResult').textContent='预览失败：'+e.message; } });
$('#netdiskImportBtn')?.addEventListener('click', async () => { try { $('#netdiskResult').textContent='正在一键导入：分类→建课→绑定→出题→去重→校验...'; const r = await api('/api/netdisk/import', netdiskPayload()); $('#netdiskResult').textContent = `${r.note}\n导入资料：${r.imported}\n创建/更新课程：${r.courses.length}\n生成练习：${r.generatedQuestions.length}\n重复跳过：${r.duplicates.length}\n去重删除：${r.removed.length}\n待修正：${r.issues.count}`; renderNetdiskItems(r.courses.map(c=>({ name:c.title, classify:{ name:c.title, level:c.level, kind:'course', category:c.category, tags:c.tags, confidence:1, reason:`已绑定 ${c.materialIds?.length||0} 个 materialId` }}))); renderIssues(r.issues.items || []); await refresh(); } catch(e){ $('#netdiskResult').textContent='导入失败：'+e.message; } });
$('#loadIssuesBtn')?.addEventListener('click', loadIssues);
$('#fixIssuesBtn')?.addEventListener('click', async () => { try { const r = await api('/api/question-issues/fix',{}); $('#netdiskResult').textContent = `已尝试批量修正 ${r.fixed.length} 道题；剩余待修正 ${r.issues.count} 道。`; renderIssues(r.issues.items || []); await refresh(); } catch(e){ $('#netdiskResult').textContent='修正失败：'+e.message; } });
$('#translateBtn')?.addEventListener('click', async () => { const text=$('#transInput').value.trim(); if(!text) return; try { await doTranslate(text); } catch(e){ $('#transResult').innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; } });
$('#translateSelectionBtn')?.addEventListener('click', async () => { const text=(window.getSelection()?.toString() || $('#transInput').value || '').trim(); if(!text) return; $('#transInput').value=text; try { await doTranslate(text); } catch(e){ $('#transResult').innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; } });
$('#speakTransBtn')?.addEventListener('click', () => speakGermanCloud($('#transInput')?.value || ''));
$('#loadResourcesBtn')?.addEventListener('click', loadResources);
$('#resourceKind')?.addEventListener('change', loadResources);
$('#correctBtn')?.addEventListener('click', async () => { const text=$('#correctInput').value.trim(); if(!text) return; $('#correctResult').innerHTML='<p class="muted">正在批改...</p>'; try { renderCorrection(await api('/api/writing-correct',{ text, level:$('#correctLevel')?.value || 'A1' })); } catch(e){ $('#correctResult').innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; } });
$('#checkinBtn')?.addEventListener('click', async () => { try { const r=await api('/api/checkin',{ minutes:$('#checkinMinutes').value, note:$('#checkinNote').value }); $('#checkinResult').textContent = `已保存 ${r.item.date} 打卡：${r.item.minutes} 分钟`; await refresh(); } catch(e){ $('#checkinResult').textContent=e.message; } });
document.addEventListener('mouseup', () => { const text = window.getSelection()?.toString().trim(); if(text && text.length > 1 && text.length < 600 && $('#transInput')) $('#transInput').value = text; });

$('#loginBtn').onclick = async () => { try { const r = await api('/api/auth/login',{ email:$('#authEmail').value, password:$('#authPassword').value }); AUTH.token = r.token; localStorage.setItem('deutsch_token', r.token); $('#authMsg').textContent = `登录成功：${r.user.email}`; await refreshAuth(); await refresh(); } catch(e){ $('#authMsg').textContent = e.message; } };
$('#registerBtn').onclick = async () => { try { const r = await api('/api/auth/register',{ email:$('#authEmail').value, password:$('#authPassword').value }); AUTH.token = r.token; localStorage.setItem('deutsch_token', r.token); $('#authMsg').textContent = `注册并登录成功：${r.user.email}`; await refreshAuth(); await refresh(); } catch(e){ $('#authMsg').textContent = e.message; } };
loadNetInfo();
refreshAuth().then(async () => { if (AUTH.user) { await loadProviders(); await loadChatSessions(); await loadChats(); await refresh().catch(e=>alert(e.message)); await loadVocab(); } });

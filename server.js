const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'deutsch-study-data') : path.join(ROOT, 'data'));
const UPLOADS = process.env.UPLOADS_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), 'deutsch-study-uploads') : path.join(ROOT, 'uploads'));
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 8787);
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const ALLOWED_EXT = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.mpv', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.json', '.jpg', '.jpeg', '.png', '.webp'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8'
};

function ensure() {
  for (const dir of [PUBLIC, DATA_DIR, UPLOADS]) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) saveDb({
    users: [],
    sessions: [],
    aiChats: [],
    aiChatSessions: [],
    grammarMistakes: [],
    vocabulary: [],
    courses: [],
    materials: [],
    questions: [],
    attempts: [],
    settings: {
      levels: ['A1', 'A2', 'B1', 'B2', 'C1'],
      categories: ['视频课程', '口语课程', '语法', '真题', '书本习题', '写作训练', '造句训练', '听力', '阅读', '词汇'],
      note: '个人学习库：请只上传你有权使用的百度网盘/本地资料。',
      aiProviders: defaultAiProviders()
    }
  });
}
function defaultAiProviders() {
  return [
    { id: 'local-rule', name: '本地规则模型（无需Key）', type: 'local', model: 'local-german-coach', enabled: true },
    { id: 'deepseek', name: 'DeepSeek 德语语法批改', type: 'openai-compatible', purpose: 'grammar', baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY || '', enabled: Boolean(process.env.DEEPSEEK_API_KEY) },
    { id: 'doubao', name: '豆包 日常对话', type: 'openai-compatible', purpose: 'chat', baseUrl: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3', model: process.env.DOUBAO_MODEL || '', apiKey: process.env.DOUBAO_API_KEY || '', enabled: Boolean(process.env.DOUBAO_API_KEY && process.env.DOUBAO_MODEL) },
    { id: 'qwen', name: '通义千问 高阶写作', type: 'openai-compatible', purpose: 'writing', baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: process.env.QWEN_MODEL || 'qwen-plus', apiKey: process.env.QWEN_API_KEY || '', enabled: Boolean(process.env.QWEN_API_KEY) },
    { id: 'xunfei', name: '讯飞 语音纠音/朗读', type: 'xunfei', purpose: 'speech', baseUrl: process.env.XUNFEI_BASE_URL || '', model: process.env.XUNFEI_MODEL || 'xunfei-speech', apiKey: process.env.XUNFEI_API_KEY || '', apiSecret: process.env.XUNFEI_API_SECRET || '', appId: process.env.XUNFEI_APP_ID || '', enabled: Boolean(process.env.XUNFEI_API_KEY) },
    { id: 'openai', name: 'OpenAI兼容接口', type: 'openai-compatible', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY || '', enabled: Boolean(process.env.OPENAI_API_KEY) },
    { id: 'ollama', name: 'Ollama本地模型', type: 'ollama', baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', model: process.env.OLLAMA_MODEL || 'qwen2.5:7b', apiKey: '', enabled: false }
  ];
}
function applyEnvAiProviderOverrides(db) {
  const defaults = defaultAiProviders();
  if (!db.settings) db.settings = {};
  if (!Array.isArray(db.settings.aiProviders)) db.settings.aiProviders = [];
  for (const fresh of defaults) {
    const cur = db.settings.aiProviders.find(p => p.id === fresh.id);
    if (!cur) { db.settings.aiProviders.push(fresh); continue; }
    // Environment variables always win at runtime. This keeps Vercel secrets out of db.json/code.
    if (fresh.apiKey) {
      cur.apiKey = fresh.apiKey;
      cur.enabled = true;
    }
    if (fresh.baseUrl && (fresh.apiKey || fresh.id === 'deepseek')) cur.baseUrl = fresh.baseUrl;
    if (fresh.model && (fresh.apiKey || fresh.id === 'deepseek')) cur.model = fresh.model;
  }
}
function loadDb() {
  ensure();
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  let changed = false;
  for (const key of ['users', 'sessions', 'aiChats', 'aiChatSessions', 'grammarMistakes', 'courses', 'materials', 'questions', 'attempts', 'vocabulary']) {
    if (!Array.isArray(db[key])) { db[key] = []; changed = true; }
  }
  if (!db.settings) { db.settings = {}; changed = true; }
  if (!Array.isArray(db.settings.aiProviders)) { db.settings.aiProviders = defaultAiProviders(); changed = true; }
  const beforeProviders = JSON.stringify(db.settings.aiProviders);
  applyEnvAiProviderOverrides(db);
  if (JSON.stringify(db.settings.aiProviders) !== beforeProviders) changed = true;
  for (const m of db.materials) {
    if (!m.hash && m.path) {
      try {
        const filePath = path.join(ROOT, decodeURIComponent(m.path));
        if (fs.existsSync(filePath)) {
          m.hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
          changed = true;
        }
      } catch {}
    }
  }
  const seen = new Set();
  const keep = [];
  for (const m of db.materials) {
    const key = m.hash || `${m.kind || ''}|${m.category || ''}|${(m.name || '').toLowerCase().replace(/(?:\s*\(\d+\)|_copy|副本|重复)$/g, '')}|${m.size || 0}`;
    if (seen.has(key)) {
      try {
        const filePath = m.path ? path.join(ROOT, decodeURIComponent(m.path)) : null;
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
      changed = true;
      continue;
    }
    seen.add(key);
    keep.push(m);
  }
  if (keep.length !== db.materials.length) db.materials = keep;
  if (changed) saveDb(db);
  return db;
}
function saveDb(db) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8'); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex') };
}
function verifyPassword(password, salt, hash) {
  return hashPassword(password, salt).hash === hash;
}
function authHeaderToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}
function currentUser(db, req) {
  const token = authHeaderToken(req) || req.headers['x-auth-token'] || '';
  const session = db.sessions.find(s => s.token === token && (!s.expiresAt || Date.now() < s.expiresAt));
  if (!session) return null;
  return db.users.find(u => u.id === session.userId) || null;
}
function requireAuth(db, req, res) {
  const user = currentUser(db, req);
  if (!user) {
    send(res, 401, { error: '请先登录' });
    return null;
  }
  return user;
}
function inferMaterialCategory(kind, filename, mime) {
  const name = String(filename || '').toLowerCase();
  const ext = path.extname(name);
  if (kind === 'video' || ['.mp4', '.webm', '.mov', '.mkv', '.mpv'].includes(ext)) {
    if (/口语|speak|sprech|conversation|pronoun|发音/.test(name)) return '口语课程';
    if (/真题|exam|test|goethe|telc|prüfung|pruefung/.test(name)) return '真题视频';
    return '课程视频';
  }
  if (kind === 'audio' || ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) {
    if (/真题|exam|test|goethe|telc|prüfung|pruefung/.test(name)) return '真题音频';
    if (/作业|homework|hausaufgabe/.test(name)) return '作业音频';
    if (/练习|übung|uebung|exercise|practice/.test(name)) return '练习音频';
    if (/听力|audio|hör|hören|audio/.test(name)) return '听力';
    if (/口语|speak|sprech|pronoun/.test(name)) return '口语课程';
    return '音频';
  }
  if (['.pdf', '.doc', '.docx'].includes(ext)) {
    if (/exam|test|真题|goethe|telc|oxford|prüfung|pruefung/.test(name)) return '真题';
    if (/作业|homework|hausaufgabe/.test(name)) return '作业';
    if (/练习|übung|uebung|exercise|practice/.test(name)) return '练习';
    if (/buch|book|阅读|lesen|课后|教材|textbook/.test(name)) return '课后阅读书籍';
    if (/schreiben|作文|写作/.test(name)) return '写作训练';
    if (/gramm|语法/.test(name)) return '语法';
    return '文档资料';
  }
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    if (/真题|exam|test|goethe/.test(name)) return '真题图片';
    if (/作业|homework|hausaufgabe/.test(name)) return '作业图片';
    if (/练习|übung|uebung|exercise|practice/.test(name)) return '练习图片';
    return '图片资料';
  }
  if (['.csv', '.json', '.txt', '.md'].includes(ext)) {
    if (/真题|exam|test|goethe/.test(name)) return '真题';
    if (/作业|homework|hausaufgabe/.test(name)) return '作业';
    if (/练习|übung|uebung|exercise|practice/.test(name)) return '练习';
    return '文本资料';
  }
  if (/lex|wort|vocab|词汇/.test(name)) return '词汇';
  if (/gramm|语法/.test(name)) return '语法';
  if (/exam|test|真题|goethe|telc/.test(name)) return '真题';
  return '其他';
}
function serverUrls(port = PORT) {
  const urls = new Set([`http://localhost:${port}`]);
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info && info.family === 'IPv4' && !info.internal) urls.add(`http://${info.address}:${port}`);
    }
  }
  return [...urls];
}
function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function normalizeDuplicateKey(m) {
  const name = String(m.name || '').toLowerCase().replace(/(?:\s*\(\d+\)|_copy|副本|重复)$/g, '');
  return `${m.kind || ''}|${m.category || ''}|${name}|${m.size || 0}`;
}
function isCourseVideo(mat) {
  return mat && mat.kind === 'video' && /课程|视频课程|课程视频|口语课程|真题视频/.test(mat.category || '');
}
function autoCourseFromMaterial(db, user, mat) {
  if (!isCourseVideo(mat)) return null;
  const exists = db.courses.find(c => c.userId === user.id && (c.materialIds || []).includes(mat.id));
  if (exists) return exists;
  const title = mat.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const course = { id: id('course'), userId: user.id, title, level: mat.level || 'A1', category: mat.category || '课程视频', tags: [...new Set([...(mat.tags || []), '视频课程'])], description: `由上传视频「${mat.name}」自动生成课程。`, materialIds: [mat.id], completed: false, autoCreated: true, createdAt: new Date().toISOString() };
  db.courses.unshift(course);
  return course;
}
const BUILTIN_WORDS = {
  ich: { word: 'ich', article: '', plural: '', meaning: '我', pos: '代词', level: 'A1', examples: ['Ich lerne Deutsch.'], grammar: '第一人称单数，动词常用 -e 结尾。' },
  bin: { word: 'bin', article: '', plural: '', meaning: '是 / 在', pos: '动词 sein 变位', level: 'A1', examples: ['Ich bin Student.'], grammar: 'sein 的第一人称单数形式。' },
  deutsch: { word: 'Deutsch', article: 'das', plural: '', meaning: '德语', pos: '名词/形容词', level: 'A1', examples: ['Ich lerne Deutsch.'], grammar: '作名词时首字母大写。' },
  student: { word: 'Student', article: 'der', plural: 'Studenten', meaning: '大学生/学生', pos: '名词', level: 'A1', examples: ['Ich bin Student.'], grammar: '阳性弱变化名词，复数 Studenten。' },
  lernen: { word: 'lernen', article: '', plural: '', meaning: '学习', pos: '动词', level: 'A1', examples: ['Wir lernen Deutsch.'], grammar: '规则动词：ich lerne, du lernst, er lernt。' },
  gehen: { word: 'gehen', article: '', plural: '', meaning: '去；走', pos: '动词', level: 'A1', examples: ['Ich gehe nach Hause.'], grammar: '表示方向移动；Perfekt 常用 sein：ich bin gegangen。' },
  deutschland: { word: 'Deutschland', article: 'das', plural: '', meaning: '德国', pos: '专有名词', level: 'A1', examples: ['Ich fahre nach Deutschland.'], grammar: '国家名通常不用冠词；方向用 nach Deutschland。' },
  möchte: { word: 'möchte', article: '', plural: '', meaning: '想要', pos: '情态表达', level: 'A1', examples: ['Ich möchte Kaffee.'], grammar: '礼貌表达，比 ich will 更柔和。' },
  weil: { word: 'weil', article: '', plural: '', meaning: '因为', pos: '连词', level: 'A2', examples: ['Ich lerne Deutsch, weil ich in Deutschland arbeiten möchte.'], grammar: 'weil 引导从句，变位动词放句末。' }
};
function tokenizeGerman(text) {
  return [...new Set(String(text || '').match(/[A-Za-zÄÖÜäöüß]+/g) || [])];
}
function explainWord(db, user, word) {
  const raw = String(word || '').trim();
  const key = raw.toLowerCase();
  const own = db.vocabulary.find(v => (!v.userId || v.userId === user.id) && v.word.toLowerCase() === key);
  const base = own || BUILTIN_WORDS[key] || { word: raw, article: '', plural: '', meaning: '待补充：可从词汇书导入或手动加入词库', pos: '未知', level: 'A1', examples: [`${raw}`], grammar: '暂未收录详细语法，可先加入词库后完善。' };
  return { ...base, known: Boolean(own || BUILTIN_WORDS[key]) };
}
function analyseSentenceVocabulary(db, user, text) {
  const words = tokenizeGerman(text).slice(0, 40).map(w => explainWord(db, user, w));
  const grammar = analyseGermanText(text, 'chat', 'A1');
  return { text, words, grammarHints: grammar.grammarHints, structureProblems: grammar.structureProblems, pronunciationNotes: grammar.pronunciationNotes, sentences: grammar.sentences };
}
function extractVocabularyFromText(db, user, text, level = 'A1', source = 'AI/上传资料') {
  const added = [];
  for (const token of tokenizeGerman(text)) {
    const key = token.toLowerCase();
    if (db.vocabulary.find(v => v.userId === user.id && v.word.toLowerCase() === key)) continue;
    const info = BUILTIN_WORDS[key] || { word: token, meaning: '待补充', pos: '词汇', examples: [token], grammar: '从上传资料/AI内容自动提取，建议后续补充中文释义和例句。' };
    const entry = { id: id('voc'), userId: user.id, word: info.word, article: info.article || '', plural: info.plural || '', meaning: info.meaning || '待补充', pos: info.pos || '词汇', level: info.level || level, examples: info.examples || [token], grammar: info.grammar || '', source, mastery: 0, streak: 0, wrong: 0, createdAt: new Date().toISOString() };
    db.vocabulary.unshift(entry); added.push(entry);
  }
  return added;
}
function analyseUploadedMaterialBuffer(original, mime, data) {
  const ext = path.extname(original).toLowerCase();
  const result = { parsed: true, ext, summary: '', textPreview: '', media: null };
  if (['.txt', '.md', '.csv', '.json'].includes(ext) || /^text\//.test(mime)) {
    const text = data.toString('utf8').slice(0, 12000);
    result.textPreview = text.slice(0, 2000);
    result.summary = `已解析文本文件，提取前 ${result.textPreview.length} 字用于站内搜索/词库提取。`;
    result.tokens = tokenizeGerman(text).slice(0, 200);
  } else if (ext === '.pdf' || mime === 'application/pdf') {
    result.summary = '已识别为 PDF。无第三方依赖版本可保存、去重、分类、预览/打印；正文 OCR/完整抽取需后续接入 PDF/OCR 服务。';
  } else if (['.mp3','.wav','.m4a','.aac','.ogg','.flac'].includes(ext) || /^audio\//.test(mime)) {
    result.media = { kind: 'audio', bytes: data.length };
    result.summary = '已识别为音频。可站内播放、绑定听力题、交给讯飞/云端语音服务做转写和发音评分。';
  } else if (['.mp4','.webm','.mov','.mkv','.mpv'].includes(ext) || /^video\//.test(mime)) {
    result.media = { kind: 'video', bytes: data.length };
    result.summary = '已识别为视频。已支持站内播放、自动分类并归入课程；字幕/语音转写需接入云端语音服务。';
  } else {
    result.summary = '文件已保存，可分类、搜索文件名和绑定课程/题目。';
  }
  return result;
}
function dedupeMaterials(db, user) {
  const seen = new Map(); const removed = [];
  const keep = [];
  for (const m of db.materials) {
    if (user && m.userId && m.userId !== user.id) { keep.push(m); continue; }
    const k = m.hash || normalizeDuplicateKey(m);
    if (seen.has(k)) {
      removed.push({ id: m.id, name: m.name, duplicateOf: seen.get(k).id });
      try { const fp = m.path ? path.join(ROOT, decodeURIComponent(m.path)) : ''; if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    } else { seen.set(k, m); keep.push(m); }
  }
  db.materials = keep;
  return removed;
}

function inferLevelFromName(filename, fallback = 'A1') {
  const name = String(filename || '').toUpperCase();
  const m = name.match(/\b(A1|A2|B1|B2|C1)\b/);
  if (m) return m[1];
  if (/初级|入门|基础|BEGINNER|GRUNDSTUFE|START/.test(name)) return 'A1';
  if (/中级|INTERMEDIATE|MITTELSTUFE/.test(name)) return 'B1';
  if (/高级|ADVANCED|OBERSTUFE/.test(name)) return 'B2';
  return fallback;
}
function inferKindFromName(filename, mime = '') {
  const ext = path.extname(String(filename || '').toLowerCase());
  if (/^video\//.test(mime) || ['.mp4','.webm','.mov','.mkv','.mpv'].includes(ext)) return 'video';
  if (/^audio\//.test(mime) || ['.mp3','.wav','.m4a','.aac','.ogg','.flac'].includes(ext)) return 'audio';
  return 'file';
}
function classifyNetdiskResource(item = {}) {
  const name = item.name || item.filename || item.path || '未命名资源';
  const mime = item.mime || item.mimeType || '';
  const kind = inferKindFromName(name, mime);
  const level = inferLevelFromName(name, item.level || 'A1');
  let category = inferMaterialCategory(kind, name, mime);
  if (kind === 'video') category = /口语|sprech|speak|pronunciation|发音/i.test(name) ? '口语课程' : '网课视频';
  if (kind === 'audio') category = /听力|h[oö]ren|audio|listening|真题|goethe|telc|prüfung|pruefung/i.test(name) ? '听力音频' : '音频';
  if (kind === 'file' && /题|练习|真题|test|exam|goethe|telc|übung|uebung|exercise|prüfung|pruefung/i.test(name)) category = '真题习题';
  if (kind === 'file' && /课本|教材|textbook|kursbuch|arbeitsbuch|book|buch/i.test(name)) category = '课本';
  const tags = [...new Set([level, category, item.provider || '百度网盘', ...(item.tags || [])].filter(Boolean))];
  return { name: safeName(path.basename(String(name))), level, kind, category, tags, confidence: 0.72, reason: '本地规则按文件名、扩展名、德语考试关键词自动识别；DeepSeek 不可用时使用该兜底结果。' };
}
async function aiClassifyNetdiskResources(db, items) {
  const provider = routeAiProvider(db, 'grammar', 'A1', 'deepseek');
  const fallback = items.map(classifyNetdiskResource);
  if (!provider || provider.type === 'local') return fallback;
  try {
    const sample = items.slice(0, 80).map((x, i) => ({ index: i, name: x.name || x.filename || x.path, size: x.size, mime: x.mime || x.mimeType, path: x.path || x.server_filename, preview: String(x.textPreview || x.summary || '').slice(0, 500) }));
    const content = await callAiProvider(provider, [
      { role: 'system', content: '你是德语课程资料归档助手。只返回 JSON：{items:[{index:0,level:A1|A2|B1|B2,category:课本|网课视频|听力音频|真题习题,kind:file|video|audio,tags:[...],confidence:0.0,reason:...}]}。不要 Markdown。' },
      { role: 'user', content: JSON.stringify(sample) }
    ]);
    const out = safeJsonObject(content);
    if (!out || !Array.isArray(out.items)) return fallback;
    const byIndex = new Map(out.items.map(x => [Number(x.index), x]));
    return fallback.map((base, i) => {
      const ai = byIndex.get(i) || {};
      const level = ['A1','A2','B1','B2'].includes(ai.level) ? ai.level : base.level;
      const category = ['课本','网课视频','听力音频','真题习题'].includes(ai.category) ? ai.category : base.category;
      const kind = ['file','video','audio'].includes(ai.kind) ? ai.kind : base.kind;
      return { ...base, level, category, kind, tags: [...new Set([level, category, ...(ai.tags || base.tags || [])])], confidence: Number(ai.confidence || 0.9), reason: ai.reason || 'DeepSeek 自动识别' };
    });
  } catch (e) {
    provider.lastError = e.message;
    return fallback.map(x => ({ ...x, aiFallback: true, reason: `${x.reason} DeepSeek 调用失败：${e.message}` }));
  }
}
function baiduNetdiskAccessToken(body = {}) {
  return body.accessToken || process.env.BAIDU_NETDISK_ACCESS_TOKEN || process.env.BAIDU_ACCESS_TOKEN || '';
}
function baiduNetdiskApiBase() {
  return process.env.BAIDU_NETDISK_API_BASE || 'https://pan.baidu.com';
}
async function baiduJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { throw new Error(`百度网盘返回非 JSON：${text.slice(0, 200)}`); }
  if (!resp.ok) throw new Error(`百度网盘 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  if (json.errno && json.errno !== 0) throw new Error(`百度网盘返回错误 errno=${json.errno} ${json.errmsg || ''}`.trim());
  return json;
}
async function listBaiduNetdisk(body) {
  const accessToken = baiduNetdiskAccessToken(body);
  if (!accessToken) return [];
  const dir = body.dir || '/';
  const url = `${baiduNetdiskApiBase()}/rest/2.0/xpan/file?method=list&access_token=${encodeURIComponent(accessToken)}&dir=${encodeURIComponent(dir)}&recursion=1&web=1&page=1&num=${Number(body.limit || 1000)}`;
  const json = await baiduJson(url);
  return (json.list || []).filter(x => !x.isdir).map(x => ({
    provider: 'baidu-netdisk',
    name: x.server_filename,
    path: x.path,
    size: x.size || 0,
    fsId: String(x.fs_id || ''),
    md5: x.md5 || '',
    serverCtime: x.server_ctime,
    serverMtime: x.server_mtime
  }));
}
async function baiduNetdiskFileMeta(fsId, accessToken) {
  if (!accessToken) throw new Error('缺少 BAIDU_NETDISK_ACCESS_TOKEN，无法在线预览百度网盘文件');
  if (!fsId) throw new Error('缺少百度网盘 fs_id，无法生成预览链接');
  const fsids = encodeURIComponent(JSON.stringify([Number(fsId)]));
  const url = `${baiduNetdiskApiBase()}/rest/2.0/xpan/multimedia?method=filemetas&access_token=${encodeURIComponent(accessToken)}&fsids=${fsids}&dlink=1`;
  const json = await baiduJson(url, { headers: { 'User-Agent': 'pan.baidu.com' } });
  const item = (json.list || [])[0];
  if (!item || !item.dlink) throw new Error('百度网盘未返回可预览 dlink；请确认 Access Token 有网盘文件权限');
  return item;
}
function baiduPreviewUrlForMaterial(m) {
  if (!m || m.remoteProvider !== 'baidu-netdisk' || !m.fsId) return '';
  return `/api/netdisk/file?materialId=${encodeURIComponent(m.id)}`;
}
function materialDuplicateKeyForNetdisk(item, cls) {
  return item.md5 || item.hash || item.fsId || `${cls.kind}|${cls.category}|${String(item.path || item.name || '').toLowerCase()}|${item.size || 0}`;
}
function upsertNetdiskMaterial(db, user, item, cls) {
  const dupeKey = materialDuplicateKeyForNetdisk(item, cls);
  const existing = db.materials.find(m => (!m.userId || m.userId === user.id) && (m.netdiskKey === dupeKey || (item.md5 && m.hash === item.md5) || normalizeDuplicateKey(m) === `${cls.kind}|${cls.category}|${cls.name.toLowerCase()}|${item.size || 0}`));
  if (existing) return { material: existing, duplicate: true };
  const mat = { id: id('mat'), userId: user.id, name: cls.name, kind: cls.kind, category: cls.category, level: cls.level, source: item.source || '百度网盘自动导入', path: item.downloadUrl || item.url || '', remotePath: item.path || item.server_filename || item.name || '', remoteProvider: item.provider || 'baidu-netdisk', fsId: item.fsId || item.fs_id || '', netdiskKey: dupeKey, mime: item.mime || item.mimeType || '', size: Number(item.size || 0), hash: item.md5 || item.hash || '', tags: cls.tags || [], parseInfo: { parsed: false, summary: cls.reason, textPreview: String(item.textPreview || '').slice(0, 2000) }, aiClassify: { confidence: cls.confidence, reason: cls.reason, aiFallback: Boolean(cls.aiFallback) }, createdAt: new Date().toISOString() };
  db.materials.unshift(mat);
  return { material: mat, duplicate: false };
}
function syncDailyGermanQuestions(db, user, course, materials) {
  const created = [];
  for (const audio of materials.filter(m => m.kind === 'audio')) {
    const exists = db.questions.find(q => q.userId === user.id && q.audioId === audio.id && q.generatedBy === 'netdisk-daily-german');
    if (exists) continue;
    const q = { id: id('q'), userId: user.id, title: `${audio.level || course.level} 每日德语听力：${audio.name.replace(/\.[^.]+$/, '')}`, stem: '听音频，记录关键词，并用德语复述 1-2 句。', type: 'listening', level: audio.level || course.level || 'A1', category: '每日德语', source: audio.remotePath || audio.name, options: [], answer: '完成关键词记录与德语复述', explanation: '自动从网盘听力音频生成。若需要客观选择题，可在网盘导入后用“当天课程自动生成练习”扩展。', audioId: audio.id, materialIds: [audio.id], tags: [...new Set(['每日德语','听力','口语跟读', audio.level || course.level || 'A1'])], generatedBy: 'netdisk-daily-german', createdAt: new Date().toISOString() };
    q.validationErrors = validateQuestion(q, db, user);
    created.push(q);
  }
  return created;
}
function autoBuildCoursesFromMaterials(db, user, materials) {
  const groups = new Map();
  for (const m of materials) {
    const key = `${m.level || 'A1'}|${m.category || '网盘资料'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const courses = [];
  const generatedQuestions = [];
  for (const [key, mats] of groups) {
    const [level, category] = key.split('|');
    const title = `${level} ${category} · 网盘自动课程`;
    let course = db.courses.find(c => c.userId === user.id && c.title === title && c.autoCreated === 'netdisk');
    if (!course) {
      course = { id: id('course'), userId: user.id, title, level, category, tags: [...new Set([level, category, '网盘导入'])], description: '由百度网盘一键拉取后，AI/规则自动分级归类创建。', materialIds: [], completed: false, autoCreated: 'netdisk', createdAt: new Date().toISOString() };
      db.courses.unshift(course);
    }
    course.materialIds = [...new Set([...(course.materialIds || []), ...mats.map(m => m.id)])];
    course.updatedAt = new Date().toISOString();
    courses.push(course);
    generatedQuestions.push(...generatePracticeForCourse(withUserScope(db, user), course, Math.min(8, Math.max(4, mats.length))).map(q => ({ ...q, userId: user.id, source: `网盘自动生成 · ${course.id}`, generatedBy: 'netdisk-import' })));
    generatedQuestions.push(...syncDailyGermanQuestions(db, user, course, mats));
  }
  for (const q of generatedQuestions) q.validationErrors = validateQuestion(q, db, user);
  db.questions.unshift(...generatedQuestions.filter(q => !q.id || !db.questions.some(x => x.id === q.id)));
  return { courses, generatedQuestions };
}
function validateQuestion(q, db, user) {
  const errors = [];
  if (!q.title?.trim()) errors.push('缺少题目标题');
  if (!q.type) errors.push('缺少题型');
  if (!q.level) errors.push('缺少等级');
  if (q.type === 'choice' && (!Array.isArray(q.options) || q.options.length < 2)) errors.push('选择题至少需要两个选项');
  if (q.type === 'choice' && q.answer && Array.isArray(q.options) && !q.options.includes(q.answer)) errors.push('选择题答案不在选项中');
  if (!q.answer?.toString().trim()) errors.push('缺少标准答案');
  if (!q.explanation?.trim()) errors.push('缺少解析，建议补充 AI/人工讲解');
  if (q.type === 'listening' && !q.audioId) errors.push('听力题未匹配音频 materialId，待修正');
  if (q.audioId && !String(q.audioId).startsWith('mat_')) errors.push('音频绑定 ID 异常');
  if (db && q.audioId && String(q.audioId).startsWith('mat_') && !db.materials.some(m => (!user || !m.userId || m.userId === user.id) && m.id === q.audioId && m.kind === 'audio')) errors.push('听力题 audioId 未找到对应音频，待修正');
  if (!q.sourceMaterialId && q.materialIds?.length) q.sourceMaterialId = q.materialIds[0];
  if (!q.sourceImage && q.sourceMaterialId) q.sourceImage = `PDF原文截图待生成 · ${q.sourceMaterialId}`;
  return errors;
}
function collectQuestionIssues(db, user) {
  const items = ownItems(db.questions, user).map(q => { q.validationErrors = validateQuestion(q, db, user); return q; }).filter(q => q.validationErrors?.length);
  return { count: items.length, items };
}
function autoFixQuestions(db, user) {
  const fixed = [];
  const audios = ownItems(db.materials, user).filter(m => m.kind === 'audio');
  for (const q of ownItems(db.questions, user)) {
    let changed = false;
    if (!q.explanation?.trim()) { q.explanation = '自动补充：本题由系统导入后生成基础解析，建议复核原题答案与语法点。'; changed = true; }
    if (q.type === 'choice' && q.answer && Array.isArray(q.options) && q.options.length && !q.options.includes(q.answer)) { q.options.push(q.answer); changed = true; }
    if (q.type === 'listening' && !q.audioId) {
      const hit = audios.find(a => a.level === q.level && JSON.stringify([a.name,a.remotePath,a.tags]).toLowerCase().includes(String(q.source || q.title || '').toLowerCase().split(/\s+/)[0] || '')) || audios.find(a => a.level === q.level) || audios[0];
      if (hit) { q.audioId = hit.id; q.materialIds = [...new Set([...(q.materialIds || []), hit.id])]; changed = true; }
    }
    if (!q.sourceImage && (q.materialIds || []).length) { q.sourceImage = `PDF原文截图待生成 · ${(q.materialIds || [])[0]}`; changed = true; }
    const before = q.validationErrors?.join('|') || '';
    q.validationErrors = validateQuestion(q, db, user);
    if (changed || before !== (q.validationErrors || []).join('|')) { q.updatedAt = new Date().toISOString(); fixed.push(q); }
  }
  return fixed;
}

function withUserScope(db, user) {
  const uid = user?.id;
  const own = x => !uid || !x.userId || x.userId === uid;
  return {
    ...db,
    settings: { ...db.settings, aiProviders: (db.settings.aiProviders || []).map(publicAiProvider) },
    users: [],
    sessions: [],
    courses: db.courses.filter(own),
    materials: db.materials.filter(own),
    questions: db.questions.filter(own),
    attempts: db.attempts.filter(own),
    aiChats: db.aiChats.filter(own),
    aiChatSessions: db.aiChatSessions.filter(own),
    grammarMistakes: db.grammarMistakes.filter(own),
    vocabulary: db.vocabulary.filter(own)
  };
}
function ownItems(items, user) {
  return items.filter(x => !x.userId || x.userId === user.id);
}
function publicAiProvider(p) {
  return { id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl || '', model: p.model || '', enabled: Boolean(p.enabled), hasApiKey: Boolean(p.apiKey), lastOkAt: p.lastOkAt || '', lastError: p.lastError || '' };
}
function findAiProvider(db, providerId) {
  const list = Array.isArray(db.settings?.aiProviders) ? db.settings.aiProviders : defaultAiProviders();
  return list.find(p => p.id === providerId && p.enabled) || list.find(p => p.enabled && p.type !== 'local' && p.apiKey) || list.find(p => p.id === 'local-rule') || defaultAiProviders()[0];
}
function routeAiProvider(db, mode, level, providerId) {
  if (providerId && providerId !== 'auto') return findAiProvider(db, providerId);
  const list = Array.isArray(db.settings?.aiProviders) ? db.settings.aiProviders : defaultAiProviders();
  const pick = idv => list.find(p => p.id === idv && p.enabled && (p.type === 'local' || p.apiKey || p.type === 'ollama'));
  if (mode === 'pronunciation' || mode === 'speaking') return pick('xunfei') || pick('deepseek') || pick('openai') || pick('local-rule');
  if (mode === 'writing' && ['B1', 'B2', 'C1'].includes(level)) return pick('qwen') || pick('deepseek') || pick('openai') || pick('local-rule');
  if (mode === 'writing') return pick('deepseek') || pick('qwen') || pick('openai') || pick('local-rule');
  return pick('doubao') || pick('deepseek') || pick('openai') || pick('local-rule');
}
function compactHistory(history) {
  const list = Array.isArray(history) ? history : [];
  if (list.length <= 10) return { summary: '', history: list.slice(-8) };
  const older = list.slice(0, -8).map(x => `${x.userText || x.text || ''} -> ${x.correctedText || x.nativeReply || x.reply || ''}`).join('；').slice(0, 1600);
  return { summary: `此前对话摘要：${older}`, history: list.slice(-8) };
}
function fixedCorrectionTemplate(entry) {
  const errors = (entry.grammarHints || []).map((e, i) => ({ index: i + 1, type: '语法/表达', original: entry.text, correction: entry.correctedText, explanation: e }));
  return {
    totalScore: entry.score?.total || 0,
    subScores: { grammar: entry.score?.grammar || 0, fluency: entry.score?.fluency || 0, pronunciation: entry.score?.pronunciation || 0 },
    nativeRewrite: entry.nativeReply || entry.correctedText || '',
    errors,
    correctedText: entry.correctedText || '',
    pronunciationNotes: entry.pronunciationNotes || [],
    structureProblems: entry.structureProblems || [],
    shadowing: entry.shadowing || []
  };
}
function aiSystemPrompt(level, mode) {
  return `你是德语母语者、歌德考试考官和中文德语老师。请按 ${level} 水平、${mode} 模式批改学生输入。只返回 JSON，不要 Markdown。字段：reply 中文总评；correctedText 纠正后文本；nativeReply 更自然的德语表达；grammarHints 中文数组；structureProblems 中文数组；pronunciationNotes 中文数组；shadowing 数组，每项 {text,instruction}；writingRevision 可为 null 或 {improvedText,structure,scoreItems}；score {total,grammar,fluency,pronunciation,note}。要求解释清楚、适合中国学习者、不要编造用户没有输入的事实。`;
}
function safeJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)); } catch {} }
  return null;
}
async function callAiProvider(provider, messages) {
  if (!provider || provider.type === 'local') return null;
  if (provider.type === 'ollama') {
    const resp = await fetch(`${String(provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: provider.model || 'qwen2.5:7b', messages, stream: false, format: 'json' })
    });
    if (!resp.ok) throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    return json.message?.content || json.response || '';
  }
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const resp = await fetch(`${String(provider.baseUrl || '').replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: provider.model, messages, temperature: 0.2, response_format: { type: 'json_object' } })
  });
  if (!resp.ok) throw new Error(`模型接口 ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || '';
}

async function translateViaProvider(text, from = 'DE', to = 'ZH', provider = 'auto') {
  const q = String(text || '').trim();
  if (!q) return { translatedText: '', provider: 'local', fallback: true };
  const source = String(from || 'auto').toUpperCase();
  const target = String(to || 'ZH').toUpperCase();
  const deeplKey = process.env.DEEPL_API_KEY || '';
  const baiduAppId = process.env.BAIDU_TRANSLATE_APP_ID || '';
  const baiduSecret = process.env.BAIDU_TRANSLATE_SECRET || '';
  if ((provider === 'auto' || provider === 'deepl') && deeplKey) {
    const endpoint = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';
    const form = new URLSearchParams({ text: q, target_lang: target === 'ZH' ? 'ZH' : target });
    if (source && source !== 'AUTO') form.set('source_lang', source === 'ZH' ? 'ZH' : source);
    const resp = await fetch(endpoint, { method: 'POST', headers: { Authorization: `DeepL-Auth-Key ${deeplKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    if (!resp.ok) throw new Error(`DeepL ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    return { translatedText: json.translations?.[0]?.text || '', detectedSourceLanguage: json.translations?.[0]?.detected_source_language || source, provider: 'deepl' };
  }
  if ((provider === 'auto' || provider === 'baidu') && baiduAppId && baiduSecret) {
    const salt = String(Date.now());
    const sign = crypto.createHash('md5').update(baiduAppId + q + salt + baiduSecret).digest('hex');
    const fromLang = source === 'DE' ? 'de' : source === 'ZH' ? 'zh' : 'auto';
    const toLang = target === 'DE' ? 'de' : 'zh';
    const form = new URLSearchParams({ q, from: fromLang, to: toLang, appid: baiduAppId, salt, sign });
    const resp = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    if (!resp.ok) throw new Error(`百度翻译 ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    if (json.error_code) throw new Error(`百度翻译 ${json.error_code}: ${json.error_msg || ''}`);
    return { translatedText: (json.trans_result || []).map(x => x.dst).join('\n'), detectedSourceLanguage: json.from, provider: 'baidu' };
  }
  const dict = { ich:'我', du:'你', lernen:'学习', deutsch:'德语', danke:'谢谢', bitte:'请/不客气', haus:'房子', wasser:'水', gehen:'去/走', sprechen:'说' };
  const fallback = q.split(/(\s+)/).map(part => dict[part.toLowerCase()] || part).join('');
  return { translatedText: fallback === q ? `【本地兜底】${q}` : fallback, provider: 'local-rule', fallback: true, note: '未配置 DeepL/百度翻译密钥，已使用本地小词典兜底。' };
}
async function microsoftTts(text, voice = 'de-DE-KatjaNeural', rate = '0%') {
  const key = process.env.AZURE_TTS_KEY || process.env.MICROSOFT_TTS_KEY || '';
  const region = process.env.AZURE_TTS_REGION || process.env.MICROSOFT_TTS_REGION || '';
  const q = String(text || '').trim();
  if (!q) return null;
  if (!key || !region) return null;
  const ssml = `<speak version="1.0" xml:lang="de-DE"><voice xml:lang="de-DE" name="${voice}"><prosody rate="${rate}">${q.replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]))}</prosody></voice></speak>`;
  const resp = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3', 'User-Agent': 'deutsch-study-app' }, body: ssml });
  if (!resp.ok) throw new Error(`Microsoft TTS ${resp.status}: ${await resp.text()}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return { mime: 'audio/mpeg', audioBase64: buf.toString('base64'), provider: 'microsoft-tts', voice };
}
async function aiCorrectWriting(db, text, level = 'A1') {
  const provider = routeAiProvider(db, 'writing', level, 'deepseek');
  const local = analyseGermanText(text, 'writing', level);
  if (!provider || provider.type === 'local') return { ...local, provider: publicAiProvider(provider), fallback: true };
  try {
    const content = await callAiProvider(provider, [
      { role: 'system', content: aiSystemPrompt(level, 'writing') },
      { role: 'user', content: String(text || '') }
    ]);
    const parsed = safeJsonObject(content);
    return parsed ? { ...parsed, provider: publicAiProvider(provider), fallback: false } : { ...local, provider: publicAiProvider(provider), fallback: true };
  } catch (e) {
    provider.lastError = e.message;
    return { ...local, provider: publicAiProvider(provider), fallback: true, note: `DeepSeek 不可用，已本地兜底：${e.message}` };
  }
}
function resourceUrlForMaterial(m) { return m?.remoteUrl || m?.downloadUrl || m?.url || m?.path || baiduPreviewUrlForMaterial(m) || ''; }

async function aiChatResponse(db, user, data) {
  const mode = data.mode || 'chat';
  const level = data.level || 'A1';
  const text = String(data.text || '').trim();
  const compacted = compactHistory(Array.isArray(data.history) ? data.history : []);
  const history = compacted.history;
  const analysis = analyseGermanText(text, mode, level);
  const grammarHints = analysis.grammarHints;
  const corrected = text
    .replace(/^ich\b/, 'Ich')
    .replace(/^du\b/, 'Du')
    .replace(/\bi\s+am\b/gi, 'Ich bin')
    .replace(/\bich bin gut\b/gi, 'Ich bin gut')
    .replace(/\bstudent\b/g, 'Student')
    .replace(/\bdeutsch\b/g, 'Deutsch')
    .replace(/\bdeutschland\b/g, 'Deutschland');
  const replyMap = {
    chat: '已按对话模式批改：先看逐句纠错，再跟读母语者版本。',
    speaking: '口语批改完成：重点看词序、冠词、格和发音提示。',
    writing: '写作批改完成：已给出结构问题、逐句修改和更高分版本。',
    pronunciation: '发音纠音完成：请按音素提示逐句跟读。'
  };
  const nativeReply = analysis.nativeVersion || (level === 'A1'
    ? 'Ja, gern. Ich helfe dir Schritt für Schritt.'
    : level === 'A2'
      ? 'Klar, wir üben das zusammen und verbessern jede Antwort.'
      : 'Natürlich. Ich korrigiere zuerst die Grammatik und formuliere es natürlicher.');
  const score = scoreSpeaking(text, grammarHints, level);
  const prompt = `请扮演德语母语者 + 中文语法老师。按 ${level} 水平和 ${mode} 模式回复我。
要求：
1 先纠正语法错误；
2 给出更自然的母语者表达；
3 用中文解释错误原因；
4 如果是口语，输出适合跟读的短句；
5 如果是写作，给出可直接抄写的高分版本；
6 如果是发音，指出重音和易错音。
对话历史：${JSON.stringify(history)}
本轮输入：${text}`;
  const localEntry = {
    id: id('chat'),
    userId: user.id,
    sessionId: data.sessionId || '',
    mode,
    level,
    text,
    providerId: 'local-rule',
    providerName: '本地规则模型（无需Key）',
    modelUsed: 'local-german-coach',
    aiFallback: false,
    grammarHints,
    correctedText: corrected || text,
    nativeReply,
    score,
    sentenceAnalysis: analysis.sentences,
    pronunciationNotes: analysis.pronunciationNotes,
    structureProblems: analysis.structureProblems,
    writingRevision: analysis.writingRevision,
    shadowing: analysis.shadowing,
    reply: replyMap[mode] || replyMap.chat,
    prompt,
    compactSummary: compacted.summary,
    createdAt: new Date().toISOString()
  };
  localEntry.correctionTemplate = fixedCorrectionTemplate(localEntry);
  const provider = routeAiProvider(db, mode, level, data.providerId || data.modelProvider || 'auto');
  if (!provider || provider.type === 'local') return localEntry;
  const messages = [
    { role: 'system', content: aiSystemPrompt(level, mode) },
    compacted.summary ? { role: 'system', content: compacted.summary } : null,
    ...history.slice(-6).reverse().flatMap(h => ([
      { role: 'user', content: h.userText || h.text || '' },
      { role: 'assistant', content: h.nativeReply || h.reply || '' }
    ])).filter(m => m.content),
    { role: 'user', content: text }
  ].filter(Boolean);
  try {
    const content = await callAiProvider(provider, messages);
    const out = safeJsonObject(content) || { reply: content };
    provider.lastOkAt = new Date().toISOString(); provider.lastError = '';
    const merged = {
      ...localEntry,
      providerId: provider.id,
      providerName: provider.name,
      modelUsed: provider.model || provider.type,
      aiFallback: false,
      grammarHints: Array.isArray(out.grammarHints) ? out.grammarHints : localEntry.grammarHints,
      correctedText: out.correctedText || localEntry.correctedText,
      nativeReply: out.nativeReply || localEntry.nativeReply,
      score: out.score || localEntry.score,
      pronunciationNotes: Array.isArray(out.pronunciationNotes) ? out.pronunciationNotes : localEntry.pronunciationNotes,
      structureProblems: Array.isArray(out.structureProblems) ? out.structureProblems : localEntry.structureProblems,
      writingRevision: out.writingRevision || localEntry.writingRevision,
      shadowing: Array.isArray(out.shadowing) ? out.shadowing : localEntry.shadowing,
      reply: out.reply || localEntry.reply,
      rawModelText: typeof content === 'string' ? content.slice(0, 4000) : ''
    };
    merged.correctionTemplate = fixedCorrectionTemplate(merged);
    return merged;
  } catch (e) {
    provider.lastError = e.message;
    const fallback = { ...localEntry, providerId: provider.id, providerName: provider.name, modelUsed: provider.model || provider.type, aiFallback: true, reply: `${localEntry.reply}（外部模型暂不可用，已自动使用本地规则兜底：${e.message}）` };
    fallback.correctionTemplate = fixedCorrectionTemplate(fallback);
    return fallback;
  }
}

function analyseGermanText(text, mode, level) {
  const raw = String(text || '').trim();
  const parts = raw ? raw.split(/(?<=[.!?。！？])\s+|\n+/).map(s => s.trim()).filter(Boolean) : [];
  const grammarHints = [];
  const structureProblems = [];
  const pronunciationNotes = [];
  if (/^ich\b/.test(raw)) grammarHints.push('句首 ich 应写作 Ich。');
  if (/^du\b/.test(raw)) grammarHints.push('句首 du 应写作 Du。');
  if (/\b(I|i)\s+am\b/.test(raw)) grammarHints.push('德语里“我是”不是 I am，应写 Ich bin。');
  if (/\bich\s+habe\s+\w+\s+gehen\b/i.test(raw)) grammarHints.push('Perfekt 中 gehen 通常用 sein：Ich bin gegangen。');
  if (!/[.!?。！？]$/.test(raw) && raw.length > 20) structureProblems.push('句子较长但没有清楚结束符，写作时建议分句。');
  if (raw.split(/\s+/).length > 16 && !/,|weil|dass|aber|denn|und/.test(raw)) structureProblems.push('句子信息太多，缺少连接词；建议拆成两句或使用 weil/dass/aber。');
  const soundMap = [
    ['ch', 'ch 有两种常见读法：ich-Laut /ç/，ach-Laut /x/。注意不要读成英语 ch。'],
    ['r', '德语 r 多为小舌音或弱化音，词尾 -er 常弱化。'],
    ['ü', 'ü 先摆 i 的口型再圆唇，常见错误是读成 u。'],
    ['ö', 'ö 先摆 e 的口型再圆唇，别读成 o。'],
    ['ä', 'ä 常接近 /ɛ/，不要完全读成 a。'],
    ['ei', 'ei 读 /aɪ/，像 “爱”。'],
    ['ie', 'ie 通常读长 /iː/。']
  ];
  for (const [key, note] of soundMap) if (raw.toLowerCase().includes(key)) pronunciationNotes.push(note);
  if (!pronunciationNotes.length) pronunciationNotes.push('本句未出现明显特殊音，重点保持元音长短和重音稳定。');
  const sentences = (parts.length ? parts : [raw || '']).map((s, idx) => {
    let corrected = s.replace(/^ich\b/, 'Ich').replace(/^du\b/, 'Du').replace(/\b(I|i)\s+am\b/g, 'Ich bin').replace(/\bstudent\b/g, 'Student').replace(/\bdeutsch\b/g, 'Deutsch').replace(/\bdeutschland\b/g, 'Deutschland');
    const problems = [];
    if (/^ich\b/.test(s)) problems.push('句首 Ich 大写。');
    if (/\b(I|i)\s+am\b/.test(s)) problems.push('英语表达混入德语。');
    if (s.split(/\s+/).length > 14) problems.push('句子偏长，建议拆分。');
    return { index: idx + 1, original: s, corrected, problems, pronunciation: pronunciationNotes.slice(0, 3) };
  });
  const correctedAll = sentences.map(s => s.corrected).join(' ');
  const nativeVersion = mode === 'writing'
    ? `${correctedAll}${correctedAll.endsWith('.') ? '' : '.'} Außerdem möchte ich mich Schritt für Schritt verbessern.`
    : correctedAll || 'Ich möchte Deutsch üben.';
  const writingRevision = mode === 'writing' ? {
    structure: ['开头要直接说明主题。', '主体用 2-3 个理由展开。', '结尾给出总结或请求。'],
    improvedText: nativeVersion,
    scoreItems: { content: 78, structure: structureProblems.length ? 68 : 82, grammar: Math.max(55, 85 - grammarHints.length * 8), vocabulary: 76 }
  } : null;
  const shadowing = nativeVersion.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5).map((s, i) => ({ step: i + 1, text: s, instruction: i === 0 ? '慢速跟读，先读准每个音。' : '正常速度跟读，注意停顿和重音。' }));
  return { grammarHints, structureProblems, pronunciationNotes, sentences, nativeVersion, writingRevision, shadowing };
}
function scoreSpeaking(text, grammarHints, level) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const base = { A1: 72, A2: 76, B1: 80, B2: 84 }[level] || 75;
  const grammar = Math.max(45, base - grammarHints.length * 8 + Math.min(10, words));
  const fluency = Math.max(45, base + Math.min(12, Math.floor(words / 4)) - (words < 4 ? 14 : 0));
  const pronunciation = Math.max(50, base - (/ü|ö|ä|ch|r/i.test(text) ? 0 : 5));
  const total = Math.round((grammar * 0.4 + fluency * 0.3 + pronunciation * 0.3));
  return { total, grammar: Math.round(grammar), fluency: Math.round(fluency), pronunciation: Math.round(pronunciation), note: '本地规则评分：接入真实语音识别/大模型后可升级为更准的母语者发音评分。' };
}
function send(res, status, body, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }
function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) reject(new Error('请求太大')); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function safeName(name) { return String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120); }
function parseDataUrl(s) {
  const m = String(s || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { mime: m[1] || 'application/octet-stream', data };
}
function recommendAfterCourse(db, course) {
  const tags = new Set([course.level, course.category, ...(course.tags || [])].filter(Boolean));
  return db.questions.filter(q => [q.level, q.category, ...(q.tags || [])].some(x => tags.has(x))).slice(0, 12);
}

function normalisePracticeCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 6;
  return Math.min(24, Math.max(4, Math.floor(n)));
}

function generatePracticeForCourse(db, course, count = 8) {
  const n = normalisePracticeCount(count);
  const pool = db.questions.filter(q => q.level === course.level || q.category === course.category || (q.tags || []).some(t => (course.tags || []).includes(t)));
  const base = pool.length ? pool : db.questions;
  const generated = [];
  for (let i = 0; i < n; i++) {
    const seed = base[i % Math.max(1, base.length)] || {};
    const title = `${course.title} 练习 ${i + 1}`;
    const type = seed.type || (i % 4 === 0 ? 'choice' : 'short');
    const answer = seed.answer || (type === 'choice' ? 'A' : '根据课程内容作答');
    const explanation = seed.explanation || `这道题基于课程「${course.title}」自动生成，用于巩固 ${course.level} 阶段的核心内容。`;
    const materialIds = [...new Set([...(course.materialIds || []), ...(seed.materialIds || [])])];
    const audio = (db.materials || []).find(m => materialIds.includes(m.id) && m.kind === 'audio');
    const seedAudio = (db.materials || []).find(m => m.id === seed.audioId && m.kind === 'audio');
    const q = {
      id: id('q'),
      title,
      stem: seed.stem || (audio ? '听音频，选择正确答案。' : `请根据课程「${course.title}」完成第 ${i + 1} 题。`),
      type: audio && i % 3 === 0 ? 'listening' : type,
      level: course.level,
      category: '自动生成练习',
      source: `自动生成 · ${course.id}`,
      options: type === 'choice' ? (seed.options && seed.options.length >= 2 ? seed.options : ['A', 'B', 'C']) : [],
      answer,
      explanation,
      audioId: seedAudio?.id || audio?.id || '',
      materialIds,
      tags: [...new Set([...(course.tags || []), audio ? '听力' : '', '自动生成', '课程后练习'].filter(Boolean))],
      generatedFromCourseId: course.id,
      createdAt: new Date().toISOString()
    };
    q.validationErrors = validateQuestion(q, db);
    generated.push(q);
  }
  return generated;
}

function collectWrongbook(db) {
  const wrongIds = new Set();
  for (const att of db.attempts) if (!att.correct) wrongIds.add(att.questionId);
  return db.questions.filter(q => wrongIds.has(q.id));
}

function aiGuide(kind, text, level = 'A1') {
  const input = String(text || '').trim();
  const base = {
    level,
    input,
    createdAt: new Date().toISOString()
  };
  if (kind === 'speaking') return {
    ...base,
    title: 'AI 口语教练',
    advice: [
      '先用短句说清楚，再追求复杂表达。',
      '每次口语练习至少重复 3 遍：慢速、正常速度、模拟考试速度。',
      '重点检查动词位置、冠词、第三/第四格和时态。'
    ],
    prompt: `请作为歌德考试口语考官和中文德语老师，按 ${level} 水平指导我。\n任务：批改我的德语口语转写，指出语法、词序、冠词、格、发音可能问题，并给出更自然表达。\n请输出：1评分 2错误表格 3自然改写 4跟读句 5下一轮追问。\n我的口语内容：\n${input}`
  };
  if (kind === 'writing') return {
    ...base,
    title: 'AI 写作教练',
    advice: [
      '先保证句子正确，再增加连接词和从句。',
      '写作训练要按考试结构：开头、主体、结尾。',
      '每篇文章必须保存原文、批改版、重写版。'
    ],
    prompt: `请作为歌德 ${level} 写作评分老师批改下面德语作文。\n请按：任务完成度、结构、词汇、语法、自然度评分。\n逐句指出错误，给出正确版本，用中文解释，并给我一个更高分改写版本。\n作文：\n${input}`
  };
  if (kind === 'pronunciation') return {
    ...base,
    title: 'AI 发音教练',
    advice: [
      '德语发音优先练清楚元音长短、ch/r/ü/ö/ä。',
      '每天用 5 分钟做最小对立练习，比如 schon/schön。',
      '录音后对照原音频，标出你卡住的音。'
    ],
    prompt: `请作为德语发音教练，帮我练 ${level} 发音。\n请把下面文本分成可跟读小段，标注重音、易错音、连读/停顿，并设计 5 个跟读训练。\n文本：\n${input}`
  };
  return {
    ...base,
    title: 'AI 德语学习教练',
    advice: ['请选择口语、写作或发音模式。'],
    prompt: input
  };
}

function buildSearchResults(db, query) {
  const q = String(query || '').trim();
  const lower = q.toLowerCase();
  const localCourses = db.courses.filter(x => JSON.stringify(x).toLowerCase().includes(lower)).slice(0, 10);
  const localQuestions = db.questions.filter(x => JSON.stringify(x).toLowerCase().includes(lower)).slice(0, 10);
  const encoded = encodeURIComponent(q || 'Goethe Deutsch B2 Prüfung');
  return {
    query: q,
    localCourses,
    localQuestions,
    webLinks: [
      { name: 'Google 全网搜索', url: `https://www.google.com/search?q=${encoded}` },
      { name: 'Bing 全网搜索', url: `https://www.bing.com/search?q=${encoded}` },
      { name: 'YouTube 德语学习视频', url: `https://www.youtube.com/results?search_query=${encoded}` },
      { name: '歌德官网搜索', url: `https://www.google.com/search?q=site%3Agoethe.de+${encoded}` },
      { name: 'DW Deutsch Lernen', url: `https://www.google.com/search?q=site%3Adw.com+Deutsch+lernen+${encoded}` }
    ]
  };
}

function buildCourseDoc(course, materials, exercises) {
  const highlight = (course.tags || []).slice(0, 10).join(' · ') || '无';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${course.title}</title>
  <style>
    body{font-family:Arial,\"Microsoft YaHei\",sans-serif;line-height:1.55;margin:24px;color:#111}
    h1,h2,h3{margin:0 0 10px} .meta{color:#555;margin-bottom:12px;font-size:13px}
    .box{border:1px solid #ddd;border-radius:12px;padding:14px;margin:14px 0}
    .tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#f2f2f2;margin:0 6px 6px 0;font-size:12px}
    .hl{background:#fff2a8}.diff{background:#ffd7c7}.doubt{background:#d9ecff}
    .small{color:#555;font-size:12px}
    @media print{body{margin:0} .box{break-inside:avoid}}
  </style>
</head>
<body>
  <h1>${course.title}</h1>
  <div class="meta">等级：${course.level} · 分类：${course.category} · 标签：${highlight}</div>
  <div class="box">
    <h2>课程摘要</h2>
    <div>${course.description || '暂无摘要'}</div>
  </div>
  <div class="box">
    <h2>重点 / 难点 / 疑点</h2>
    <p><span class="tag hl">重点</span> ${course.focusPoints?.join('；') || '从课程标签和题目答案中提炼重点。'}</p>
    <p><span class="tag diff">难点</span> ${course.difficultyPoints?.join('；') || '语法变化、词序、格、时态、听力辨音等高频错误点。'}</p>
    <p><span class="tag doubt">疑点</span> ${course.doubtPoints?.join('；') || '记录你学完后仍然会混淆的地方。'}</p>
  </div>
  <div class="box">
    <h2>课后练习</h2>
    <ol>
      ${exercises.map(q => `<li><b>${q.title}</b><br><span class="small">题干：</span>${q.stem}<br><span class="small">答案：</span>${q.answer}<br><span class="small">解析：</span>${q.explanation}</li>`).join('')}
    </ol>
  </div>
  <div class="box">
    <h2>资料</h2>
    <ul>${materials.map(m => `<li>${m.name} <span class="small">(${m.kind} · ${m.category})</span></li>`).join('') || '<li>暂无绑定资料</li>'}</ul>
  </div>
</body>
</html>`;
}

function buildPptDoc(course, materials, exercises) {
  const keyPoints = course.focusPoints?.length ? course.focusPoints : [
    `${course.level} 核心词汇与句型`,
    '动词位置、冠词、格和时态',
    ...(course.tags || []).slice(0, 4)
  ].filter(Boolean);
  const difficult = course.difficultyPoints?.length ? course.difficultyPoints : ['听力关键词定位', '德语词序', '冠词/格变化', '口语自然表达'];
  const easyWrong = ['名词首字母大写', '动词第二位', 'nicht/kein 区分', 'Akkusativ/Dativ 混淆'];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${course.title} PPT</title><style>
body{margin:0;background:#111;color:#fff;font-family:Arial,"Microsoft YaHei",sans-serif}.slide{min-height:100vh;padding:56px;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.slide:nth-child(odd){background:#1f2b2a}.slide:nth-child(even){background:#28364f}h1{font-size:56px;margin:0 0 20px}h2{font-size:42px;margin:0 0 20px}.pill{display:inline-block;background:#ff7043;color:white;border-radius:999px;padding:6px 14px;margin:4px}li{font-size:26px;margin:12px 0}.small{opacity:.75;font-size:18px}.answer{background:rgba(255,255,255,.12);padding:18px;border-radius:16px}@media print{.slide{min-height:90vh}}
</style></head><body>
<section class="slide"><h1>${course.title}</h1><p class="small">等级 ${course.level} · ${course.category}</p>${(course.tags||[]).map(t=>`<span class="pill">${t}</span>`).join('')}</section>
<section class="slide"><h2>本课知识重点</h2><ul>${keyPoints.map(x=>`<li>${x}</li>`).join('')}</ul></section>
<section class="slide"><h2>难点突破</h2><ul>${difficult.map(x=>`<li>${x}</li>`).join('')}</ul></section>
<section class="slide"><h2>易错点提醒</h2><ul>${easyWrong.map(x=>`<li>${x}</li>`).join('')}</ul></section>
<section class="slide"><h2>资料来源</h2><ul>${materials.map(m=>`<li>${m.name} <span class="small">${m.category}</span></li>`).join('') || '<li>暂无绑定资料</li>'}</ul></section>
${exercises.slice(0,6).map((q,i)=>`<section class="slide"><h2>课后题 ${i+1}</h2><p>${q.stem}</p><div class="answer"><b>答案：</b>${q.answer}<br><b>解析：</b>${q.explanation}</div></section>`).join('')}
</body></html>`;
}

function b2Plan(db, user) {
  const scoped = withUserScope(db, user);
  const wrong = collectWrongbook(scoped).length;
  const done = scoped.courses.filter(c => c.completed).length;
  const materials = scoped.materials.length;
  const phases = [
    { month: '1-2月', target: 'A1 打基础', daily: '30分钟词汇+30分钟语法+20分钟听力跟读', exam: '能自我介绍、问路、购物、写简单邮件' },
    { month: '3-4月', target: 'A2 日常表达', daily: '课程视频+课后练习+错题复盘', exam: '能描述过去经历、表达简单观点' },
    { month: '5-7月', target: 'B1 独立使用', daily: '阅读短文、听力真题、每周2篇写作', exam: '能完成B1邮件/观点表达/情景口语' },
    { month: '8-10月', target: 'B2 强化输入输出', daily: '长阅读+新闻听力+观点写作+口语讨论', exam: '能论证观点、理解复杂文本' },
    { month: '11-12月', target: 'B2 冲刺模考', daily: '歌德/同级真题套卷+错题回炉+口语录音评分', exam: '按考试时间完成听说读写全套训练' }
  ];
  return { stats: { completedCourses: done, materials, wrongQuestions: wrong }, phases, today: ['完成1节课', '做8道课后题', '错题本复盘10分钟', 'AI口语对话5轮', '朗读德语文本3遍'] };
}

async function api(req, res, pathname, url) {
  const db = loadDb();
  if (req.method === 'GET' && pathname === '/api/db') {
    const user = currentUser(db, req);
    if (!user) return send(res, 401, { error: '请先登录' });
    return send(res, 200, withUserScope(db, user));
  }
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, port: PORT, urls: serverUrls(PORT) });
  if (req.method === 'GET' && pathname === '/api/netinfo') return send(res, 200, { port: PORT, urls: serverUrls(PORT) });
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!email || !password) return send(res, 400, { error: '缺少邮箱或密码' });
    if (db.users.some(u => u.email === email)) return send(res, 400, { error: '该邮箱已注册' });
    const pair = hashPassword(password);
    const user = { id: id('usr'), email, salt: pair.salt, passwordHash: pair.hash, createdAt: new Date().toISOString() };
    db.users.push(user);
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions.unshift({ token, userId: user.id, createdAt: new Date().toISOString(), expiresAt: Date.now() + TOKEN_TTL_MS });
    saveDb(db);
    return send(res, 200, { user: { id: user.id, email: user.email }, token });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    const user = db.users.find(u => u.email === email);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) return send(res, 401, { error: '邮箱或密码错误' });
    const token = crypto.randomBytes(32).toString('hex');
    db.sessions.unshift({ token, userId: user.id, createdAt: new Date().toISOString(), expiresAt: Date.now() + TOKEN_TTL_MS });
    saveDb(db);
    return send(res, 200, { user: { id: user.id, email: user.email }, token });
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = currentUser(db, req);
    return send(res, 200, { user: user ? { id: user.id, email: user.email } : null });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = authHeaderToken(req) || req.headers['x-auth-token'] || '';
    db.sessions = db.sessions.filter(s => s.token !== token);
    saveDb(db);
    return send(res, 200, { ok: true });
  }

  const openPaths = new Set(['/api/health', '/api/auth/login', '/api/auth/register']);
  if (!openPaths.has(pathname) && !currentUser(db, req)) return send(res, 401, { error: '请先登录' });

  if (req.method === 'POST' && pathname === '/api/course') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const course = { id: id('course'), userId: user.id, title: data.title || '未命名课程', level: data.level || 'A1', category: data.category || '视频课程', tags: data.tags || [], description: data.description || '', materialIds: data.materialIds || [], completed: false, createdAt: new Date().toISOString() };
    db.courses.unshift(course); saveDb(db); return send(res, 200, { course });
  }
  if (req.method === 'POST' && pathname === '/api/course/complete') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const course = db.courses.find(c => c.id === data.id && (!c.userId || c.userId === user.id)); if (!course) return send(res, 404, { error: '课程不存在' });
    course.completed = true; course.completedAt = new Date().toISOString(); saveDb(db);
    return send(res, 200, { course, recommended: recommendAfterCourse(withUserScope(db, user), course) });
  }
  if (req.method === 'POST' && pathname === '/api/course/practice') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const course = db.courses.find(c => c.id === data.id && (!c.userId || c.userId === user.id)); if (!course) return send(res, 404, { error: '课程不存在' });
    const created = generatePracticeForCourse(withUserScope(db, user), course, data.count || 8).map(q => ({ ...q, userId: user.id }));
    db.questions.unshift(...created);
    saveDb(db);
    return send(res, 200, { course, generated: created });
  }
  if (req.method === 'GET' && pathname === '/api/wrongbook') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, { items: collectWrongbook(withUserScope(db, user)) });
  }
  if (req.method === 'GET' && pathname === '/api/plan') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, b2Plan(db, user));
  }
  if (req.method === 'POST' && pathname === '/api/ai-guide') {
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    return send(res, 200, aiGuide(data.kind || 'speaking', data.text || '', data.level || 'A1'));
  }
  if (req.method === 'GET' && pathname === '/api/ai/providers') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, { providers: (db.settings.aiProviders || defaultAiProviders()).map(publicAiProvider) });
  }
  if (req.method === 'POST' && pathname === '/api/ai/providers') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const provider = data.provider || data;
    const list = db.settings.aiProviders || (db.settings.aiProviders = defaultAiProviders());
    const idv = String(provider.id || '').trim() || id('ai');
    let p = list.find(x => x.id === idv);
    if (!p) { p = { id: idv, name: provider.name || idv, type: provider.type || 'openai-compatible' }; list.push(p); }
    p.name = provider.name || p.name;
    p.type = provider.type || p.type;
    p.baseUrl = provider.baseUrl || p.baseUrl || '';
    p.model = provider.model || p.model || '';
    p.enabled = provider.enabled !== false;
    if (Object.prototype.hasOwnProperty.call(provider, 'apiKey') && provider.apiKey) p.apiKey = provider.apiKey;
    if (Object.prototype.hasOwnProperty.call(provider, 'apiKey') && provider.apiKey === '') p.apiKey = p.apiKey || '';
    saveDb(db); return send(res, 200, { provider: publicAiProvider(p), providers: list.map(publicAiProvider) });
  }
  if (req.method === 'POST' && pathname === '/api/ai/test') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const provider = findAiProvider(db, data.providerId || '');
    try {
      const content = provider.type === 'local' ? '本地规则模型可用' : await callAiProvider(provider, [{ role: 'system', content: '只返回JSON：{"ok":true,"reply":"..."}' }, { role: 'user', content: 'Sag kurz Hallo auf Deutsch.' }]);
      provider.lastOkAt = new Date().toISOString(); provider.lastError = '';
      saveDb(db); return send(res, 200, { ok: true, provider: publicAiProvider(provider), sample: content });
    } catch (e) {
      provider.lastError = e.message; saveDb(db); return send(res, 200, { ok: false, provider: publicAiProvider(provider), error: e.message });
    }
  }
  if (req.method === 'GET' && pathname === '/api/search') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, buildSearchResults(withUserScope(db, user), url.searchParams.get('q') || ''));
  }
  if (req.method === 'GET' && pathname === '/api/vocabulary') {
    const user = requireAuth(db, req, res); if (!user) return;
    const q = String(url.searchParams.get('q') || '').toLowerCase();
    const items = ownItems(db.vocabulary, user).filter(v => !q || JSON.stringify(v).toLowerCase().includes(q)).slice(0, 300);
    return send(res, 200, { items });
  }
  if (req.method === 'POST' && pathname === '/api/vocabulary') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const word = String(data.word || '').trim();
    if (!word) return send(res, 400, { error: '缺少单词' });
    const existing = db.vocabulary.find(v => v.userId === user.id && v.word.toLowerCase() === word.toLowerCase());
    if (existing) Object.assign(existing, data, { word, updatedAt: new Date().toISOString() });
    else db.vocabulary.unshift({ id: id('voc'), userId: user.id, word, article: data.article || '', plural: data.plural || '', meaning: data.meaning || '', pos: data.pos || '', level: data.level || 'A1', examples: data.examples || [], grammar: data.grammar || '', source: data.source || '手动添加', mastery: Number(data.mastery || 0), streak: 0, wrong: 0, createdAt: new Date().toISOString() });
    saveDb(db); return send(res, 200, { item: db.vocabulary.find(v => v.userId === user.id && v.word.toLowerCase() === word.toLowerCase()) });
  }
  if (req.method === 'POST' && pathname === '/api/vocabulary/import') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8') || '{}');
    const text = String(data.text || '').trim();
    const rows = Array.isArray(data.items) ? data.items : [];
    const added = [];
    for (const row of rows) {
      const word = String(row.word || '').trim(); if (!word) continue;
      if (db.vocabulary.find(v => v.userId === user.id && v.word.toLowerCase() === word.toLowerCase())) continue;
      const entry = { id: id('voc'), userId: user.id, word, article: row.article || '', plural: row.plural || '', meaning: row.meaning || '', pos: row.pos || '词汇', level: row.level || data.level || 'A1', examples: row.examples || [], grammar: row.grammar || '', source: row.source || '词汇书导入', mastery: 0, streak: 0, wrong: 0, createdAt: new Date().toISOString() };
      db.vocabulary.unshift(entry); added.push(entry);
    }
    if (text) added.push(...extractVocabularyFromText(db, user, text, data.level || 'A1', data.source || 'AI文本提取'));
    saveDb(db); return send(res, 200, { added });
  }
  if (req.method === 'POST' && pathname === '/api/lookup') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    return send(res, 200, { result: explainWord(db, user, data.word || '') });
  }
  if (req.method === 'POST' && pathname === '/api/sentence-analyse') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    return send(res, 200, analyseSentenceVocabulary(db, user, data.text || ''));
  }
  if (req.method === 'POST' && pathname === '/api/delete') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const type = data.type; const idv = data.id;
    if (type === 'material') {
      const mat = db.materials.find(m => m.id === idv && (!m.userId || m.userId === user.id)); if (!mat) return send(res, 404, { error: '资料不存在' });
      db.materials = db.materials.filter(m => m.id !== idv); db.courses.forEach(c => { if (!c.userId || c.userId === user.id) c.materialIds = (c.materialIds || []).filter(x => x !== idv); });
      try { const fp = mat.path ? path.join(ROOT, decodeURIComponent(mat.path)) : ''; if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    } else if (type === 'course') db.courses = db.courses.filter(c => !(c.id === idv && (!c.userId || c.userId === user.id)));
    else if (type === 'question') db.questions = db.questions.filter(q => !(q.id === idv && (!q.userId || q.userId === user.id)));
    else if (type === 'vocabulary') db.vocabulary = db.vocabulary.filter(v => !(v.id === idv && (!v.userId || v.userId === user.id)));
    else return send(res, 400, { error: '不支持的删除类型' });
    saveDb(db); return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/netdisk/file') {
    const user = requireAuth(db, req, res); if (!user) return;
    const materialId = url.searchParams.get('materialId') || '';
    const mat = db.materials.find(m => m.id === materialId && (!m.userId || m.userId === user.id));
    if (!mat) return send(res, 404, { error: '资料不存在' });
    if (mat.remoteProvider !== 'baidu-netdisk' || !mat.fsId) return send(res, 400, { error: '这不是可在线预览的百度网盘资源' });
    try {
      const accessToken = baiduNetdiskAccessToken({});
      const meta = await baiduNetdiskFileMeta(mat.fsId, accessToken);
      const dlink = `${meta.dlink}${meta.dlink.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
      const headers = { 'User-Agent': process.env.BAIDU_NETDISK_USER_AGENT || 'pan.baidu.com' };
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetch(dlink, { headers, redirect: 'follow' });
      if (!upstream.ok && upstream.status !== 206) throw new Error(`百度网盘文件读取失败 ${upstream.status}: ${await upstream.text()}`);
      const ext = path.extname(mat.name || mat.remotePath || '').toLowerCase();
      const outHeaders = {
        'Content-Type': upstream.headers.get('content-type') || MIME[ext] || 'application/octet-stream',
        'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
        'Cache-Control': 'private, max-age=300'
      };
      for (const h of ['content-length', 'content-range']) {
        const v = upstream.headers.get(h);
        if (v) outHeaders[h.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())] = v;
      }
      res.writeHead(upstream.status, outHeaders);
      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/netdisk/preview') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8') || '{}');
    const rawItems = Array.isArray(data.items) ? data.items : await listBaiduNetdisk(data);
    const allow = new Set(['.pdf','.mp4','.webm','.mov','.mkv','.mpv','.mp3','.wav','.m4a','.aac','.ogg','.flac','.doc','.docx','.txt','.md','.csv','.json']);
    const items = rawItems.filter(x => allow.has(path.extname(String(x.name || x.filename || x.path || '')).toLowerCase()));
    const classified = await aiClassifyNetdiskResources(db, items);
    saveDb(db);
    return send(res, 200, { items: items.map((item, i) => ({ ...item, classify: classified[i] })), aiProvider: publicAiProvider(routeAiProvider(db, 'grammar', 'A1', 'deepseek')), note: '已读取网盘目录总览，未下载文件正文；DeepSeek 不可用时使用本地规则兜底。' });
  }
  if (req.method === 'POST' && pathname === '/api/netdisk/import') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8') || '{}');
    const rawItems = Array.isArray(data.items) ? data.items : await listBaiduNetdisk(data);
    const allow = new Set(['.pdf','.mp4','.webm','.mov','.mkv','.mpv','.mp3','.wav','.m4a','.aac','.ogg','.flac','.doc','.docx','.txt','.md','.csv','.json']);
    const items = rawItems.filter(x => allow.has(path.extname(String(x.name || x.filename || x.path || '')).toLowerCase()));
    const classified = await aiClassifyNetdiskResources(db, items);
    const saved = []; const duplicates = [];
    for (let i = 0; i < items.length; i++) {
      const result = upsertNetdiskMaterial(db, user, items[i], classified[i]);
      if (result.duplicate) duplicates.push({ name: classified[i].name, duplicateOf: result.material.id });
      else saved.push(result.material);
    }
    const built = autoBuildCoursesFromMaterials(db, user, saved);
    const removed = dedupeMaterials(db, user);
    const issues = collectQuestionIssues(db, user);
    saveDb(db);
    return send(res, 200, { imported: saved.length, duplicates, removed, courses: built.courses, generatedQuestions: built.generatedQuestions, issues, note: '网盘资源已自动分级归档、批量绑定 materialId、建课、生成配套练习/每日德语听力，并执行 /api/dedupe 去重。' });
  }
  if (req.method === 'GET' && pathname === '/api/question-issues') {
    const user = requireAuth(db, req, res); if (!user) return;
    const issues = collectQuestionIssues(db, user); saveDb(db); return send(res, 200, issues);
  }
  if (req.method === 'POST' && pathname === '/api/question-issues/fix') {
    const user = requireAuth(db, req, res); if (!user) return;
    const fixed = autoFixQuestions(db, user); const issues = collectQuestionIssues(db, user); saveDb(db); return send(res, 200, { fixed, issues });
  }

  if (req.method === 'POST' && pathname === '/api/dedupe') {
    const user = requireAuth(db, req, res); if (!user) return;
    const removed = dedupeMaterials(db, user); saveDb(db); return send(res, 200, { removed });
  }
  if (req.method === 'GET' && pathname === '/api/grammar-mistakes') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, { items: db.grammarMistakes.filter(x => x.userId === user.id).slice(0, 300) });
  }
  if (req.method === 'POST' && pathname === '/api/translate') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    try { return send(res, 200, await translateViaProvider(data.text, data.from || 'auto', data.to || 'ZH', data.provider || 'auto')); }
    catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/writing-correct') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const result = await aiCorrectWriting(db, data.text || '', data.level || 'A1');
    saveDb(db); return send(res, 200, result);
  }
  if (req.method === 'GET' && pathname === '/api/resources') {
    const user = requireAuth(db, req, res); if (!user) return;
    const kind = url.searchParams.get('kind') || '';
    const items = ownItems(db.materials, user).filter(m => !kind || m.kind === kind || m.category === kind).map(m => ({ ...m, viewUrl: resourceUrlForMaterial(m) })).slice(0, 300);
    return send(res, 200, { items });
  }
  if (req.method === 'POST' && pathname === '/api/checkin') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const today = new Date().toISOString().slice(0, 10);
    const existing = db.attempts.find(a => a.userId === user.id && a.type === 'checkin' && a.date === today);
    const item = existing || { id: id('chk'), userId: user.id, type: 'checkin', date: today, createdAt: new Date().toISOString() };
    Object.assign(item, { minutes: Number(data.minutes || item.minutes || 0), note: data.note || item.note || '今日德语打卡', updatedAt: new Date().toISOString() });
    if (!existing) db.attempts.unshift(item);
    saveDb(db); return send(res, 200, { item });
  }
  if (req.method === 'POST' && pathname === '/api/tts') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    try {
      const audio = await microsoftTts(data.text || '', data.voice || 'de-DE-KatjaNeural', data.rate || '0%');
      if (audio) return send(res, 200, { ok: true, ...audio });
    } catch (e) { return send(res, 502, { error: e.message }); }
    return send(res, 200, { ok: false, provider: { id: 'browser-speech', name: '浏览器 de-DE 朗读', type: 'local', enabled: true }, text: data.text || '', note: '未配置 AZURE_TTS_KEY/AZURE_TTS_REGION，前端会自动使用浏览器 de-DE 朗读兜底。' });
  }
  if (req.method === 'GET' && pathname === '/api/ai-chat') {
    const user = currentUser(db, req);
    if (!user) return send(res, 200, { chats: [] });
    const sid = url.searchParams.get('sessionId') || '';
    const chats = db.aiChats.filter(x => x.userId === user.id && (!sid || x.sessionId === sid)).slice(0, 50);
    return send(res, 200, { chats });
  }
  if (req.method === 'GET' && pathname === '/api/ai/sessions') {
    const user = requireAuth(db, req, res); if (!user) return;
    return send(res, 200, { sessions: db.aiChatSessions.filter(s => s.userId === user.id).slice(0, 100) });
  }
  if (req.method === 'POST' && pathname === '/api/ai/session') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const session = { id: id('ais'), userId: user.id, title: data.title || '新的 AI 会话', summary: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.aiChatSessions.unshift(session); saveDb(db); return send(res, 200, { session });
  }
  if (req.method === 'POST' && pathname === '/api/ai/compact') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const sid = data.sessionId || '';
    const chats = db.aiChats.filter(x => x.userId === user.id && (!sid || x.sessionId === sid));
    const c = compactHistory(chats.reverse());
    const session = db.aiChatSessions.find(s => s.id === sid && s.userId === user.id);
    if (session) { session.summary = c.summary || session.summary; session.updatedAt = new Date().toISOString(); }
    if (data.clear !== false && sid) db.aiChats = db.aiChats.filter(x => !(x.userId === user.id && x.sessionId === sid && !c.history.some(h => h.id === x.id)));
    saveDb(db); return send(res, 200, { summary: c.summary, kept: c.history.length });
  }
  if (req.method === 'POST' && pathname === '/api/ai-chat') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (String(data.text || '').trim() === '/compact') {
      const chats = db.aiChats.filter(x => x.userId === user.id && (!data.sessionId || x.sessionId === data.sessionId));
      const c = compactHistory(chats.reverse());
      saveDb(db); return send(res, 200, { chat: { id: id('chat'), userId: user.id, sessionId: data.sessionId || '', mode: 'system', level: data.level || 'A1', text: '/compact', nativeReply: '已压缩历史会话。', correctedText: '', reply: c.summary || '当前历史较短，无需压缩。', grammarHints: [], pronunciationNotes: [], structureProblems: [], shadowing: [], score: null, correctionTemplate: { totalScore: 0, subScores: {}, nativeRewrite: '', errors: [] }, createdAt: new Date().toISOString() } });
    }
    let sessionId = data.sessionId || '';
    if (!sessionId) {
      const session = { id: id('ais'), userId: user.id, title: String(data.text || '新的 AI 会话').slice(0, 28), summary: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.aiChatSessions.unshift(session); sessionId = session.id; data.sessionId = sessionId;
    }
    const entry = await aiChatResponse(db, user, data);
    db.aiChats.unshift({ ...entry, userText: entry.text });
    const session = db.aiChatSessions.find(s => s.id === sessionId && s.userId === user.id);
    if (session) { session.updatedAt = new Date().toISOString(); if (!session.title || session.title === '新的 AI 会话') session.title = entry.text.slice(0, 28) || session.title; session.lastMessage = entry.nativeReply || entry.reply; }
    for (const e of (entry.correctionTemplate?.errors || [])) db.grammarMistakes.unshift({ id: id('gm'), userId: user.id, chatId: entry.id, sessionId, type: e.type, original: e.original, correction: e.correction, explanation: e.explanation, nextReviewAt: new Date(Date.now() + 24*3600*1000).toISOString(), intervalDays: 1, reviewed: false, createdAt: new Date().toISOString() });
    saveDb(db);
    return send(res, 200, { chat: entry });
  }
  if (req.method === 'GET' && pathname === '/api/course-print') {
    const user = requireAuth(db, req, res); if (!user) return;
    const course = db.courses.find(c => c.id === url.searchParams.get('id') && (!c.userId || c.userId === user.id));
    if (!course) return send(res, 404, '课程不存在', 'text/plain; charset=utf-8');
    const scoped = withUserScope(db, user);
    const materials = scoped.materials.filter(m => (course.materialIds || []).includes(m.id));
    const exercises = recommendAfterCourse(scoped, course).slice(0, 8);
    const html = buildCourseDoc(course, materials, exercises);
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && pathname === '/api/course-ppt') {
    const user = requireAuth(db, req, res); if (!user) return;
    const course = db.courses.find(c => c.id === url.searchParams.get('id') && (!c.userId || c.userId === user.id));
    if (!course) return send(res, 404, '课程不存在', 'text/plain; charset=utf-8');
    const scoped = withUserScope(db, user);
    const materials = scoped.materials.filter(m => (course.materialIds || []).includes(m.id));
    const exercises = recommendAfterCourse(scoped, course).slice(0, 8);
    return send(res, 200, buildPptDoc(course, materials, exercises), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && pathname === '/api/question') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const q = { id: id('q'), userId: user.id, title: data.title || '', stem: data.stem || '', type: data.type || 'short', level: data.level || 'A1', category: data.category || '书本习题', source: data.source || '', options: data.options || [], answer: data.answer || '', explanation: data.explanation || '', audioId: data.audioId || '', materialIds: data.materialIds || [], tags: data.tags || [], createdAt: new Date().toISOString() };
    q.validationErrors = validateQuestion(q, db, user); db.questions.unshift(q); saveDb(db); return send(res, 200, { question: q });
  }
  if (req.method === 'POST' && pathname === '/api/import-json') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8') || '{}');
    const items = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(items)) return send(res, 400, { error: 'JSON 需要是题目数组，或 { questions: [...] }' });
    const added = items.map(item => { const q = { id: id('q'), userId: user.id, title: item.title || '', stem: item.stem || '', type: item.type || 'short', level: item.level || 'A1', category: item.category || '书本习题', source: item.source || '', options: item.options || [], answer: item.answer || '', explanation: item.explanation || '', audioId: item.audioId || '', materialIds: item.materialIds || [], tags: item.tags || [], createdAt: new Date().toISOString() }; q.validationErrors = validateQuestion(q, db, user); return q; });
    db.questions.unshift(...added); saveDb(db); return send(res, 200, { added: added.length, questions: added });
  }
  if (req.method === 'POST' && pathname === '/api/upload') {
    const user = requireAuth(db, req, res); if (!user) return;
    const body = JSON.parse((await readBody(req, 80 * 1024 * 1024)).toString('utf8') || '{}');
    const parsed = parseDataUrl(body.dataUrl); if (!parsed) return send(res, 400, { error: '缺少 dataUrl' });
    const original = safeName(body.name || 'file'); const ext = path.extname(original).toLowerCase();
    const kind = body.kind || (parsed.mime.startsWith('video/') ? 'video' : parsed.mime.startsWith('audio/') ? 'audio' : 'file');
    const category = body.category || inferMaterialCategory(kind, original, parsed.mime);
    const folder = safeName(category); const dir = path.join(UPLOADS, folder); fs.mkdirSync(dir, { recursive: true });
    const hash = hashBuffer(parsed.data);
    const dupe = db.materials.find(m => (!m.userId || m.userId === user.id) && (m.hash === hash || (m.kind === kind && normalizeDuplicateKey(m) === `${kind}|${category}|${original.toLowerCase()}|${parsed.data.length}`)));
    if (dupe) return send(res, 200, { material: dupe, duplicate: true, skipped: true });
    const filename = `${Date.now()}_${original}`; const filePath = path.join(dir, filename); fs.writeFileSync(filePath, parsed.data);
    const parsedInfo = analyseUploadedMaterialBuffer(original, parsed.mime, parsed.data);
    const mat = { id: id('mat'), userId: user.id, name: original, kind, category, level: body.level || '', source: body.source || '百度网盘/本地导入', path: `/uploads/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`, mime: parsed.mime, size: parsed.data.length, hash, tags: body.tags || [], parseInfo: parsedInfo, createdAt: new Date().toISOString() };
    db.materials.unshift(mat); const course = autoCourseFromMaterial(db, user, mat); saveDb(db); return send(res, 200, { material: mat, course, duplicate: false });
  }
  if (req.method === 'POST' && pathname === '/api/upload/batch') {
    const user = requireAuth(db, req, res); if (!user) return;
    const body = JSON.parse((await readBody(req, 120 * 1024 * 1024)).toString('utf8') || '{}');
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return send(res, 400, { error: '缺少上传项' });
    const saved = [];
    const skipped = [];
    for (const item of items) {
      const parsed = parseDataUrl(item.dataUrl); if (!parsed) continue;
      const original = safeName(item.name || 'file');
      const kind = item.kind || (parsed.mime.startsWith('video/') ? 'video' : parsed.mime.startsWith('audio/') ? 'audio' : 'file');
      const category = item.category || inferMaterialCategory(kind, original, parsed.mime);
      const folder = safeName(category); const dir = path.join(UPLOADS, folder); fs.mkdirSync(dir, { recursive: true });
      const hash = hashBuffer(parsed.data);
      const dupe = db.materials.find(m => (!m.userId || m.userId === user.id) && (m.hash === hash || (m.kind === kind && normalizeDuplicateKey(m) === `${kind}|${category}|${original.toLowerCase()}|${parsed.data.length}`)));
      if (dupe) { skipped.push({ name: original, duplicateOf: dupe.id }); continue; }
      const filename = `${Date.now()}_${original}`; fs.writeFileSync(path.join(dir, filename), parsed.data);
      const parsedInfo = analyseUploadedMaterialBuffer(original, parsed.mime, parsed.data);
      const mat = { id: id('mat'), userId: user.id, name: original, kind, category, level: item.level || '', source: item.source || '百度网盘/本地导入', path: `/uploads/${encodeURIComponent(folder)}/${encodeURIComponent(filename)}`, mime: parsed.mime, size: parsed.data.length, hash, tags: item.tags || [], parseInfo: parsedInfo, createdAt: new Date().toISOString() };
      db.materials.unshift(mat); autoCourseFromMaterial(db, user, mat); saved.push(mat);
    }
    saveDb(db);
    return send(res, 200, { materials: saved, skipped, deletedDuplicates: skipped.length });
  }
  if (req.method === 'POST' && pathname === '/api/attempt') {
    const user = requireAuth(db, req, res); if (!user) return;
    const data = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const q = db.questions.find(x => x.id === data.questionId && (!x.userId || x.userId === user.id)); if (!q) return send(res, 404, { error: '题目不存在' });
    const correct = String(data.answer || '').trim().toLowerCase() === String(q.answer || '').trim().toLowerCase();
    const attempt = { id: id('att'), userId: user.id, questionId: q.id, userAnswer: data.answer || '', correct, difficulty: correct ? '' : (q.explanation || '请复习本题涉及的语法点/知识点'), createdAt: new Date().toISOString() };
    db.attempts.unshift(attempt); saveDb(db); return send(res, 200, { attempt, question: q });
  }
  return send(res, 404, { error: 'API 不存在' });
}

function staticFile(req, res, pathname) {
  let file;
  if (pathname.startsWith('/uploads/')) file = path.join(ROOT, decodeURIComponent(pathname));
  else file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  const normalized = path.normalize(file);
  if (!(normalized.startsWith(PUBLIC) || normalized.startsWith(UPLOADS))) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(normalized, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(normalized).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

ensure();
function appHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url.pathname, url).catch(e => send(res, 500, { error: e.message }));
  return staticFile(req, res, url.pathname);
}

if (require.main === module) {
  http.createServer(appHandler).listen(PORT, () => console.log(`Deutsch Study App running: http://localhost:${PORT}`));
}

module.exports = appHandler;

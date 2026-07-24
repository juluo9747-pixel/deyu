const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
if (!fs.existsSync(DB_PATH)) {
  console.error('data/db.json 不存在');
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const seen = new Map();
const removed = [];
const keep = [];
function fileHash(m) {
  if (m.hash) return m.hash;
  if (!m.path) return '';
  try {
    const fp = path.join(ROOT, decodeURIComponent(m.path));
    if (!fs.existsSync(fp)) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
  } catch { return ''; }
}
function key(m) {
  const name = String(m.name || '').toLowerCase().replace(/(?:\s*\(\d+\)|_copy|副本|重复)$/g, '');
  return fileHash(m) || `${m.kind || ''}|${m.category || ''}|${name}|${m.size || 0}`;
}
for (const m of db.materials || []) {
  const k = key(m);
  if (seen.has(k)) {
    removed.push({ id: m.id, name: m.name, duplicateOf: seen.get(k).id });
    try {
      const fp = m.path ? path.join(ROOT, decodeURIComponent(m.path)) : '';
      if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
  } else {
    seen.set(k, m);
    keep.push(m);
  }
}
db.materials = keep;
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(JSON.stringify({ removed: removed.length, items: removed }, null, 2));

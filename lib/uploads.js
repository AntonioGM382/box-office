// Pasted images (data/uploads/<day>/), the upload quota, and the long-text file for herdr.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./store');
const { noCtl } = require('./util');
const { send } = require('./http');

function longTextRef(text) { // saved next to the pasted images; Claude reads it with one Read call
  const dir = path.join(UP_DIR, new Date().toISOString().slice(0, 10)); fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, crypto.randomBytes(12).toString('hex') + '.txt'); fs.writeFileSync(fp, noCtl(text), { mode: 0o600 });
  return `[Attached text (${String(text).length} characters): ${fp}] My message was too long to type, so it is in that file. Read it and treat it as my message.`;
}

// ---------- pasted images: saved under data/uploads/<day>/, referenced by path in the text; headless workers also get the real image block ----------
const UP_DIR = path.join(DATA, 'uploads'), UP_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }, UP_MAX = 10 * 1024 * 1024, UP_NAME = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;
// total quota for data/uploads: when a new image would push it over, the oldest files go first
// Too big: answer 413 and close, but drain what the client is still sending (up to 64 MB) so it reads the 413 instead of a reset.
function upTooBig(req, res) {
  res.setHeader('Connection', 'close'); send(res, 413, { error: 'Image is over 10 MB' });
  let n = 0; req.on('data', d => { n += d.length; if (n > 64 * 1024 * 1024) req.destroy(); }); req.resume();
}
const UP_QUOTA = (Number(process.env.OFFICE_UPLOAD_QUOTA_MB) || 200) * 1024 * 1024;
function trimUploads(incoming) {
  try {
    const files = [];
    for (const d of fs.readdirSync(UP_DIR)) { const dir = path.join(UP_DIR, d); let names; try { names = fs.readdirSync(dir); } catch { continue; } for (const f of names) { const fp = path.join(dir, f); try { const st = fs.statSync(fp); if (st.isFile()) files.push({ fp, size: st.size, t: st.mtimeMs }); } catch {} } }
    let total = files.reduce((a, f) => a + f.size, 0) + incoming;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) { if (total <= UP_QUOTA) break; try { fs.unlinkSync(f.fp); total -= f.size; } catch {} }
  } catch {}
}
const upSniff = (b, e) => e === 'png' ? b.slice(0, 4).toString('hex') === '89504e47' : e === 'jpg' ? b.slice(0, 3).toString('hex') === 'ffd8ff' : e === 'gif' ? b.slice(0, 4).toString() === 'GIF8' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
function upBlocks(list) { // paths the client got from /api/uploads (anything outside data/uploads/<day>/ is ignored) -> Anthropic image blocks
  const out = [];
  for (const f of (Array.isArray(list) ? list : []).slice(0, 6)) {
    try {
      const fp = path.resolve(String(f)), name = path.basename(fp);
      if (path.dirname(path.dirname(fp)) !== path.resolve(UP_DIR) || !UP_NAME.test(name)) continue;
      const ext = name.split('.').pop();
      out.push({ type: 'image', source: { type: 'base64', media_type: ext === 'jpg' ? 'image/jpeg' : 'image/' + ext, data: fs.readFileSync(fp).toString('base64') } });
    } catch {}
  }
  return out;
}

module.exports = { longTextRef, UP_DIR, UP_EXT, UP_MAX, upTooBig, trimUploads, upSniff, upBlocks };

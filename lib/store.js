// Shared state and persistence: the DATA_DIR lock, atomic JSON files, workers / coordinator state, chats, runtime.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..'); // the project folder: lib/ sits one level down

const PORT = process.env.PORT || 3001;
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
for (const d of ['', 'chats', 'settings']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

// ---------- one office per DATA_DIR: a lock file with the owner's pid + port ----------
// Two servers writing the same workers.json / chats would silently overwrite each other. A lock whose pid is gone (or whose
// port no longer answers: Windows reuses pids) is stale and taken over.
const LOCK_FILE = path.join(DATA, '.office.lock');
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function portAnswers(port) { // synchronous 300 ms TCP probe (boot only), in a child so the lock check stays before any write
  try { require('child_process').execFileSync(process.execPath, ['-e', `const s=require('net').connect(${Number(port)},'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),300)`], { timeout: 3000, windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; }
}
function takeLock() {
  const mine = JSON.stringify({ pid: process.pid, port: Number(PORT), at: Date.now() });
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(LOCK_FILE, mine, { flag: 'wx' }); return; } catch (e) { if (e.code !== 'EEXIST') { console.error('[lock] could not create', LOCK_FILE + ':', e.message); return; } }
    let cur = null; try { cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch {}
    if (cur && Number.isInteger(cur.pid) && cur.pid !== process.pid && pidAlive(cur.pid) && (!cur.port || Date.now() - (cur.at || 0) < 60e3 || portAnswers(cur.port))) { // a young lock may still be booting
      console.error(`[lock] another office (pid ${cur.pid}, port ${cur.port}) is already using ${DATA}. Stop it first, or start this one with its own DATA_DIR.`);
      process.exit(1);
    }
    console.warn('[lock] taking over a stale lock' + (cur ? ` (pid ${cur.pid} is gone)` : ''));
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}
function releaseLock() { try { const cur = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch {} }
takeLock();
process.on('exit', releaseLock);

const STALE_MS = 30 * 60 * 1000;
const APPROVAL_TIMEOUT_MS = 9 * 60 * 1000;
const SAFE_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ToolSearch', 'WebSearch', 'WebFetch', 'Skill']);

// ---------- persistence ----------
// Writes are atomic (tmp + rename) and the previous good copy is kept as <file>.bak. A file that fails to parse is never
// silently replaced by the default: it is moved aside to <file>.corrupt-<ts> (loudly logged) and the .bak is used instead.
function readJson(f, dflt) {
  const fp = path.join(DATA, f);
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[data] could not read ${fp}: ${e.message}`);
    return readBak(fp, dflt, e.code === 'ENOENT' ? null : e.message);
  }
  try { return JSON.parse(raw); } catch (e) {
    const aside = fp + '.corrupt-' + Date.now();
    try { fs.renameSync(fp, aside); } catch {}
    console.error(`[data] !!! ${fp} is corrupt (${e.message}); moved to ${aside}`);
    return readBak(fp, dflt, 'corrupt');
  }
}
function readBak(fp, dflt, why) {
  let raw; try { raw = fs.readFileSync(fp + '.bak', 'utf8'); } catch { if (why) console.error(`[data] !!! no backup for ${fp}; starting it empty`); return dflt; }
  try { const v = JSON.parse(raw); console.error(`[data] restored ${fp} from ${fp}.bak` + (why ? '' : ' (the file itself was missing)')); return v; }
  catch { console.error(`[data] !!! ${fp}.bak is corrupt too; starting it empty`); return dflt; }
}
function writeJson(f, v) {
  const fp = path.join(DATA, f), tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  try { fs.renameSync(fp, fp + '.bak'); } catch {} // the last good copy (a crash right here leaves only the .bak: readJson restores it)
  for (let i = 0; ; i++) { // Windows: a reader (antivirus, indexer) can hold the target for a moment
    try { fs.renameSync(tmp, fp); return; } catch (e) {
      if (i >= 4 || (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES')) { try { fs.copyFileSync(tmp, fp); fs.unlinkSync(tmp); return; } catch {} throw e; } // last resort: a plain copy beats losing the write
      const t = Date.now() + 20 * (i + 1); while (Date.now() < t);
    }
  }
}

// Shared state. Fields that get REASSIGNED live on S and are always read as S.<name> (a destructured copy would go stale):
// workers, herdrAgents (herdr.js swaps in a new map every poll), econReady (server.js sets it once the economy is loaded),
// coordSaveTimer (coordinator.js; flushed by server.js on shutdown). Everything else is mutated in place, never replaced:
// it is on S too (Object.assign at the bottom) and also exported by name.
const S = {
  workers: readJson('workers.json', []),
  herdrAgents: new Map(), // claude session id -> {paneId,status,title,cwd}
  econReady: false, // economy.init (slow key load) runs after listen(); see the bottom of server.js
  coordSaveTimer: null,
};
const saveWorkers = () => writeJson('workers.json', S.workers);
const coordState = Object.assign({ enabled: true, rules: {} }, readJson('coordinator.json', {}));
const saveCoord = () => writeJson('coordinator.json', coordState);
const coordLog = [];

const chats = new Map(); // workerId -> messages[]
function chatOf(id) {
  if (!chats.has(id)) chats.set(id, readJson(`chats/${id}.json`, []));
  return chats.get(id);
}
const saveTimers = new Map();
function saveChatSoon(id) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => saveChatNow(id), 400));
}
function saveChatNow(id) {
  clearTimeout(saveTimers.get(id)); saveTimers.delete(id);
  if (!chats.has(id)) return; // deleted meanwhile
  try { writeJson(`chats/${id}.json`, chats.get(id)); } catch (e) { console.error('[data] could not save chat', id, e.message); }
}

// ---------- runtime state ----------
const runtime = new Map(); // workerId -> {proc,status,tool,toolDetail,agents,lastText,unread,msgCount,procCost}
function rt(id) {
  if (!runtime.has(id)) runtime.set(id, { proc: null, status: 'offline', tool: null, toolDetail: null, agents: [], lastText: '', unread: false, msgCount: chatOf(id).length, procCost: 0, buf: '' });
  return runtime.get(id);
}
const observed = new Map();
const pending = new Map(); // pendingId -> {id,workerId,tool,input,summary,t,res,timer}
const clients = new Set();

function addMsg(workerId, m) {
  const r = rt(workerId);
  const list = chatOf(workerId);
  list.push({ id: crypto.randomUUID(), t: Date.now(), ...m });
  if (list.length > 500) list.splice(0, list.length - 500);
  r.msgCount++;
  saveChatSoon(workerId);
}

const workerSessionIds = () => new Set(S.workers.map(w => w.claudeSessionId).filter(Boolean));

// The name shown in the page, tab and notifications. On-disk names (data/, the key folder, localStorage keys) never change with it.
const OFFICE_NAME = String(process.env.OFFICE_NAME || 'Box Office').slice(0, 40), OFFICE_NAME_HTML = OFFICE_NAME.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

Object.assign(S, { coordState, coordLog, chats, runtime, observed, pending, clients });
module.exports = { ROOT, PORT, DATA, LOCK_FILE, STALE_MS, APPROVAL_TIMEOUT_MS, SAFE_TOOLS, S, saveWorkers, coordState, saveCoord, coordLog, chats, chatOf, saveTimers, saveChatSoon, saveChatNow, runtime, rt, observed, pending, clients, addMsg, workerSessionIds, OFFICE_NAME, OFFICE_NAME_HTML };

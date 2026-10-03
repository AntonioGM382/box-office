// Small pure helpers shared by every module: lru, base, clip, toolDetail, noCtl.

// tiny LRU: Map order = recency (get moves the key to the end, set evicts the oldest past max)
function lru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); return this; },
    has: k => m.has(k), delete: k => m.delete(k), clear: () => m.clear(), get size() { return m.size; },
  };
}

// ---------- helpers ----------
const base = p => (p ? String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '');
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function toolDetail(name, input) {
  input = input && typeof input === 'object' ? input : {};
  const has = v => typeof v === 'string' ? v.trim() !== '' : v != null && v !== ''; // an empty field never yields "Running: " or `Searching for ""`
  const one = v => String(v);
  switch (name) {
    case 'Read': return base(input.file_path) ? `Reading ${base(input.file_path)}` : 'Reading a file';
    case 'Edit': case 'MultiEdit': return base(input.file_path) ? `Editing ${base(input.file_path)}` : 'Editing a file';
    case 'Write': return base(input.file_path) ? `Writing ${base(input.file_path)}` : 'Writing a file';
    case 'Bash': case 'PowerShell': return has(input.command) ? `Running: ${clip(one(input.command), 70)}` : 'Running a command';
    case 'Grep': return has(input.pattern) ? `Searching for "${clip(one(input.pattern), 40)}"` : 'Searching';
    case 'Glob': return has(input.pattern) ? `Finding files: ${clip(one(input.pattern), 40)}` : 'Finding files';
    case 'WebFetch': case 'WebSearch': return 'Browsing the web';
    case 'Agent': case 'Task': return `Delegating: ${clip(input.description || input.subagent_type || 'a task', 60)}`;
    default:
      if (String(name).startsWith('mcp__')) return `Using ${String(name).split('__').pop()}`;
      return name || null;
  }
}

// Control bytes never reach a terminal: ESC / CSI (bracketed-paste end "\x1b[201~", OSC title, screen clears), ^C ^D, CR (an
// early Enter) and the C1 range. Only \n and \t survive. Applied to every text herdr types, and to the long-text file.
const noCtl = t => String(t ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '');

module.exports = { lru, base, clip, toolDetail, noCtl };

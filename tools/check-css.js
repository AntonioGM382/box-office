// Guard: a bare `.red{padding;border}` panel rule once squashed the context meter whose modifier class was also "red".
// Reports (1) standalone `.name` rules with box/layout props that JS/HTML also use as a modifier class on other elements,
// (2) var(--x) used but never defined, (3) z-index map.  usage: node tools/check-css.js  (exit 1 on collisions/missing vars)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public'), rd = d => fs.readdirSync(path.join(root, d)).filter(f => fs.statSync(path.join(root, d, f)).isFile()).map(f => [f, fs.readFileSync(path.join(root, d, f), 'utf8')]);
const css = rd('css').filter(x => x[0].endsWith('.css')), js = rd('js').filter(x => x[0].endsWith('.js')).concat([['index.html', fs.readFileSync(path.join(root, 'index.html'), 'utf8')]]);
const BOX = /(?:^|;)\s*(padding|margin|border|display|position|width|height|min-height|min-width|overflow)\b[\w-]*\s*:/;
const rules = []; let bad = 0;
for (const [f, raw] of css) {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  for (const m of src.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const line = src.slice(0, m.index).split('\n').length + (m[1].match(/^\s*\n/g) ? 0 : 0);
    for (const sel of m[1].split(',').map(s => s.trim())) { const k = sel.match(/^\.([A-Za-z][\w-]*)$/); if (k && BOX.test(';' + m[2])) rules.push({ n: k[1], f, line, body: m[2].trim().slice(0, 60) }); }
  }
}
const ALLOW = new Set(['wfo', 'dtabs']); // reviewed: deliberate shared skins (.wcard also wears .wfo; .dtabs sits beside .econ .tabs)
const names = [...new Set(rules.map(r => r.n))].filter(n => n.length <= 6 && !/^(st|k-)/.test(n) && !ALLOW.has(n)); // short generic names only; longer ones are nearly always unique component classes
// modifier use = name is a NON-first token of a class string (class="x n", class="x \${c ? 'n' : ''}", className=, classList.add/toggle('n')); first-token use is the element's own base class
const mods = new Map(), bases = new Set(); // name -> ["file:line <class string>"]
const add = (n, f, s, i, str) => { if (!mods.has(n)) mods.set(n, []); mods.get(n).push(f + ':' + s.slice(0, i).split('\n').length + ' <' + str.trim().slice(0, 40) + '>'); };
for (const [f, s] of js) {
  for (const m of s.matchAll(/class(?:Name)?\s*=\s*(["'])((?:(?!\1)[^\n])*)\1|class(?:Name)?\s*=\s*\x60((?:[^\x60]|\n)*?)\x60/g)) {
    const v = m[2] != null ? m[2] : m[3];
    v.replace(/\$\{([^}]*)\}/g, (_, e) => { for (const q of e.matchAll(/['"]([^'"]+)['"]/g)) q[1].split(/\s+/).forEach(t => add(t, f, s, m.index, v)); });
    v.replace(/\$\{[^}]*\}/g, ' \u0001 ').split(/\s+/).filter(t => t && t !== '\u0001').forEach((t, i) => i > 0 ? add(t, f, s, m.index, v) : bases.add(t));
  }
  for (const m of s.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) add(q[1], f, s, m.index, m[0]);
}
// only names that are ALSO some element's own base class can collide
for (const n of names) if (mods.has(n) && bases.has(n)) { bad++; const d = rules.filter(r => r.n === n); console.log('COLLISION .' + n + '\n  defined: ' + d.map(r => r.f + ':' + r.line + ' {' + r.body + '}').join(' | ') + '\n  modifier use: ' + [...new Set(mods.get(n))].slice(0, 6).join('; ')); }
// missing vars
const all = css.map(x => x[1]).join('\n') + js.map(x => x[1]).join('\n'), def = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])), set2 = new Set([...all.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)].map(m => m[1]));
for (const m of all.matchAll(/var\((--[\w-]+)\s*(,)?/g)) if (!def.has(m[1]) && !set2.has(m[1]) && !m[2]) { console.log(`MISSING VAR ${m[1]} (no fallback)`); def.add(m[1]); bad++; }
// z-index map
const z = []; for (const [f, s] of css) for (const m of s.matchAll(/([^{}]+)\{[^{}]*z-index\s*:\s*(-?\d+)/g)) z.push([+m[2], f, m[1].trim().replace(/\s+/g, ' ').slice(0, 40)]);
console.log('z-index (high to low): ' + z.sort((a, b) => b[0] - a[0]).map(x => `${x[0]} ${x[2]}`).join(' | '));
console.log(bad ? bad + ' problem(s)' : 'no collisions, no missing vars'); process.exit(bad ? 1 : 0);

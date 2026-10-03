// Guard: classic <script>s share one global scope, so a duplicate top-level function/const/let name silently
// overrides the earlier file (renderLog in coordinator.js once replaced drawer.js's and blanked the chat drawer).
// usage: node tools/check-globals.js   (exit 1 on duplicates)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'public', 'js'), seen = new Map(); let bad = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    const prev = seen.get(m[1]);
    if (prev && prev !== f) { console.log(`DUPLICATE ${m[1]}: ${prev} and ${f}`); bad++; } else seen.set(m[1], f);
  }
}
console.log(bad ? bad + ' duplicate(s)' : 'no duplicate top-level names'); process.exit(bad ? 1 : 0);

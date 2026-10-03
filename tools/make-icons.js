// Renders the app icons (public/icon-*.png) from the mascot registry in public/js/office.js via tools/shot.js (headless Chrome).
//   node tools/make-icons.js           the original "pixel" mascot -> public/icon-192.png, icon-512.png, icon-maskable-512.png
//   node tools/make-icons.js --local   the active local skin (public/js/local/mascot-claude.js, gitignored) -> public/js/local/icons/
//                                      (never touches the public PNGs; copy them over by hand if you want the local look installed)
//   node tools/make-icons.js --print   print the favicon data-URI and the header mark of the original mascot, then exit
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'public');
const LOCAL = process.argv.includes('--local');

// the registry block of office.js (between the MASCOTS-BEGIN / MASCOTS-END markers) runs in a bare context: it only needs R() when drawing
const src = fs.readFileSync(path.join(root, 'js', 'office.js'), 'utf8');
const a = src.indexOf('// MASCOTS-BEGIN'), b = src.indexOf('// MASCOTS-END');
if (a < 0 || b < 0) { console.error('MASCOTS-BEGIN/END markers not found in public/js/office.js'); process.exit(1); }
const ctx = vm.createContext({});
vm.runInContext(src.slice(a, b), ctx);
if (LOCAL) {
  const lf = path.join(root, 'js', 'local', 'mascot-claude.js');
  if (!fs.existsSync(lf)) { console.error('no local skin at ' + lf); process.exit(1); }
  vm.runInContext(fs.readFileSync(lf, 'utf8'), ctx);
}
const spec = vm.runInContext('mascotNow()', ctx), svgOf = (pad, size, round) => { ctx.__a = [spec, pad, size, round]; return vm.runInContext('mascotIconSvg(...__a)', ctx); };

if (process.argv.includes('--print')) {
  console.log('favicon href:\ndata:image/svg+xml,' + encodeURIComponent(svgOf(0, 0, true)).replace(/'/g, '%27'));
  ctx.__s = spec; const m = vm.runInContext('mascotMark(__s)', ctx);
  console.log('\nheader mark:\n<svg class="mark" viewBox="' + m.vb + '" aria-hidden="true" shape-rendering="crispEdges">' + m.svg + '</svg>');
  process.exit(0);
}

const out = LOCAL ? path.join(root, 'js', 'local', 'icons') : root;
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
for (const [file, size, pad] of [['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['icon-maskable-512.png', 512, 4]]) { // maskable icons need a safe zone (pad)
  const html = path.join(tmp, file + '.html');
  fs.writeFileSync(html, `<html><body style="margin:0;background:#1e1b2e">${svgOf(pad, size, false)}</body></html>`);
  execFileSync('node', [path.join(__dirname, 'shot.js'), 'file:///' + html.replace(/\\/g, '/'), path.join(out, file), String(size), String(size), '600'], { stdio: 'inherit' });
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log((LOCAL ? 'local skin "' + spec.name + '"' : 'mascot "' + spec.name + '"') + ' icons written to ' + out);

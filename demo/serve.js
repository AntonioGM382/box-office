'use strict';
// Runs server.js for the demo office, and tidies up after itself: when the demo launcher dies (even killed hard, where it
// cannot run its own cleanup) this wrapper stops the server and deletes the throw-away folder. Only env vars set by demo.js
// reach the server; nothing here touches your real ~/.claude or data/.
const fs = require('fs');
const parent = Number(process.env.BOX_OFFICE_DEMO_PARENT), tmp = process.env.BOX_OFFICE_DEMO_TMP;
delete process.env.BOX_OFFICE_DEMO_PARENT; delete process.env.BOX_OFFICE_DEMO_TMP;
// Files this process still holds cannot be removed from inside it, so a detached helper deletes the folder once it has exited.
const clean = () => {
  if (!tmp || !/box-office-demo-/.test(tmp) || !fs.existsSync(tmp)) return;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  if (!fs.existsSync(tmp)) return;
  try { require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{try{require("fs").rmSync(process.argv[1],{recursive:true,force:true,maxRetries:30,retryDelay:300})}catch{}},1500)', tmp], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch {}
};
require('../server.js');
let gone = false;
if (parent > 0) setInterval(() => {
  try { process.kill(parent, 0); return; } catch (e) { if (e.code === 'EPERM') return; }
  if (gone) return; gone = true;
  process.emit('SIGINT'); // server.js saves and exits ~200 ms later
}, 2000);
process.on('exit', clean);

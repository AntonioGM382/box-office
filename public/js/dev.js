'use strict';
(() => { // hidden developer shortcut: Konami code opens a bare input; nothing on screen mentions it
  const SEQ = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']; let pos = 0, box = null;
  const close = () => { if (box) box.remove(); box = null; };
  document.addEventListener('keydown', ev => {
    const a = document.activeElement, typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    if (typing || box) { pos = 0; return; }
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    pos = k === SEQ[pos] ? pos + 1 : k === SEQ[0] ? 1 : 0;
    if (pos < SEQ.length) return;
    pos = 0; box = document.createElement('input'); box.type = 'password'; box.autocomplete = 'off'; box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;width:150px;font:12px monospace;background:#0e0d13;color:#ddd;border:1px solid #333;border-radius:4px;padding:3px 6px;outline:none';
    document.body.appendChild(box); box.focus();
    box.addEventListener('keydown', async e => {
      if (e.key === 'Escape') return close();
      if (e.key !== 'Enter') return; e.preventDefault();
      const b = box, r = await ecReq('POST', '/api/economy/dev/unlock', { passphrase: b.value });
      if (r.ok && r.j.ok) { close(); toast('🗝️ All items unlocked (' + (r.j.granted || 0) + ') · refunded ' + ((r.j.rebated && r.j.rebated.beans) || 0) + ' Beans + ' + ((r.j.rebated && r.j.rebated.gems) || 0) + ' Gems'); ecFull(true); }
      else { b.disabled = true; const an = b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], 300); an.onfinish = () => { if (box === b) close(); }; setTimeout(() => { if (box === b) close(); }, 600); }
    });
    box.addEventListener('blur', () => setTimeout(() => { if (box && document.activeElement !== box) close(); }, 150));
  });
})();
//ECON-END

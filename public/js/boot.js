'use strict';
// Load-time kicks that start async work (fetch, SSE, animation frames). They run last so no callback can fire before every other script has defined its globals.
loadRecent(); setInterval(loadRecent, 15000); // loadRecent itself skips a hidden tab and a collapsed Recent chats
connect();
requestAnimationFrame(frame);

// Theme, applied before first paint (this is the first classic script, and it sits in <head>): the stored choice wins, no choice = follow the system. The Theme switch in the header menu (core.js) writes the same key.
(function () { try { var t = localStorage.getItem('co_theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {} })();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

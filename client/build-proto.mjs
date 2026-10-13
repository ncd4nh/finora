// Ghép bản build prototype thành 1 file HTML (nội dung trang, không có <html>/<head>/<body>)
import fs from 'node:fs';
import path from 'node:path';

const dist = 'dist-proto/assets';
const files = fs.readdirSync(dist);
const js = fs.readFileSync(path.join(dist, files.find((f) => f.endsWith('.js'))), 'utf8');
const css = fs.readFileSync(path.join(dist, files.find((f) => f.endsWith('.css'))), 'utf8');
const wasm = fs.readFileSync(new URL('./node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)).toString('base64');
if (js.includes('</script')) throw new Error('JS chứa </script');

const CDN = [
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/prop-types@15.8.1/prop-types.min.js',
  'https://cdn.jsdelivr.net/npm/recharts@2.15.4/umd/Recharts.js',
  'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js',
];

const html = `<title>Finora</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Fredoka:wght@600;700&family=Quicksand:wght@600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${css}</style>
<div id="root"></div>
${CDN.map((u) => `<script src="${u}"></script>`).join('\n')}
<script>window.__SQL_WASM_B64="${wasm}";</script>
<script type="module">${js}</script>
`;
fs.mkdirSync('dist-proto', { recursive: true });
if (process.argv.includes('--demo')) {
  // Bản demo deploy tĩnh (VD: Vercel): trang HTML đầy đủ + favicon
  fs.mkdirSync('dist-demo', { recursive: true });
  fs.writeFileSync('dist-demo/index.html', `<!doctype html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/png" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#5c9442">
</head><body>
${html}</body></html>`);
  for (const f of ['favicon.png', 'apple-touch-icon.png']) fs.copyFileSync(`public/${f}`, `dist-demo/${f}`);
  console.log('✓ dist-demo/index.html');
} else {
  fs.writeFileSync(process.argv[2] || 'dist-proto/finora.html', html);
}
console.log('✓', (html.length / 1024).toFixed(0), 'KB');

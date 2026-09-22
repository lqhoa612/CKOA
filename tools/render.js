// Renders one HTML file to PDF. Called by tools/make-pdf.py, not on its own.
// Pass a third argument to drop the footer and print edge to edge (the cover).
// A global `npm install -g playwright` is not on node's default search path,
// so fall back to it rather than making the caller set NODE_PATH.
let playwright;
try {
  playwright = require('playwright');
} catch {
  const root = require('child_process')
    .execSync('npm root -g', { encoding: 'utf8' }).trim();
  playwright = require(root + '/playwright');
}
const { chromium } = playwright;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const [src, dest, bare] = process.argv.slice(2);
  await p.goto('file://' + src, { waitUntil: 'networkidle' });
  await p.pdf({
    path: dest,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: !bare,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#999;font-family:sans-serif;' +
      'padding:0 16mm;display:flex;justify-content:space-between;">' +
      '<span>Hướng dẫn sử dụng app đặt hàng — Saigon Express</span>' +
      '<span class="pageNumber"></span></div>',
    margin: bare ? { top: 0, bottom: 0, left: 0, right: 0 }
                 : { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' }
  });
  await b.close();
  console.log('done');
})();

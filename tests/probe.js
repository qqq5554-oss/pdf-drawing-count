const { chromium } = require("playwright");
const path = require("path");
const NM = path.join(__dirname, "node_modules");
const LIBS = { "pdf.min.js": "pdfjs-dist/build/pdf.min.js", "pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js", "pdf-lib.min.js": "pdf-lib/dist/pdf-lib.min.js" };
module.exports = async function (name, fn, arg) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("dialog", d => d.accept()); page.on("pageerror", e => console.log("ERR", e.message));
  await page.route(/cdnjs\.cloudflare\.com\/.*\/(pdf\.min\.js|pdf\.worker\.min\.js|pdf-lib\.min\.js)$/, (r, q) => r.fulfill({ path: path.join(NM, LIBS[q.url().split("/").pop()]), contentType: "application/javascript" }));
  await page.goto("file://" + path.join(__dirname, "..", "index.html"));
  await page.setInputFiles("#fileIn", path.join(__dirname, "real", name + ".pdf"));
  await page.waitForFunction(() => S.pdf && S.raster && S.vec.has(0), null, { timeout: 60000 });
  await page.setInputFiles("#projIn", path.join(__dirname, "real", name + ".json"));
  await page.waitForFunction(() => S.ducts.length > 0);
  const r = await page.evaluate(fn, arg);
  await browser.close(); return r;
};
if (require.main === module) {
  module.exports(process.argv[2], new Function("return (async()=>{" + process.argv[3] + "})()")).then(r => console.log(JSON.stringify(r, null, 1)));
}

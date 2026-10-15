// 除錯用：載入實際圖面與專案檔，截取指定位置。node tests/shot.js case1 x,y[,zoom] ...（座標為分析影像 px）
const { chromium } = require("playwright");
const path = require("path");
const NM = path.join(__dirname, "node_modules");
const LIBS = { "pdf.min.js": "pdfjs-dist/build/pdf.min.js", "pdf.worker.min.js": "pdfjs-dist/build/pdf.worker.min.js", "pdf-lib.min.js": "pdf-lib/dist/pdf-lib.min.js" };
(async () => {
  const [name, ...spots] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("dialog", d => d.accept()); page.on("pageerror", e => console.log("ERR", e.message));
  await page.route(/cdnjs\.cloudflare\.com\/.*\/(pdf\.min\.js|pdf\.worker\.min\.js|pdf-lib\.min\.js)$/, (r, q) => r.fulfill({ path: path.join(NM, LIBS[q.url().split("/").pop()]), contentType: "application/javascript" }));
  await page.goto("file://" + path.join(__dirname, "..", "index.html"));
  await page.setInputFiles("#fileIn", path.join(__dirname, "real", name + ".pdf"));
  await page.waitForFunction(() => S.pdf && S.raster && S.vec.has(0), null, { timeout: 60000 });
  await page.setInputFiles("#projIn", path.join(__dirname, "real", name + ".json"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => setTab("duct"));
  if (process.env.RAW) await page.evaluate(() => { S.ducts = []; refreshAll(); });
  for (const sp of spots) {
    const [x, y, z] = sp.split(",").map(Number);
    await page.evaluate(({ x, y, z }) => { S.vs = z || 1.5; S.ox = view.width / devicePixelRatio / 2 - x * S.vs; S.oy = view.height / devicePixelRatio / 2 - y * S.vs; draw(); }, { x, y, z });
    await page.waitForTimeout(2500);
    await page.locator("#view").screenshot({ path: path.join(__dirname, "real", `${name}_${x}_${y}.png`) });
  }
  console.log(await page.evaluate(() => JSON.stringify(ductList().map(({ d, n }) => [n, d.id, d.how, d.size, ductGeo(d).kind, ductGeo(d).ext.map(v => +v.toFixed(1))]))));
  await browser.close();
})();

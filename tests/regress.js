// 回歸測試：node tests/regress.js（先跑 node tests/make-pdfs.js 產生測試 PDF）
// CDN 函式庫改由 node_modules 提供，離線也能跑。
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const NM = path.join(__dirname, "node_modules");
const LIBS = {
  "pdf.min.js": path.join(NM, "pdfjs-dist/build/pdf.min.js"),
  "pdf.worker.min.js": path.join(NM, "pdfjs-dist/build/pdf.worker.min.js"),
  "pdf-lib.min.js": path.join(NM, "pdf-lib/dist/pdf-lib.min.js"),
};
const MM = 20;                       // 測試比例：1 pt = 20 mm
const H = 700;                       // 測試 PDF 頁高（pt）

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) { pass++; console.log("  ✅ " + name); }
  else { fail++; console.log("  ❌ " + name + (info !== undefined ? "  → " + JSON.stringify(info) : "")); }
}
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.dismiss());
  await page.route(/cdnjs\.cloudflare\.com\/.*\/(pdf\.min\.js|pdf\.worker\.min\.js|pdf-lib\.min\.js)$/, (r, req) => {
    const f = LIBS[req.url().split("/").pop()];
    r.fulfill({ path: f, contentType: "application/javascript" });
  });
  await page.goto("file://" + path.join(ROOT, "index.html"));

  // 開啟測試 PDF，設定比例，切到風管分頁
  async function open(name) {
    await page.evaluate(() => { S.pdf = null; S.raster = null; $("fileIn").value = ""; });
    await page.setInputFiles("#fileIn", path.join(__dirname, "fixtures", name + ".pdf"));
    await page.waitForFunction(() => S.pdf && S.raster && S.vec.has(0), null, { timeout: 30000 });
    await page.evaluate(mm => { S.scales[0] = { mmPerPt: mm, src: "test" }; S.ducts = []; setTab("duct"); $("ductW").value = ""; $("ductH").value = ""; }, MM);
  }
  // 自動標示：在 PDF 座標 (x,y) 點邊線 → 預覽 → 標示完成
  async function autoPick(x, y, size) {
    return page.evaluate(async ({ x, y, H, size }) => {
      $("ductW").value = ""; $("ductH").value = "";
      await pickClick({ x: x * SCALE, y: (H - y) * SCALE }, {});
      const pend = S.pending ? { wAuto: $("ductW").value, mid: S.pending.res.mid } : null;
      if (!pend) return null;
      if (size) { $("ductW").value = size[0]; $("ductH").value = size[1]; $("ductW").dataset.auto = "0"; }
      await commitDuct();
      return pend;
    }, { x, y, H, size });
  }
  // 手動標示：依序點選 PDF 座標
  async function manual(pts, size) {
    return page.evaluate(async ({ pts, H, size }) => {
      $("ductW").value = size ? size[0] : ""; $("ductH").value = size ? size[1] : "";
      for (const [x, y] of pts) ductClick({ x: x * SCALE, y: (H - y) * SCALE }, {});
      await commitDuct();
    }, { pts, H, size });
  }
  // 風管結果（長度 m、寬度 mm、中心線 PDF 座標）
  const ducts = () => page.evaluate(H => S.ducts.map(d => {
    const g = ductGeo(d), k = mmPerPt(d.page);
    return {
      size: d.size, wdmm: d.wd ? Math.round(d.wd * k) : null,
      L: ductLenM(d), Lc: ductLenC(d), ext: ductExtM(d), kind: g.kind,
      pts: d.pts.map(q => [+(q[0] / SCALE).toFixed(1), +(H - q[1] / SCALE).toFixed(1)]),
      wc: widthCheck(d),
    };
  }), H);

  console.log("● 直管（自動標示）");
  await open("straight");
  let r = await autoPick(300, 280, ["", "400"]), D = await ducts();
  check("取得兩側中心線", r && r.mid, r);
  check("寬度自動填入 800", r && r.wAuto === "800", r);
  check("尺寸 800x400", D[0] && D[0].size === "800x400", D[0]);
  check("中心線 y=300", D[0] && D[0].pts.every(p => near(p[1], 300, 0.6)), D[0] && D[0].pts);
  check("長度 8 m", D[0] && near(D[0].L, 8, 0.05), D[0] && D[0].L);
  check("無寬度提醒", D[0] && !D[0].wc, D[0] && D[0].wc);

  console.log("● 寬度提醒");
  await open("straight");
  await autoPick(300, 280, ["500", "300"]); D = await ducts();
  check("寬度不符時提醒", D[0] && D[0].wc && D[0].wc.dmm === 800, D[0] && D[0].wc);
  await open("straight");
  await autoPick(300, 280, ["300", "800"]); D = await ducts();
  check("寬高寫反提供對調 800x300", D[0] && D[0].wc && D[0].wc.swap === "800x300", D[0] && D[0].wc);

  for (const name of ["elbow", "elbow-joint"]) {
    console.log(`● 彎頭（${name === "elbow" ? "無" : "有"}接合線）`);
    await open(name);
    const a = await autoPick(300, 280, ["", "400"]);
    const b = await autoPick(500, 450, ["", "400"]);
    D = await ducts();
    check("兩段都取得中心線", a && a.mid && b && b.mid, [a, b]);
    check("寬度 800 / 600", a && a.wAuto === "800" && b && b.wAuto === "600", [a && a.wAuto, b && b.wAuto]);
    check("水平段判定彎頭", D[0] && D[0].kind.includes("彎頭"), D[0] && D[0].kind);
    check("水平段延伸到垂直管外緣（總長 8 m）", D[0] && near(D[0].L, 8, 0.1), D[0] && [D[0].Lc, D[0].ext]);
    check("垂直段延伸到水平管外緣（總長 6.4 m）", D[1] && near(D[1].L, 6.4, 0.1), D[1] && [D[1].Lc, D[1].ext]);
  }

  console.log("● 穿管（缺口 600 mm 自動接續）");
  await open("passthru");
  r = await autoPick(200, 280, ["", "400"]); D = await ducts();
  check("一次標示成單一風管", D.length === 1 && r && r.mid, D.length);
  check("長度涵蓋整支 8 m", D[0] && near(D[0].L, 8, 0.1), D[0] && D[0].L);
  check("寬度 800", r && r.wAuto === "800", r);

  console.log("● 三通");
  await open("tee");
  const m = await autoPick(150, 280, ["", "400"]);
  const br = await autoPick(310, 450, ["", "250"]);
  D = await ducts();
  check("主管寬度 800（多點量測避開開口）", m && m.wAuto === "800", m);
  check("分支寬度 400", br && br.wAuto === "400", br);
  const bd = D.find(d => d.size.startsWith("400"));
  check("分支判定三通", bd && bd.kind.includes("三通"), bd && bd.kind);
  check("分支延伸到主管最遠側邊緣（總長 5.4 m）", bd && near(bd.L, 5.4, 0.1), bd && [bd.Lc, bd.ext]);

  console.log("● 底圖干擾");
  await open("noise");
  r = await autoPick(300, 280, ["", "400"]); D = await ducts();
  check("忽略灰色格線，寬度 800", r && r.mid && r.wAuto === "800", r);
  check("長度 8 m", D[0] && near(D[0].L, 8, 0.1), D[0] && D[0].L);

  console.log("● 45° 彎頭");
  await open("deg45");
  const h1 = await autoPick(250, 285, ["", "300"]);
  const h2 = await autoPick(400 + 150 * Math.SQRT1_2 + 15 * Math.SQRT1_2, 300 + 150 * Math.SQRT1_2 - 15 * Math.SQRT1_2, ["", "300"]);
  D = await ducts();
  check("兩段寬度 600", h1 && h1.wAuto === "600" && h2 && h2.wAuto === "600", [h1, h2]);
  check("判定 45°彎頭", D.length === 2 && D.every(d => d.kind.some(k => k === "45°彎頭")), D.map(d => d.kind));

  console.log("● 手動標示（端點吸附）");
  await open("elbow");
  await manual([[100.5, 300], [485, 300.4], [485, 600]], ["800", "400"]); D = await ducts();
  check("建立一支 3 點風管", D.length === 1 && D[0].pts.length === 3, D[0] && D[0].pts);
  check("吸附到端點 (100,280)? 否則保持點選位置", D[0] && near(D[0].pts[0][0], 100.5, 0.6) || near(D[0].pts[0][0], 100, 0.01), D[0] && D[0].pts[0]);

  console.log("● 計算書數值（SA 1750×800 L=3.854）");
  r = await page.evaluate(() => {
    const k = 20, L = 3854 / k * SCALE;
    const d = { id: "t", seq: 1, page: 0, pts: [[0, 0], [L, 0]], sys: "SA", size: "1750x800" };
    S.ducts = [d]; const c = ductCalc(d);
    return { L: c.L, g: S.dc.gages[c.g][0], area: c.area, ft2: c.ft2, s37: c.s37 };
  });
  check("20#、22.6 m²、243.27 ft²、11.58 張", r.L === 3.854 && String(r.g).includes("20") && r.area === 22.6 && r.ft2 === 243.27 && r.s37 === 11.58, r);

  check("頁面沒有 JavaScript 錯誤", errors.length === 0, errors);
  await browser.close();
  console.log(`\n通過 ${pass}，失敗 ${fail}`);
  process.exit(fail ? 1 : 0);
})();

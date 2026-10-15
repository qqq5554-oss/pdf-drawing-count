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

  console.log("● 分節彎頭上色");
  await open("seg-elbow");
  const s1 = await autoPick(200, 280, ["", "400"]);
  const s2 = await autoPick(460, 500, ["", "400"]);
  D = await ducts();
  check("兩段寬度 800", s1 && s1.wAuto === "800" && s2 && s2.wAuto === "800", [s1, s2]);
  check("判定彎頭", D.length === 2 && D.every(d => d.kind.includes("彎頭")), D.map(d => d.kind));
  // 檢查點是否落在任一段的色塊內（PDF 座標）
  const filled = await page.evaluate(({ H, pts }) => {
    const ix = S.vec.get(0), F = S.ducts.map(d => fillOf(d, ix));
    const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    return { ok: F.every(f => f && f.polys.length), hit: pts.map(([x, y]) => F.some(f => f && f.polys.some(P => inPoly(x * SCALE, (H - y) * SCALE, P)))) };
  }, { H, pts: [[300, 300], [480, 500], [450, 300], [478, 300], [475, 330], [300, 270], [300, 330], [498, 283], [440, 330]] });
  check("兩段都產生色塊", filled.ok, filled);
  check("直管段內部有上色", filled.hit[0] && filled.hit[1], filled.hit);
  check("分節彎頭的中間節有上色", filled.hit[2] && filled.hit[3] && filled.hit[4], filled.hit.slice(2, 5));
  check("風管外側與斜切外角沒有上色", !filled.hit[5] && !filled.hit[6] && !filled.hit[7], filled.hit.slice(5, 8));
  check("內角外側沒有上色", !filled.hit[8], filled.hit[8]);

  console.log("● 清點：向量比對");
  await open("count");
  const tplRect = { x: 95, y: H - 573, w: 40, h: 28 };   // 框住第一個符號（PDF pt，左上原點）
  const cnt = async (styLock, rot) => page.evaluate(async ({ rect, styLock, rot }) => {
    S.cats = []; const c = addCategory("測試"); c.styLock = styLock; c.rot = rot;
    await setTemplate({ x: rect.x * SCALE, y: rect.y * SCALE, w: rect.w * SCALE, h: rect.h * SCALE });
    $("scope").value = "page";
    await runSearch();
    return { n: countAll(c), segs: c.vt && c.vt.segs.length, method: c.method };
  }, { rect: tplRect, styLock, rot });
  r = await cnt(true, true);
  check("樣板取得 6 條線段", r.segs === 6 && r.method === "vec", r);
  check("限相同線型＋旋轉：找到 9 個（含 3 個轉向）", r.n === 9, r);
  r = await cnt(true, false);
  check("不允許旋轉：找到 6 個", r.n === 6, r);
  r = await cnt(false, true);
  check("不限線型：灰色同形也找到，共 13 個", r.n === 13, r);

  console.log("● 清點：文字計數");
  r = await page.evaluate(async () => {
    S.cats = []; const c = addCategory("FCU"); c.method = "txt"; c.txt = { pat: "FCU-1", whole: true };
    $("scope").value = "page"; await runSearch(); const a = countAll(c);
    c.txt = { pat: "FCU-*", whole: true }; await runSearch(); return [a, countAll(c)];
  });
  check("「FCU-1」找到 4 個，「FCU-*」找到 5 個", r[0] === 4 && r[1] === 5, r);

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

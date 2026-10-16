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
      how: d.how, size: d.size, wdmm: d.wd ? Math.round(d.wd * k) : null,
      L: ductLenM(d), Lc: ductLenC(d), ext: ductExtM(d), kind: g.kind,
      pts: d.pts.map(q => [+(q[0] / SCALE).toFixed(1), +(H - q[1] / SCALE).toFixed(1)]),
      wc: widthCheck(d),
    };
  }), H);

  // 檢查點（PDF 座標）是否落在任一段風管的色塊內
  const fillHit = pts => page.evaluate(({ H, pts }) => {
    const ix = S.vec.get(0); FILLS.clear(); const F = S.ducts.map(d => fillOf(d, ix));
    const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    return pts.map(([x, y]) => F.some(f => f && f.polys.some(P => inPoly(x * SCALE, (H - y) * SCALE, P))));
  }, { H, pts });
  let fh;

  console.log("● 直管（自動標示）");
  await open("straight");
  let r = await autoPick(300, 280, ["", "400"]), D = await ducts();
  check("取得兩側中心線", r && r.mid, r);
  check("寬度自動填入 800", r && r.wAuto === "800", r);
  check("尺寸 800x400", D[0] && D[0].size === "800x400", D[0]);
  check("中心線 y=300", D[0] && D[0].pts.every(p => near(p[1], 300, 0.6)), D[0] && D[0].pts);
  check("長度 8 m", D[0] && near(D[0].L, 8, 0.05), D[0] && D[0].L);
  check("無寬度提醒", D[0] && !D[0].wc, D[0] && D[0].wc);
  check("記錄為自動標示", D[0] && D[0].how === "auto", D[0] && D[0].how);

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

  console.log("● 手動標示量寬（對稱於中心線，忽略內部細線）");
  await open("manual-width");
  await manual([[120, 300], [480, 300]]); D = await ducts();
  check("寬度量到 900（不是內部細線的 600）", D[0] && near(D[0].wdmm, 900, 5), D[0] && D[0].wdmm);
  r = await page.evaluate(() => S.ducts[0].edgeSty);
  check("邊線線型取風管邊線（0.7pt）", r && r.startsWith("S|0.7"), r);

  console.log("● 手動標示：Ctrl 點兩側邊線指定寬度");
  await open("manual-width");
  r = await page.evaluate(async H => {
    S.dpick = "pts";
    widthPick({ x: 300 * SCALE, y: (H - 288) * SCALE });          // 第一條：內部細線
    widthPick({ x: 300 * SCALE, y: (H - 318) * SCALE });          // 第二條：另一條內部細線（刻意指定 600）
    const w = $("ductW").value; $("ductH").value = "300";
    ductClick({ x: 120 * SCALE, y: (H - 303) * SCALE }, {}); ductClick({ x: 480 * SCALE, y: (H - 303) * SCALE }, {});
    await commitDuct(); const d = S.ducts[0];
    return { w, wd: Math.round(d.wd * mmPerPt(0)), sty: d.edgeSty, size: d.size, how: d.how };
  }, H);
  check("寬度依指定的兩條線為 600，尺寸 600x300", r.w === "600" && r.wd === 600 && r.size === "600x300", r);
  check("邊線線型取指定的線（0.4pt）、仍記為手動", r.sty && r.sty.startsWith("S|0.4") && r.how === "manual", r);

  console.log("● Ctrl 點兩條邊線：真實滑鼠操作（手動、自動、Mac 右鍵）");
  const scr = (x, y) => page.evaluate(([x, y, H]) => { const r = view.getBoundingClientRect(); return { x: r.left + S.ox + x * SCALE * S.vs, y: r.top + S.oy + (H - y) * SCALE * S.vs }; }, [x, y, H]);
  const ctrlTwo = async (button) => {
    await page.keyboard.down("Control");
    for (const y of [277.5, 322.5]) { const q = await scr(300, y); await page.mouse.click(q.x, q.y, { button }); await page.waitForTimeout(100); }
    await page.keyboard.up("Control");
  };
  for (const [mode, button, label] of [["pts", "left", "手動"], ["seg", "left", "自動"], ["pts", "right", "Mac（Ctrl＋點擊＝右鍵）"]]) {
    await open("manual-width");
    await page.evaluate(m => { S.dpick = m; setMode("duct"); }, mode);
    await ctrlTwo(button);
    r = await page.evaluate(H => ({ w: $("ductW").value, wref: S.wref && Math.round(S.wref.wd * 20), pend: S.pending && S.pending.pts.map(q => +(H - q[1] / SCALE).toFixed(1)), sel: S.wsel ? S.wsel.lines.length : 0 }), H);
    check(`${label}：兩條邊線都以橘色標示`, r.sel === 2, r);
    if (mode === "seg") check(`${label}：建立中心線預覽 y=300、寬度 900`, r.w === "900" && r.pend && r.pend.every(y => near(y, 300, 0.3)), r);
    else check(`${label}：指定寬度 900`, r.w === "900" && r.wref === 900, r);
  }

  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press("Escape");
  r = await page.evaluate(() => !!S.wsel);
  check("Esc 取消後橘色標示清除", r === false, r);

  console.log("● 手動標示：輸入的寬度與量測不符時，上色依輸入的寬度");
  await open("straight");
  await manual([[120, 300], [480, 300]], ["300", "200"]);
  fh = await fillHit([[300, 300], [300, 305], [300, 312], [300, 288]]); D = await ducts();
  check("量到 800、輸入 300 → 有寬度提醒", D[0] && D[0].wc && D[0].wc.dmm === 800, D[0] && D[0].wc);
  check("色塊依 300 寬：中心有上色、離中心 12pt（240 mm）外沒有", fh[0] && fh[1] && !fh[2] && !fh[3], fh);
  await open("straight");
  await manual([[120, 300], [480, 300]], ["800", "200"]);
  fh = await fillHit([[300, 300], [300, 312], [300, 288]]);
  check("輸入與量測相符（800）時照常依邊線上色", fh.every(Boolean), fh);

  console.log("● 拖曳已標示風管的端點調整長度（真實滑鼠操作）");
  await open("straight");
  await autoPick(300, 280, ["", "400"]);
  await page.evaluate(() => setMode("pan"));
  r = await page.evaluate(() => S.selDuct === S.ducts[0].id);
  check("標示完成後風管為選取狀態", r, r);
  {
    const end = await page.evaluate(([H]) => { const d = S.ducts[0], q = d.pts[d.pts.length - 1], r = view.getBoundingClientRect(); return { x: r.left + S.ox + q[0] * S.vs, y: r.top + S.oy + q[1] * S.vs, px: q[0] / SCALE }; }, [H]);
    const target = await scr(end.px < 300 ? 200 : 400, 300);   // 往內拉 100pt（2 m）
    await page.mouse.move(end.x, end.y); await page.mouse.down();
    await page.mouse.move((end.x + target.x) / 2, target.y, { steps: 4 }); await page.mouse.move(target.x, target.y, { steps: 4 }); await page.mouse.up();
  }
  D = await ducts();
  check("拖曳後長度由 8 m 變成 6 m", D[0] && near(D[0].L, 6, 0.1), D[0] && D[0].L);
  await page.evaluate(() => { const f = S.undo.pop(); f(); refreshAll(); });
  D = await ducts();
  check("Ctrl+Z 復原為 8 m", D[0] && near(D[0].L, 8, 0.1), D[0] && D[0].L);

  console.log("● 風管接到管道間：上色不超過標示終點");
  for (const how of ["auto", "manual"]) {
    await open("shaft");
    if (how === "auto") await autoPick(280, 250, ["", "400"]); else await manual([[300, 120], [300, 400]], ["800", "400"]);
    fh = await fillHit([[300, 300], [300, 390], [300, 420], [300, 460]]); D = await ducts();
    check(`${how === "auto" ? "自動" : "手動"}：管內有上色、管道間內（終點之後）沒有上色`, fh[0] && fh[1] && !fh[2] && !fh[3], { fh, pts: D[0] && D[0].pts });
  }

  console.log("● 輸入高度後按 Enter 完成標示（自動、手動）");
  await open("straight");
  await page.evaluate(async H => { S.dpick = "seg"; setMode("duct"); await pickClick({ x: 300 * SCALE, y: (H - 280) * SCALE }, {}); }, H);
  await page.fill("#ductH", "400"); await page.press("#ductH", "Enter"); await page.waitForTimeout(200);
  D = await ducts();
  check("自動：Enter 後建立 800x400", D.length === 1 && D[0].size === "800x400", D.map(d => d.size));
  await open("straight");
  await page.evaluate(H => { S.dpick = "pts"; setMode("duct"); ductClick({ x: 120 * SCALE, y: (H - 300) * SCALE }, {}); ductClick({ x: 480 * SCALE, y: (H - 300) * SCALE }, {}); }, H);
  await page.fill("#ductW", "800"); await page.fill("#ductH", "300"); await page.press("#ductH", "Enter"); await page.waitForTimeout(200);
  D = await ducts();
  check("手動：Enter 後建立 800x300", D.length === 1 && D[0].size === "800x300", D.map(d => d.size));

  console.log("● 穿管處有重複線段仍可接續");
  await open("passthru-dup");
  r = await autoPick(150, 280, ["", "400"]); D = await ducts();
  check("一次標示成單一風管、長度 8 m", D.length === 1 && near(D[0].L, 8, 0.1), D[0] && D[0].L);

  console.log("● 三通分支不跨越到同一直線上的另一支管");
  await open("tee-nobridge");
  await autoPick(150, 280, ["", "250"]);
  r = await autoPick(240, 200, ["", "250"]); D = await ducts();
  const nb = D.find(d => d.size.startsWith("400x250") && d.pts.every(p => near(p[0], 250, 0.6)));
  check("分支寬度 400", r && r.wAuto === "400", r);
  check("分支只到主管底邊（y 100~280），沒有接到上方立管", nb && Math.max(...nb.pts.map(p => p[1])) < 282, nb && nb.pts);
  check("分支判定三通、延伸到主管最遠側（總長 4.0 m）", nb && nb.kind.includes("三通") && near(nb.L, 4.0, 0.1), nb && [nb.kind, nb.L]);

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
  check("記錄為手動標示", D[0] && D[0].how === "manual", D[0] && D[0].how);
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

  console.log("● 圓弧彎頭（接合處缺口）上色：自動＋手動");
  // 檢查點：彎頭內部 2 點、外弧外側轉角 2 點、水平管下緣外 1 點、垂直管左緣外 1 點
  const EG = [[252, 292], [262, 285], [243, 283], [245, 284], [300, 270], [230, 320], [262, 302], [263, 303.5]];
  await open("elbow-gap");
  await autoPick(240, 450, ["", "300"]);
  await autoPick(450, 280, ["", "300"]);
  fh = await fillHit(EG); D = await ducts();
  check("自動：兩段都判定彎頭", D.length === 2 && D.every(d => d.kind.includes("彎頭")), D.map(d => d.kind));
  check("自動：彎頭內部有上色", fh[0] && fh[1], fh);
  check("自動：外弧外側、管外沒有上色", !fh[2] && !fh[3] && !fh[4] && !fh[5], fh);
  check("自動：內側喉部沒有上色", !fh[6] && !fh[7], fh.slice(6));
  await open("elbow-gap");
  await autoPick(240, 450, ["", "300"]);
  await manual([[560, 290], [285, 290]], ["400", "300"]);
  fh = await fillHit(EG); D = await ducts();
  check("手動（中心線沒畫到轉角）：寬度 400、判定彎頭", D[1] && near(D[1].wdmm, 400, 5) && D[1].kind.includes("彎頭"), D[1] && [D[1].wdmm, D[1].kind]);
  check("手動：彎頭內部有上色", fh[0] && fh[1], fh);
  check("手動：外弧外側、管外沒有上色", !fh[2] && !fh[3] && !fh[4] && !fh[5], fh);
  check("手動：內側喉部（內弧與轉角之間）沒有上色", !fh[6] && !fh[7], fh.slice(6));

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

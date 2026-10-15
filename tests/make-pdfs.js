// 產生回歸測試用 PDF（pdf-lib）。座標單位 pt，y 軸向上；比例設定為 1 pt = 20 mm。
const { PDFDocument, rgb } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

const W = 1000, H = 700;
const OUT = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });

const DUCT = { thickness: 0.7, color: rgb(0, 0, 0.8) };   // 風管邊線（藍、0.7pt）
const BASE = { thickness: 0.25, color: rgb(0.5, 0.5, 0.5) }; // 底圖（灰、0.25pt）

async function make(name, draw) {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([W, H]);
  const L = (x1, y1, x2, y2, o = DUCT) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, ...o });
  draw(L, pg);
  fs.writeFileSync(path.join(OUT, name + ".pdf"), await doc.save());
}

(async () => {
  // 直管：800 寬（40pt），中心線 y=300，x 100→500
  await make("straight", L => { L(100, 280, 500, 280); L(100, 320, 500, 320); });

  // 彎頭（無接合線）：水平 800 寬 + 往上 600 寬（30pt），外角在 (500,280)
  await make("elbow", L => {
    L(100, 280, 500, 280); L(100, 320, 470, 320);   // 水平兩側
    L(500, 280, 500, 600); L(470, 320, 470, 600);   // 垂直兩側（x 中心 485）
  });

  // 彎頭（有接合線）：同上，加上兩段接合處的短線
  await make("elbow-joint", L => {
    L(100, 280, 470, 280); L(100, 320, 470, 320); L(470, 280, 470, 320);
    L(470, 280, 500, 280); L(500, 280, 500, 600); L(470, 320, 470, 600);
  });

  // 穿管：水平 800 寬，x=280~310 斷開（30pt = 600 mm），中間有一支垂直小管穿過
  await make("passthru", L => {
    L(100, 280, 280, 280); L(310, 280, 500, 280);
    L(100, 320, 280, 320); L(310, 320, 500, 320);
    L(285, 200, 285, 400, { thickness: 0.5, color: rgb(0.8, 0, 0) });
    L(305, 200, 305, 400, { thickness: 0.5, color: rgb(0.8, 0, 0) });
  });

  // 三通：主管水平 800 寬，分支往上 400 寬（20pt），x 中心 300
  await make("tee", L => {
    L(100, 280, 500, 280);
    L(100, 320, 290, 320); L(310, 320, 500, 320);
    L(290, 320, 290, 550); L(310, 320, 310, 550);
  });

  // 底圖干擾：直管 + 大量灰色細線（建築格線）
  await make("noise", L => {
    for (let x = 50; x < 950; x += 25) L(x, 50, x, 650, BASE);
    for (let y = 50; y < 650; y += 25) L(50, y, 950, y, BASE);
    L(100, 280, 500, 280); L(100, 320, 500, 320);
  });

  // 45°：水平 600 寬（30pt）接 45° 斜管 600 寬
  await make("deg45", L => {
    const h = 15, s = Math.SQRT1_2;
    // 水平段中心 y=300，x 100→400；斜管中心從 (400,300) 往右上 45°，長 250
    const ex = 400 + 250 * s, ey = 300 + 250 * s;
    L(100, 300 - h, 400 + h * Math.tan(Math.PI / 8), 300 - h);
    L(100, 300 + h, 400 - h * Math.tan(Math.PI / 8), 300 + h);
    L(400 + h * Math.tan(Math.PI / 8), 300 - h, ex + h * s, ey - h * s);
    L(400 - h * Math.tan(Math.PI / 8), 300 + h, ex - h * s, ey + h * s);
  });
  // 分節彎頭：水平 800 寬接垂直 800 寬，外角斜切，中間兩節以接合線分隔
  await make("seg-elbow", L => {
    L(100, 280, 480, 280); L(480, 280, 500, 300); L(500, 300, 500, 600);   // 外側邊線（含斜切）
    L(100, 320, 460, 320); L(460, 320, 460, 600);                         // 內側邊線
    L(440, 280, 440, 320);                                                // 彎頭起點接合線
    L(460, 320, 490, 290);                                                // 中間節接合線
    L(460, 340, 500, 340);                                                // 彎頭終點接合線
  });

  // 清點：不對稱符號（矩形＋對角線＋短線）。藍色 6 個正向＋3 個轉 90°；灰色同形 4 個（不同線型）；三角形 5 個
  await make("count", (L, pg) => {
    const SYM = { thickness: 0.6, color: rgb(0.8, 0.1, 0.1) };
    const GRAY = { thickness: 0.25, color: rgb(0.5, 0.5, 0.5) };
    const sym = (x, y, rot, o) => {
      const P = (dx, dy) => rot ? [x - dy, y + dx] : [x + dx, y + dy];
      const seg = (a, b) => { const p = P(...a), q = P(...b); L(p[0], p[1], q[0], q[1], o); };
      seg([0, 0], [24, 0]); seg([24, 0], [24, 12]); seg([24, 12], [0, 12]); seg([0, 12], [0, 0]);
      seg([0, 0], [24, 12]); seg([24, 12], [30, 18]);
    };
    [[100, 550], [250, 550], [400, 550], [550, 550], [100, 420], [250, 420]].forEach(([x, y]) => sym(x, y, false, SYM));
    [[450, 400], [600, 400], [750, 400]].forEach(([x, y]) => sym(x, y, true, SYM));
    [[100, 250], [250, 250], [400, 250], [550, 250]].forEach(([x, y]) => sym(x, y, false, GRAY));
    for (let i = 0; i < 5; i++) { const x = 100 + i * 120, y = 120; L(x, y, x + 20, y, SYM); L(x + 20, y, x + 10, y + 18, SYM); L(x + 10, y + 18, x, y, SYM); }
    for (let i = 0; i < 4; i++) pg.drawText("FCU-1", { x: 700 + (i % 2) * 120, y: 250 - Math.floor(i / 2) * 60, size: 10 });
    pg.drawText("FCU-2", { x: 700, y: 120, size: 10 });
  });
  console.log("fixtures ok");
})();

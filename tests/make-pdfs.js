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
  console.log("fixtures ok");
})();

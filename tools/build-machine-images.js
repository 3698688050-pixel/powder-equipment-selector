/* 把 18 张设备图（base64 JPEG）按「设备族名 → 图片」注入 index.html。
 *
 * 为什么按设备族名而不是型号：库里有 48 个族、202 个型号，官网只给了族的样本图。
 * 按族配图是能拿到的最高精度，再往下就是编。
 *
 * 没有图的族（惯性分级机 GX、三辊磨改性机、高速搅拌改性机、辅助设备 12 个）
 * 一律不配：配错一张图比没有图更糟。
 *
 * 用法：
 *   node tools/build-machine-images.js          # 写入 index.html
 *   node tools/build-machine-images.js --check  # 只校验是否同步（提交前自查）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const IMGS = path.join(ROOT, 'data', 'machine-images.json');

const START = '/* ==MACHINE_IMG_START== */';
const END = '/* ==MACHINE_IMG_END== */';

/* 顺序敏感：先匹配更具体的规则。
 * 例如「蒸汽动能磨(S-MQW/L系列)」必须先于 /MQW/，
 *      「FS05惯性分级机」必须先于 /惯性分级机/，
 *      「MZ03振动磨」必须先于 /MZ系列/。 */
const RULES = [
  [/蒸汽动能磨/, 'steam-jet-mill'],
  [/FS05/, 'lab-fs05'],
  [/TSM/, 'sodium-bicarbonate'],
  [/MQP01/, 'lab-mqp01'],
  [/MQPW/, 'airjet-disc'],
  [/MQP/, 'airjet-disc'],
  [/MQL|MQW/, 'airjet-fluidized-bed'],
  [/FL\/ITC|FW\/HTS/, 'air-classifier'],
  [/CSM/, 'air-classifier-mill'],
  [/MZ03/, 'lab-mz03'],
  [/MZ系列/, 'vibration-mill'],
  [/CUM180/, 'lab-cum180'],
  [/CUM-P/, 'pin-mill'],
  [/CUM-F/, 'hammer-mill'],
  [/针盘磨/, 'pin-mill'],
  [/蜂巢磨|ULM-G/, 'rotor-mill-dry-coat'],
  [/\bULM\b|ULM系列/, 'rotor-mill'],
  [/涡流磨|RTM/, 'vortex-mill'],
  [/球磨/, 'ball-mill-line'],
  [/三合一/, 'lab-3in1'],
  // 以下刻意不配图
  [/惯性分级机/, null],
  [/三辊磨/, null],
  [/高速搅拌/, null]
];

function deviceNames(html) {
  const m = /const DATA\s*=\s*(\[[\s\S]*?\n\];)/.exec(html);
  if (!m) throw new Error('index.html 里找不到 const DATA');
  const data = eval(m[1]);
  return data.map(d => d.n);
}

function buildMap(names, imgs) {
  const map = {};
  const missing = [];
  for (const n of names) {
    let slug = null;
    for (const [re, s] of RULES) {
      if (re.test(n)) { slug = s; break; }
    }
    if (slug && imgs[slug]) map[n] = slug;
    else if (slug) missing.push(n + ' → ' + slug + '（图片缺失）');
  }
  return { map, missing };
}

function block(map, imgs) {
  // 图按 slug 只存一份：48 个族里有多族共用同一张系列图（FL 单/多转子、CSM 四个变体…），
  // 按族各存一份会把这 320KB 的图重复到 580KB。
  const slugs = [];
  const nameToSlug = {};
  for (const n of Object.keys(map)) {
    nameToSlug[n] = map[n];
    if (!slugs.includes(map[n])) slugs.push(map[n]);
  }
  const srcBody = slugs
    .map(s => '  ' + JSON.stringify(s) + ': ' + JSON.stringify(imgs[s]))
    .join(',\n');
  const nameBody = Object.keys(nameToSlug)
    .map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(nameToSlug[k]))
    .join(',\n');
  return [
    START,
    '// 由 tools/build-machine-images.js 生成，请勿手改。',
    '// 设备族名 → 系列图 slug；系列图本体按 slug 只存一份（已压到 320px 高、白底）。',
    'const MACHINE_IMG = {',
    nameBody,
    '};',
    'const MACHINE_IMG_SRC = {',
    srcBody,
    '};',
    'function machineImage(devName) {',
    '  const slug = MACHINE_IMG[devName];',
    '  return slug ? MACHINE_IMG_SRC[slug] : null;',
    '}',
    END
  ].join('\n');
}

function main() {
  const checkOnly = process.argv.includes('--check');
  if (!fs.existsSync(IMGS)) throw new Error('缺 data/machine-images.json');
  const imgs = JSON.parse(fs.readFileSync(IMGS, 'utf8'));
  const html = fs.readFileSync(HTML, 'utf8');

  const { map, missing } = buildMap(deviceNames(html), imgs);
  const next = block(map, imgs);

  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i < 0 || j < 0) throw new Error('index.html 里找不到 MACHINE_IMG 标记区间');
  const current = html.slice(i, j + END.length);

  const n = Object.keys(map).length;
  if (checkOnly) {
    if (current.trim() !== next.trim()) {
      console.error('✗ MACHINE_IMG 块与 data/machine-images.json 不同步，请重跑 node tools/build-machine-images.js');
      process.exit(1);
    }
    console.log(`✓ MACHINE_IMG 同步：${n} 个设备族有图`);
    if (missing.length) console.log('  ' + missing.join('\n  '));
    return;
  }

  fs.writeFileSync(HTML, html.slice(0, i) + next + html.slice(j + END.length));
  console.log(`✓ 已写入 ${n} 个设备族的图，块大小 ${Math.round(next.length / 1024)}KB`);
  if (missing.length) console.log('  注意：' + missing.join('; '));
}

main();

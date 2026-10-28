/**
 * kb.js — 案例知识库 + 选型打分核（v7）
 * 数据源：index.html 的 DATA / DATA_MATERIALS（设备库、物料库，只读不改）
 *         data/cases-*.tsv（官网案例，CN 99 训练 / EN 64 跨站留出）
 * 原则：任何打分项都是「对全体案例成立」的函数；不含按案例标题查表的记忆项。
 */
// 同一份源码要同时跑在 node（离线评估）和浏览器（index.html 线上打分）里，
// 所以数据获取走两条路：node 从 index.html 文本里截取，浏览器直接用页面已有的全局常量。
// 浏览器侧由 tools/build-engine-embed.js 打包注入，`_DOM` 就是它塞进来的那个 shim；
// 这样线上排序和离线评估用的是同一份 score()，不会出现两套实现各自漂移。
const _SHIM = typeof _DOM !== 'undefined' ? _DOM : null;
let fs = null, path = null, ROOT = null, H = '';
if (!_SHIM) {
  fs = require('fs');
  path = require('path');
  ROOT = path.join(__dirname, '..');
  H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
}
// ---------- 从 index.html 提取数据 ----------
function cut(name, endName) {
  if (_SHIM) { const v = _SHIM[name]; if (v === undefined) throw new Error('浏览器 shim 缺 ' + name); return v; }
  const i = H.indexOf('const ' + name + ' =');
  const j = endName ? H.indexOf('const ' + endName + ' =') : H.length;
  if (i < 0 || j < 0) throw new Error('index.html 中找不到 ' + name);
  return new Function(H.slice(i, j).replace('const ' + name, 'var ' + name) + '; return ' + name + ';')();
}
const DATA = cut('DATA', 'DATA_MATERIALS');
const MATS = cut('DATA_MATERIALS', 'CAT_DISPLAY');
const CAT_ALIAS = cut('CAT_ALIAS', 'CAT_TO_VALUE');
const SWITCH_TAG = cut('SWITCH_TAG', 'TAG_LABEL');
const TAG_SWITCH = cut('TAG_SWITCH', 'matListEl');

// ---------- 解析器（与 index.html 同源语义，供回放使用） ----------
const _cache = new Map();
function memo(key, fn, s) { const k = key + '\u0000' + (s || ''); if (_cache.has(k)) return _cache.get(k); const v = fn(s); _cache.set(k, v); return v; }
function parseDevSizeRanges(s) { return memo('sz', _parseSize, s); }
function _parseSize(s) {
  if (!s) return { type: 'generic', ranges: [] };
  const out = []; const push = (a, b) => { if (a != null && b != null && a <= b) out.push({ min: a, max: b }); };
  let re = /D97[:：]?\s*(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/gi, m;
  while ((m = re.exec(s))) push(+m[1], +m[2]);
  if (out.length) return { type: 'D97', ranges: out };
  re = /D50[:：]?\s*(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/gi;
  while ((m = re.exec(s))) push(+m[1], +m[2]);
  if (out.length) return { type: 'D50', ranges: out };
  re = /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(?:μm|um|µm|微米)/gi;
  while ((m = re.exec(s))) push(+m[1], +m[2]);
  return { type: 'generic', ranges: out };
}
function parseDevCaps(s) { return memo('cap', _parseCaps, s); }
function _parseCaps(s) {
  if (!s) return { ranges: [], values: [], band: false };
  const band = /系列|覆盖|范围|区间|手册原文/.test(String(s));
  const ranges = [], values = [];
  let m, re = /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(kg\/h|t\/h|g\/h|kgH2O\/h)?/gi;
  const consumed = [];
  while ((m = re.exec(s))) {
    let u = (m[3] || 'kg/h').toLowerCase(); let x = +m[1], y = +m[2];
    if (u === 't/h') { x *= 1000; y *= 1000; } if (u === 'g/h') { x /= 1000; y /= 1000; }
    if (x <= y) ranges.push({ min: x, max: y });
    consumed.push([m.index, m.index + m[0].length]);
  }
  const arr = Array.from(s); for (const [a, b] of consumed) for (let k = a; k < b; k++) arr[k] = ' ';
  re = /(\d+(?:\.\d+)?)\s*(kg\/h|t\/h|g\/h)/gi;
  while ((m = re.exec(arr.join('')))) { const v = +m[1], u = m[2].toLowerCase(); let x = v; if (u === 't/h') x *= 1000; if (u === 'g/h') x /= 1000; values.push(x); }
  return { ranges, values, band };
}
/**
 * 型号级解析：把 "FL200:100-300kg/h;FL300:200-1000" 拆成
 * [{name:'FL200',min:100,max:300}, ...]，供逐型号打分（而不是把全系最大产能当成单机上限）。
 */
function parseModels(spec, kind) { return memo('md' + kind, _parseModels, spec + '|' + kind); }
function _parseModels(_s) {
  const [spec, kind] = _s.split(/\|(cap|size)$/);
  if (!spec) return [];
  const out = [];
  // "手册原文"/"系列"/"未列"/"可调" 这类不是型号名：整段是「系列覆盖 X~Y」的产能/粒度带，
  // 当成单一型号会把它按「利用率」去打（蒸汽动能磨 5000kg/h 落 2000~20000 带的 25% 处，
  // 被扣到 B=0.75），所以这里直接放弃型号级解析，交给区间/族级口径。
  if (/手册原文|^系列|系列通用|未列|可调|按产品调节|按型号/.test(String(spec).trim())) return [];
  const chunks = String(spec).split(/[;；]/);
  let carryUnit = 'kg/h';
  for (const raw of chunks) {
    const chunk = raw.trim(); if (!chunk) continue;
    const mn = chunk.match(/^([A-Za-z][A-Za-z0-9\/\-. ]*?)\s*[:：]/);
    const namesFromParen = [...chunk.matchAll(/\(([^)]*)\)/g)].map(m => m[1]).join('/');
    const name = mn ? mn[1].trim() : '';
    const pick = (re) => { const ms = [...chunk.matchAll(re)]; return ms; };
    if (kind === 'cap') {
      // 产能字段里混着粒度（"分级产能D97:15μm:2.7/4.0/5.4"）或斜杠并列值时，不做型号级解析，
      // 交给族级兜底（案例统计），否则会把 μm 当 mm 算出 97000kg/h 这种垃圾值。
      if (/μm|µm|um\b|目|mesh/i.test(chunk)) continue;
      if (/\d(?:[.,]\d+)?\/\d/.test(chunk)) continue;
      const u = (chunk.match(/(kg\/h|t\/h|g\/h)/i) || [])[1];
      if (u) carryUnit = u.toLowerCase();
      const unit = carryUnit;
      const conv = v => unit === 't/h' ? v * 1000 : unit === 'g/h' ? v / 1000 : v;
      const rs = pick(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/g);
      const singles = pick(/(?<![\d.\-~])(\d+(?:\.\d+)?)(?![\d.]|\s*[~\-])/g);
      const models = name ? [name] : (namesFromParen ? namesFromParen.split('/') : []);
      if (rs.length) for (const m of rs) out.push({ name: name || models[0] || '', min: conv(+m[1]), max: conv(+m[2]) });
      else if (singles.length) for (const m of singles) out.push({ name: name || '', min: conv(+m[1]), max: conv(+m[1]) });
    } else {
      const unit = (chunk.match(/(μm|um|µm|mm|目|mesh)/i) || [])[1] || 'μm';
      const conv = v => /mm/i.test(unit) ? v * 1000 : /目|mesh/i.test(unit) ? 15400 / v : v;
      const rs = pick(/D\d+[:：]?\s*(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/g);
      if (rs.length) for (const m of rs) out.push({ name: name || namesFromParen || '', min: conv(+m[1]), max: conv(+m[2]) });
      else {
        const g = pick(name ? /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/g : /D\d+[:：]?\s*(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/g);
        for (const m of g) out.push({ name: name || namesFromParen || '', min: conv(+m[1]), max: conv(+m[2]) });
      }
    }
  }
  return out.filter(m => m.min > 0 && m.max > 0 && m.min <= m.max && m.max <= 700000);
}

function devHardnessMax(feat) {
  if (!feat) return null; let m = feat.match(/莫氏硬度\s*(\d+(?:\.\d+)?)\s*以下/);
  if (!m) m = feat.match(/硬度\s*(\d+(?:\.\d+)?)\s*级?以下/);
  if (!m) m = feat.match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*以下/);
  return m ? +m[1] : null;
}
const TAGRE = {
  hard5: d => { const mx = devHardnessMax(d.feat); if (mx != null) return mx >= 5; return /各种软硬物料|软硬物料/.test(d.feat || '') ? true : null; },
  corr: d => /腐蚀|耐磨|高硬度|高纯/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  moist5: d => /含水|水分/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  fiber: d => /纤维|韧性|海绵/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  sticky: d => /黏性|粘性/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  static: d => /静电/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  agglo: d => /团聚|打散|解聚/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  heat: d => /热敏|低温|冷却|温度/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  oxid: d => /氧化|惰性|氮气|防氧化/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  volatile: d => /挥发|密闭|密封/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  nometal: d => /陶瓷|无金属|零金属|无铁|氧化铝|氧化锆|石英衬板|SILEX/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  gmp: d => /GMP|FDA|医药|食品/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null,
  ex: d => /防爆|爆炸|易燃|可燃|粉尘爆炸/.test((d.feat || '') + (d.mat || '') + (d.oth || '')) ? true : null
};
const matchTag = (dev, tag) => (TAGRE[tag] ? TAGRE[tag](dev) : null);

// ---------- 设备 → 族（两级：super / fam） ----------
function devFamily(d) {
  const n = d.n, c = d.c;
  if (c === '辅助设备') return { super: '辅助', fam: '辅助设备' };
  if (c === '改性机') return { super: '改性', fam: /涡流/.test(n) ? '涡流磨改性' : /蜂巢/.test(n) ? '蜂巢磨改性' : /三辊/.test(n) ? '三辊磨' : /针盘/.test(n) ? '针盘磨改性' : '高速搅拌改性' };
  if (c === '实验室设备') return { super: '实验室', fam: /MQP01/.test(n) ? '实验室气流磨' : /MZ/.test(n) ? '实验室振动磨' : '三合一实验机' };
  if (c === '球磨分级生产线') return { super: '球磨线', fam: /石英/.test(n) ? '球磨线(石英)' : '球磨线(碳酸钙)' };
  if (c === '分级机') return { super: '分级', fam: /GX|惯性/.test(n) ? '惯性分级机' : /FS05/.test(n) ? '实验室分级机' : '气流分级机' };
  if (/蒸汽/.test(n)) return { super: '蒸汽', fam: '蒸汽动能磨' };
  if (/MQP01/.test(n)) return { super: '实验室', fam: '实验室气流磨' };
  if (/MZL|MZW|MQL/.test(n)) return { super: '气流磨', fam: '流化床气流磨' };
  if (/MQW/.test(n)) return { super: '气流磨', fam: '流化床气流磨' };
  if (/MQPW/.test(n)) return { super: '气流磨', fam: '圆盘带分级气流磨' };
  if (/MQP/.test(n)) return { super: '气流磨', fam: '圆盘式气流磨' };
  if (/MZ/.test(n)) return { super: '机械磨', fam: '振动磨' };
  if (/CUM-P/.test(n)) return { super: '机械磨', fam: '针盘磨' };
  if (/CUM-F|CUM\d*F/.test(n)) return { super: '机械磨', fam: '锤式磨' };
  if (/CUM180/.test(n)) return { super: '机械磨', fam: '万能磨' };
  if (/ULM-G/.test(n)) return { super: '机械磨', fam: '蜂巢磨' };
  if (/ULM/.test(n)) return { super: '机械磨', fam: '转子磨' };
  if (/RTM/.test(n)) return { super: '机械磨', fam: '涡流磨' };
  if (/TSM/.test(n)) return { super: '机械磨', fam: '碳酸氢钠专用' };
  if (/CSM/.test(n)) return { super: '机械磨', fam: '空气分级磨' };
  if (c === '机械粉碎') return { super: '机械磨', fam: '机械粉碎其他' };
  if (c === '气流粉碎') return { super: '气流磨', fam: '气流磨其他' };
  return { super: '其他', fam: '其他' };
}

// ---------- 案例族标签 → super 集合 ----------
const FAMSUPER = [
  [/三合一|实验室|实验机|MQW20|三合一/, '实验室'],
  [/蒸汽/, '蒸汽'],
  [/球磨/, '球磨线'],
  [/改性|三辊磨|高速搅拌/, '改性'],
  [/流化床|圆盘式|气流粉碎机|气流磨/, '气流磨'],
  [/气流分级|分级机|分级生产线|分级线/, '分级'],
  [/针盘磨|锤式磨|转子磨|涡流磨|振动磨|空气分级磨|机械粉碎|万能磨|打散|蜂巢/, '机械磨'],
];
function famToSupers(fam, title) {
  const out = new Set();
  const text = (fam || '') + ' ' + (title || '');
  for (const [re, s] of FAMSUPER) if (re.test(fam || '')) out.add(s);
  // 标题里的并列族（ALPA 自己写的"机械、气流粉碎生产线"这类）
  if (/机械[、,和]?\s*气流/.test(title || '')) { out.add('机械磨'); out.add('气流磨'); }
  if (/球磨分级.*改性|改性.*球磨/.test(title || '')) { out.add('球磨线'); out.add('改性'); }
  if (/干燥打散/.test(title || '')) { out.add('机械磨'); }
  if (!out.size) {
    for (const [re, s] of FAMSUPER) if (re.test(text)) { out.add(s); break; }
  }
  // 列表页没有族标签的 6 例（医药/食品/环保）只能从标题推：算「弱标注」，
  // 单独计数、不参与「严格标注」口径的指标，避免悄悄丢掉困难样本。
  if (!out.size) {
    const t = title || '';
    if (/超微粉碎|超细粉碎|气流粉碎/.test(t)) { out.add('气流磨'); out.add('机械磨'); }
    else if (/粉碎/.test(t)) { out.add('机械磨'); out.add('气流磨'); }
    else if (/分级/.test(t)) out.add('分级');
    else if (/改性/.test(t)) out.add('改性');
    else if (/脱硫|脱硝|烟气/.test(t)) { out.add('机械磨'); out.add('气流磨'); }
    // 原料药/解热镇痛类成品药：ALPA 案例一律走气流磨（无介质、GMP、低温），标题里没有"粉碎"字样
    else if (/扑热息痛|布洛芬|青霉素|氯沙坦|原料药|维生素|阿莫西林/.test(t)) out.add('气流磨');
  }
  return out;
}
const EN_FAM = {
  'air-classifying-mill': '机械磨', 'fluidized-bed-jet-mill': '气流磨', 'spiral-jet-mill': '气流磨',
  'vibration-mill': '机械磨', 'pin-mill': '机械磨', 'hammer-mill': '机械磨', 'rtm-turbo-mill': '机械磨',
  'ulm-c-turbo-mill': '机械磨', 'three-roller-mill': '改性', 'steam-jet-mill': '蒸汽',
  'drying-and-dispersing': '机械磨', 'classifying-and-ball-mill-production-line': '球磨线',
  'air-classifier': '分级', 'laboratory-equipment': '实验室', 'classifying-and-separating': '分级',
  'coating-and-material-bonding': '改性', 'laboratory': '实验室',
  'sodium-bicarbonate-air-classifier-mill': '机械磨'
};

// ---------- 案例加载 ----------
function numOf(txt) { const m = String(txt || '').match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/); if (m) return (+m[1] + +m[2]) / 2; const s = String(txt || '').match(/(\d+(?:\.\d+)?)/); return s ? +s[1] : null; }
function capToKgH(txt) {
  const t = String(txt || '').toLowerCase().replace(/\s/g, ''); if (!t) return null;
  const v = numOf(t); if (!v) return null;
  const mul = /万t|万吨/.test(t) ? 10000 : 1;
  if (/年产|\/y|每年/.test(t)) {                       // 吨/年 → kg/h（8000h/年）
    if (/kg/.test(t)) return v / 8000;
    return v * mul * 1000 / 8000;
  }
  if (/kg\/h|kgh|公斤/.test(t)) return v;               // 先判 kg/h，否则会被 g/h 误伤
  if (/t\/h|吨\/h|时产.*t|小时.*t|\dt$/.test(t)) return v * mul * 1000;
  if (/g\/h/.test(t)) return v / 1000;
  return v;
}
function sizeToUm(txt) {
  const t = String(txt || '').toLowerCase().replace(/\s/g, ''); if (!t) return null;
  const v = numOf(t); if (!v) return null;
  if (/mm/.test(t)) return v * 1000;
  if (/目|mesh/.test(t)) return 15400 / v;
  return v;
}

/**
 * 把页面内联的 DATA_CASES 行还原成与 loadCases() 同样的案例对象。
 * 行格式：[站点,标题,行业,物料,产能kg/h,入料μm,成品μm,粒度基准,设备族,原始族标签,时间YYYY-MM]
 * 站点 'C'/'E'；设备族是 ALPA 自己的族标签（+ 连接），已经等于 SUPERS 口径。
 */
function casesFromRows(rows) {
  const out = [];
  (rows || []).forEach((r, i) => {
    const supers = new Set(String(r[8] || '').split('+').map(s => s.trim()).filter(Boolean));
    out.push({
      site: r[0] === 'C' ? 'CN' : 'EN', id: 'row' + i, title: r[1],
      ind: String(r[2] || '').replace(/应用案例$/, '').trim(), famLabel: r[9] || '',
      material: r[3], capTxt: '', cap: +r[4] || 0, feed: +r[5] || 0,
      prodTxt: '', prod: +r[6] || 0, basis: r[7] || 'D97', supers,
      date: r[10] || '', labelSource: r[9] ? 'list-tag + title' : 'title-inferred'
    });
  });
  return out.filter(c => c.prod > 0 && c.cap > 0 && c.supers.size);
}

function loadCases() {
  if (_SHIM) return casesFromRows(_SHIM.DATA_CASES);
  const cn = fs.readFileSync(path.join(ROOT, 'data/cases-cn-99.tsv'), 'utf8').trim().split('\n').slice(1).map(l => l.split('\t'));
  const en = fs.readFileSync(path.join(ROOT, 'data/cases-en-64.tsv'), 'utf8').trim().split('\n').slice(1).map(l => l.split('\t'));
  const out = [];
  for (const r of cn) {
    const [, title, ind, fam, material, capTxt, , , feedUm, prodTxt, prodUm, , date] = r;
    const supers = famToSupers(fam, title);
    out.push({
      // 中文站的行业列带着「应用案例」后缀（"电池材料应用案例"），不剥掉就落不进 IND2CLASS，
      // 物料大类这一级先验（k / kr / full 分格）会全部退化成 other。
      site: 'CN', id: r[0], title, ind: ind.replace(/\s*\/\s*$/, '').replace(/应用案例$/, '').trim(), famLabel: fam,
      material, capTxt, cap: +capToKgH(capTxt) || 0, feed: +feedUm || 0,
      prodTxt, prod: +prodUm || 0, basis: 'D' + (String(prodTxt).match(/D(\d+)/) || [, '97'])[1],
      supers, date: String(date || '').trim(),
      labelSource: fam && fam !== '未标注' ? 'list-tag + title' : 'title-inferred'
    });
  }
  for (const r of en) {
    const [slug, tax, title, material, capTxt, feedTxt, prodTxt, , date] = r;
    const supers = new Set();
    for (const t of tax.split('|')) if (EN_FAM[t]) { for (const s of String(EN_FAM[t]).split('+')) supers.add(s); }
    if (supers.has('改性') && !supers.has('机械磨') && /grinding|mill/.test(tax)) { /* 保持只标改性 */ }
    out.push({
      site: 'EN', id: slug, title, ind: (tax.split('|').find(t => !EN_FAM[t]) || 'other'), famLabel: tax,
      material, capTxt, cap: +capToKgH(capTxt) || 0, feed: +sizeToUm(feedTxt) || 0,
      prodTxt, prod: +sizeToUm(prodTxt) || 0, basis: 'D' + (String(prodTxt).match(/D(\d+)/) || [, '97'])[1],
      supers, date: String(date || '').trim(), labelSource: 'taxonomy-tag'
    });
  }
  return out.filter(c => c.prod > 0 && c.cap > 0 && c.supers.size);
}

// ---------- 物料 → 类别（弱先验，不用 35 分硬门槛） ----------
const IND2CLASS = {
  '非金属矿': 'mineral', '电池材料': 'battery', '精细化工': 'chem', '食品/保健品/化妆品': 'food',
  '建材及固废': 'waste', '高新材料': 'other', '医药': 'pharma', '粉末冶金': 'metal',
  '其他材料': 'other', '颜料/染料': 'chem', '环保脱硫': 'waste',
  'chemical': 'chem', 'minerals': 'mineral', 'battery-materials': 'battery', 'food-health-products': 'food',
  'medicine': 'pharma', 'architecture': 'waste', 'laboratory-equipment': 'other', 'laboratory': 'other',
  'pigments-dyes-printing': 'chem', 'electronic': 'other', 'flue-gas-desulphurization': 'waste',
  'feed': 'food', 'cosmetics': 'food', 'pesticides': 'chem', 'fertilizer': 'chem', 'other': 'other',
  'dry-grinding': 'other', 'classifying-and-separating': 'other'
};
const ALIAS = {
  '豌豆分离蛋白': '植物蛋白', '炒麦': '麦', '单晶三元材料': '三元材料', '硅土': '石英', '白砂糖': '糖',
  '扑热息痛': '原料药', '银浆': '金属粉末', '布洛芬': '原料药', '烟梗': '植物', '蛋氨酸': '蛋氨酸',
  '皂粉': '皂', '油漆渣': '固废', '青霉素': '原料药', '氯沙坦钾': '原料药', '米粉': '米粉',
  '电子级超纯石英': '石英', '抹茶': '茶', '海参饲料': '饲料', '化工颜料': '颜料', 'PE蜡': '聚乙烯蜡',
  '聚乙烯醇': 'PVA', '重质碳酸钙': '碳酸钙', '轻质碳酸钙': '碳酸钙', '粉煤灰': '飞灰',
  '煤矸石': '煤矸石', '锆英砂': '锆英砂', '偏硅酸锆': '锆英砂', '磷酸铁锂': '磷酸铁锂',
  'Resin': '树脂', 'Sodium bicarbonate': '小苏打', 'Baking soda': '小苏打', 'Calcium carbonate': '碳酸钙',
  'Quartz': '石英', 'Silica': '石英', 'Zeolite': '沸石', 'Talc': '滑石', 'Kaolin': '高岭土',
  'Alumina': '氧化铝', 'Zinc oxide': '氧化锌', 'Titanium dioxide': '钛白', 'Graphite': '石墨',
  'Activated carbon': '活性炭', 'Lithium iron phosphate': '磷酸铁锂', 'LFP': '磷酸铁锂',
  'NCM': '三元材料', 'Ternary': '三元材料', 'Cobalt oxide': '钴酸锂', 'Lithium cobaltate': '钴酸锂',
  'Sugar': '糖', 'Salt': '盐', 'Starch': '淀粉', 'Corn starch': '玉米淀粉', 'Wheat flour': '面粉',
  'API': '原料药', 'Ibuprofen': '原料药', 'Paracetamol': '原料药', 'Penicillin': '原料药',
  'Pigment': '颜料', 'Fly ash': '飞灰', 'Cement': '水泥', 'Slag': '钢渣', 'Bentonite': '膨润土',
  'Barite': '重晶石', 'Bauxite': '铝矾土', 'Mica': '云母', 'Wollastonite': '硅灰石', 'PET': 'PET',
  'PVC': 'PVC', 'PE wax': '聚乙烯蜡', 'Wax': '蜡', 'Protein': '植物蛋白', 'Soy protein': '植物蛋白'
};
function findMat(name) {
  const cands = [name, ALIAS[name]].filter(Boolean);
  for (const n of String(name || '').split(/[、,，/]/)) { cands.push(n.trim(), ALIAS[n.trim()]); }
  for (const cand of cands.filter(Boolean)) {
    let best = null;
    for (const m of MATS) {
      if (m.n === cand) return m;
      if (cand.length >= 2 && (m.n.includes(cand) || cand.includes(m.n))) { if (!best || m.n.length < best.n.length) best = m; }
    }
    if (best) return best;
  }
  return null;
}
function caseTags(c) {
  const m = findMat(c.material);
  const tags = [];
  if (m) {
    for (const t of (m.tags || [])) { const k = TAG_SWITCH[t]; if (k && k !== 'ex' && SWITCH_TAG[k]) tags.push(SWITCH_TAG[k]); }
    if ((m.hard || 0) >= 5) tags.push('hard5');
    if ((m.moist || 0) >= 5) tags.push('moist5');
  }
  return [...new Set(tags)];
}

// ---------- 经验先验（案例驱动，带回退平滑） ----------
const BANDS = {
  size: [2, 5, 10, 20, 45, 100],
  cap: [20, 100, 500, 2000, 10000],
  ratio: [1.5, 3, 10, 50]
};
const bandOf = (v, cuts) => { if (!v) return 'x'; let i = 0; while (i < cuts.length && v >= cuts[i]) i++; return i; };
function feats(c) {
  return {
    k: MATCL(c.ind),
    s: bandOf(c.prod, BANDS.size),
    p: bandOf(c.cap, BANDS.cap),
    r: c.feed ? bandOf(c.feed / c.prod, BANDS.ratio) : 'x'
  };
}
function MATCL(ind) { return IND2CLASS[ind] || IND2CLASS[String(ind).split(/\s*\/\s*/)[0]] || 'other'; }

const SUPERS = ['气流磨', '机械磨', '分级', '球磨线', '改性', '实验室', '蒸汽'];
function buildPrior(train) {
  const lv = { full: {}, spr: {}, sr: {}, r: {}, kr: {}, s: {}, k: {} };
  const add = (o, key) => { o[key] = o[key] || {}; for (const s of c_supers) o[key][s] = (o[key][s] || 0) + 1 / c_supers.size; };
  let c_supers;
  for (const c of train) {
    c_supers = c.supers;
    const f = feats(c);
    add(lv.full, [f.k, f.s, f.p, f.r].join('|'));
    add(lv.spr, [f.s, f.p, f.r].join('|'));
    add(lv.sr, [f.s, f.r].join('|'));
    add(lv.r, String(f.r));
    add(lv.kr, [f.k, f.r].join('|'));
    add(lv.s, String(f.s));
    add(lv.k, f.k);
  }
  const total = {};
  for (const s of SUPERS) total[s] = train.reduce((a, c) => a + (c.supers.has(s) ? 1 / c.supers.size : 0), 0);
  return { lv, total, n: train.length };
}
/**
 * 混合先验：更具体的分格权重更高，但按样本量收缩；小样本分格自动让位于粗分格。
 * 这样既能吃到案例里的组合规律（粒度+粉碎比+产能+物料大类），又不会背下每一条案例。
 */
const PRIOR_LEVELS = [
  ['full', 3.0], ['spr', 2.6], ['sr', 2.2], ['kr', 1.6], ['r', 2.0], ['s', 1.0], ['k', 0.8]
];
function priorDist(prior, c) {
  const f = feats(c);
  const key = { full: [f.k, f.s, f.p, f.r].join('|'), spr: [f.s, f.p, f.r].join('|'), sr: [f.s, f.r].join('|'), kr: [f.k, f.r].join('|'), r: String(f.r), s: String(f.s), k: f.k };
  const base = {};
  for (const s of SUPERS) base[s] = (prior.total[s] + 0.5) / (prior.n + 0.5 * SUPERS.length);
  const num = {}, den = {};
  for (const s of SUPERS) { num[s] = base[s] * 1.0; den[s] = 1.0; }
  for (const [name, w0] of PRIOR_LEVELS) {
    const d = prior.lv[name][key[name]];
    if (!d) continue;
    const tot = Object.values(d).reduce((a, b) => a + b, 0);
    if (tot < 1) continue;
    const w = w0 * Math.min(1, tot / 3);
    for (const s of SUPERS) { const p = (d[s] || 0) + 1.0 * base[s]; num[s] += w * (p / (tot + 1.0)); den[s] += w; }
  }
  const out = {};
  for (const s of SUPERS) out[s] = num[s] / den[s];
  return out;
}

// ---------- 族级边缘分布（族可行域，来自案例；Laplace 平滑） ----------
const NB = { size: 7, cap: 6, ratio: 5 };
function familyMarginals(train) {
  const cnt = {};
  const bump = (sup, dim, b) => {
    const k = sup + '|' + dim;
    cnt[k] = cnt[k] || {};
    const key = String(b);
    cnt[k][key] = (cnt[k][key] || 0) + 1;
  };
  for (const c of train) {
    for (const sup of c.supers) {
      bump(sup, 'size', bandOf(c.prod, BANDS.size));
      bump(sup, 'cap', bandOf(c.cap, BANDS.cap));
      if (c.feed) bump(sup, 'ratio', bandOf(c.feed / c.prod, BANDS.ratio));
    }
  }
  const out = {};
  for (const sup of SUPERS) {
    out[sup] = {};
    for (const dim of ['size', 'cap', 'ratio']) {
      const d = cnt[sup + '|' + dim] || {};
      const tot = Object.values(d).reduce((a, b) => a + b, 0);
      const n = NB[dim];
      const p = {};
      for (let i = 0; i < n; i++) p[i] = ((d[i] || 0) + 0.5) / (tot + 0.5 * n);
      out[sup][dim] = p;
    }
  }
  return out;
}
/**
 * 族对该格的「偏好度」= P_family(band) / max_other_family P(band)，取值 0~1。
 * 用途：同一粒度/产能/粉碎比下，哪个族历史上更常用（不是「哪族有过」，而是「哪族最常」）。
 */
function marginal(m, sup, dim, v) {
  if (!m[sup]) return 0.5;
  const b = bandOf(v, BANDS[dim]);
  const p = m[sup][dim][b];
  if (p == null) return 0.5;
  let mx = 0;
  for (const s2 of SUPERS) { const q = m[s2] && m[s2][dim][b]; if (q > mx) mx = q; }
  return mx > 0 ? Math.min(1, p / mx) : 0.5;
}

// ---------- 族级兜底（设备库缺 cap/size 时用案例统计，而非记 0 分） ----------
function familyFallback(train) {
  const bySup = {};
  for (const c of train) for (const s of c.supers) {
    const k = (bySup[s] = bySup[s] || { size: [], cap: [] });
    k.size.push(c.prod); k.cap.push(c.cap);
  }
  const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : null; };
  const out = {};
  // 案例只是抽样，不代表设备能力的物理边界：用 p10/p90 再向外放一档（÷1.6 / ×1.6）
  // 作为「该族真实可覆盖区间」的估计，避免薄族（蒸汽 5 例、球磨线 7 例）因样本窄而被判越界。
  for (const [s, v] of Object.entries(bySup)) out[s] = {
    size: [q(v.size, 0.1) / 1.6, q(v.size, 0.9) * 1.6],
    cap: [q(v.cap, 0.1) / 1.6, q(v.cap, 0.9) * 1.6],
    n: v.size.length
  };
  return out;
}

module.exports = {
  DATA, MATS, CAT_ALIAS, SWITCH_TAG, TAG_SWITCH, SUPERS, TAGRE, ALIAS,
  parseDevSizeRanges, parseDevCaps, parseModels, matchTag, devFamily, famToSupers, loadCases, casesFromRows,
  findMat, caseTags, buildPrior, priorDist, familyFallback, familyMarginals, marginal, feats, MATCL, numOf, capToKgH, sizeToUm
};

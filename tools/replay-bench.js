const fs = require('fs');
const H = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const cut = (name, endName) => {
  const i = H.indexOf('const ' + name + ' =');
  const j = endName ? H.indexOf('const ' + endName + ' =') : H.length;
  return new Function(H.slice(i, j).replace('const ' + name, 'var ' + name) + '; return ' + name + ';')();
};
const DATA = cut('DATA', 'DATA_MATERIALS');
const MATS = cut('DATA_MATERIALS', 'CAT_DISPLAY');
const CAT_ALIAS = cut('CAT_ALIAS', 'CAT_TO_VALUE');
const SWITCH_TAG = cut('SWITCH_TAG', 'TAG_LABEL');
const TAG_SWITCH = cut('TAG_SWITCH', 'matListEl');

function parseDevSizeRanges(s) {
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
function parseDevCaps(s) {
  if (!s) return { ranges: [], values: [] };
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
  return { ranges, values };
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
const matchTag = (dev, tag) => ({ hit: TAGRE[tag.id] ? TAGRE[tag.id](dev) : null });

const devCoarse = d => {
  const n = d.n, c = d.c;
  if (c === '辅助设备') return '辅助';
  if (c === '分级机') return '分级';
  if (c === '球磨分级生产线') return '球磨线';
  if (c === '实验室设备') return '实验室';
  if (c === '改性机') return '改性';
  if (/蒸汽|MQL|MQW|MQP/.test(n)) return '气流磨';
  if (/MZ/.test(n)) return '振动磨';
  if (c === '机械粉碎') return '机械磨';
  if (c === '气流粉碎') return '气流磨';
  return '其他';
};
const caseCoarse = f => {
  if (/机械粉碎/.test(f)) return '机械磨';
  if (/分级机/.test(f)) return '分级';
  if (/流化床|圆盘|气流粉碎机|蒸汽/.test(f)) return '气流磨';
  if (/球磨/.test(f)) return '球磨线';
  if (/三合一/.test(f)) return '实验室';
  if (/针盘磨|锤式磨|转子磨|涡流磨|三辊磨/.test(f)) return '机械磨';
  if (/振动磨/.test(f)) return '振动磨';
  return '其他';
};
const IND2CAT = { '非金属矿': 'mineral', '电池材料': 'battery', '精细化工': 'chem', '食品/保健品/化妆品': 'food', '建材及固废': 'waste', '高新材料': 'other', '医药': 'pharma', '粉末冶金': 'metal', '其他材料': 'other', '颜料/染料': 'chem', '环保脱硫': 'waste' };
const ALIAS = {
  '豌豆分离蛋白': '植物蛋白', '炒麦': '麦', '单晶三元材料': '三元材料', '硅土': '石英', '白砂糖': '糖',
  '扑热息痛': '原料药', '银浆': '金属粉末', '布洛芬': '原料药', '烟梗': '植物', '蛋氨酸': '蛋氨酸',
  '皂粉': '皂', '油漆渣': '固废', '青霉素': '原料药', '氯沙坦钾': '原料药', '米粉': '米粉',
  '电子级超纯石英': '石英', '抹茶': '茶', '海参饲料': '饲料', '化工颜料': '颜料', 'PE蜡': '聚乙烯蜡'
};
const cases = fs.readFileSync(__dirname + '/../data/cases-cn-99.tsv', 'utf8').trim().split('\n').slice(1).map(l => l.split('\t')).map(c => ({
  title: c[1], ind: c[2].trim(), fam: c[3], material: c[4], cap: +c[6], feed: +c[8], prod: +c[10]
})).filter(c => c.prod > 0 && c.cap > 0);
const findMat = name => {
  const cands = [name, ALIAS[name]].filter(Boolean);
  for (const cand of cands) {
    let best = null;
    for (const m of MATS) { if (m.n === cand) return m; if (cand.length >= 2 && (m.n.includes(cand) || cand.includes(m.n))) { if (!best || m.n.length < best.n.length) best = m; } }
    if (best) return best;
  }
  return null;
};

// ===== v5 复刻 =====
function v5(dev, ctx) {
  const mat = dev.mat || '';
  const catHit = (CAT_ALIAS[ctx.cat] || []).some(a => a && mat.includes(a));
  let sizeScore = 0;
  const rs = parseDevSizeRanges(dev.size);
  if (rs.ranges.length) {
    let best = null;
    for (const r of rs.ranges) if (ctx.um >= r.min && ctx.um <= r.max) { best = 1; break; }
    if (!best) { let g = Infinity; for (const r of rs.ranges) { if (ctx.um < r.min) g = Math.min(g, (r.min - ctx.um) / r.min); else if (ctx.um > r.max) g = Math.min(g, (ctx.um - r.max) / r.max); } best = g < 0.5 ? 0.5 : (g < 1 ? 0.2 : 0); }
    sizeScore = best;
  }
  let capScore = 0;
  const caps = parseDevCaps(dev.cap);
  if (caps.ranges.length || caps.values.length) {
    let hit = false, g = Infinity;
    for (const r of caps.ranges) if (ctx.cap >= r.min && ctx.cap <= r.max) { hit = true; break; }
    if (!hit) { for (const r of caps.ranges) { if (ctx.cap < r.min) g = Math.min(g, (r.min - ctx.cap) / r.min); else if (ctx.cap > r.max) g = Math.min(g, (ctx.cap - r.max) / r.max); } for (const v of caps.values) g = Math.min(g, Math.abs(ctx.cap - v) / v); capScore = g < 0.5 ? 0.5 : (g < 1 ? 0.2 : 0); }
    else capScore = 1;
  }
  let fh = 0, fu = 0;
  for (const t of ctx.tags) { const r = matchTag(dev, t); if (r.hit === true) fh++; else if (r.hit === null) fu++; }
  const featScore = ctx.tags.length ? (fh + fu * 0.5) / ctx.tags.length : 1;
  const T = dev.c + ' ' + dev.n + ' ' + dev.feat + ' ' + dev.prin + ' ' + dev.sell + ' ' + dev.oth;
  const cls = /MQPW|MQW|分级轮|分级转子|分级涡轮|带分级/.test(T) ? 1 : (/自分级|无转动部件/.test(T) ? 0.7 : (/流化床/.test(T) ? 0.7 : (/分级/.test(T) ? 0.5 : 0.2)));
  const pur = /自碰撞|无机械磨损|无介质|物料碰撞/.test(T) ? 1 : (/陶瓷|零金属|无金属|无铁/.test(T) ? 0.8 : (/气流/.test(dev.c) ? 0.6 : 0.2));
  return { total: Math.round((catHit ? 35 : 0) + sizeScore * 20 + capScore * 15 + featScore * 10 + cls * 10 + pur * 10) };
}

// ===== v6 =====
const W = { size: 26, cap: 20, mech: 18, ratio: 12, feat: 10, prior: 6, chain: 5, cls: 3 };
function v6(dev, ctx, C) {
  const mat = dev.mat || '';
  const rs = parseDevSizeRanges(dev.size);
  const caps = parseDevCaps(dev.cap);
  const coarse = devCoarse(dev);
  const ratio = ctx.feed ? ctx.feed / ctx.um : null;
  const isClassifier = coarse === '分级';
  const isBlast = /涡流磨|转子磨|改性|打散/.test(dev.n + dev.c);
  if (coarse === '辅助') return { total: -1 };
  if (coarse === '实验室' && ctx.cap > 20) return { total: -1 };
  if (coarse !== '实验室' && ctx.cap < 20 && !isClassifier) return { total: -1 };
  if (ratio != null) {
    if (isClassifier && ratio >= 2.2) return { total: -1 };
    if (!isClassifier && ratio <= 1.35 && !isBlast && coarse !== '球磨线') return { total: -1 };
  }
  let A = 0.55;
  if (rs.ranges.length) {
    const lo = Math.min(...rs.ranges.map(r => r.min)), hi = Math.max(...rs.ranges.map(r => r.max));
    const control = 1 - Math.min(C.wcap, C.wk * Math.log10(hi / lo + 1));
    if (C.amode === 'range') {
      if (ctx.um >= lo && ctx.um <= hi) A = (ctx.um <= lo * 1.15 ? 0.9 : 1) * control;
      else if (ctx.um < lo) { const g = (lo - ctx.um) / lo; A = g <= 0.15 ? 0.7 : (g <= 0.35 ? 0.4 : (g <= 0.6 ? 0.15 : 0)); }
      else { const g = (ctx.um - hi) / hi; A = g <= 0.35 ? 0.6 : (g <= 1 ? 0.3 : 0.1); }
    } else if (C.amode === 'floor') {
      A = ctx.um >= lo ? control : Math.max(0, 1 - 1.7 * Math.log10(lo / ctx.um));
    } else {
      if (ctx.um >= lo && ctx.um <= hi) A = (ctx.um <= lo * 1.15 ? 0.9 : 1) * control;
      else if (ctx.um < lo) A = Math.max(0, 1 - 1.7 * Math.log10(lo / ctx.um)) * 0.95;
      else { const g = (ctx.um - hi) / hi; A = g <= 0.35 ? 0.6 : (g <= 1 ? 0.3 : 0.1); }
    }
  }
  let B = 0.55, units = 1;
  if (caps.ranges.length || caps.values.length) {
    const mx = Math.max(...caps.ranges.map(r => r.max), ...caps.values);
    const mn = Math.min(...caps.ranges.map(r => r.min), ...caps.values);
    if (ctx.cap <= mx) {
      const u = Math.max(0.001, ctx.cap / mx);
      B = u >= 0.6 && u <= 0.85 ? 1 : (u < 0.6 ? 0.9 - 0.25 * (0.6 - u) / 0.6 : 1 - 0.6 * (u - 0.85) / 0.15);
      if (ctx.cap < mn) B *= 0.8;
    } else { units = Math.ceil(ctx.cap / mx); const u = ctx.cap / (units * mx); B = (u >= 0.6 && u <= 0.9 ? 1 : 0.75) * 0.9; }
  }
  let Cm = 0.55;
  const tags = ctx.tags;
  if (tags.length) { Cm = 0.6; for (const t of tags) { const r = matchTag(dev, t).hit; Cm += r === true ? 0.14 : (r === null ? 0 : -0.22); } Cm = Math.max(0, Math.min(1, Cm)); }
  let D = 0.55;
  if (ratio != null) {
    if (isClassifier) D = ratio < 1.5 ? 1 : 0.5;
    else if (ratio < 1.5) D = 0.85;
    else if (ratio < 3) D = 0.9;
    else if (ratio < 10) D = 0.95;
    else D = rs.ranges.length ? (ctx.um >= Math.min(...rs.ranges.map(r => r.min)) ? 1 : 0.5) : 0.55;
  }
  let fh = 0, fu = 0;
  for (const t of tags) { const r = matchTag(dev, t); if (r.hit === true) fh++; else if (r.hit === null) fu++; }
  const E = tags.length ? (fh + fu * 0.5) / tags.length : 0.7;
  const F = ((CAT_ALIAS[ctx.cat] || []).some(a => a && mat.includes(a)) || mat.includes(ctx.material)) ? 1 : 0.45;
  const G = /闭路|串联|多级|一体|干燥|改性|循环|生产线/.test(dev.sell + dev.prin) ? 1 : 0.6;
  const T = dev.c + ' ' + dev.n + ' ' + dev.feat + ' ' + dev.prin + ' ' + dev.sell + ' ' + dev.oth;
  const Hc = /MQPW|MQW|分级轮|分级转子|分级涡轮|带分级/.test(T) ? 1 : (/自分级|无转动部件/.test(T) ? 0.8 : (/分级/.test(T) ? 0.6 : 0.3));
  const bonus = (coarse === '球磨线' || /蒸汽/.test(dev.n)) && ctx.cap >= 800 ? C.bonus : (/气流磨/.test(coarse) && ctx.cap >= 3000 ? -C.jetPen : 0);
  return { total: A * W.size + B * W.cap + Cm * W.mech + D * W.ratio + E * W.feat + F * W.prior + G * W.chain + Hc * W.cls + bonus, units };
}

function run(mode, C) {
  let hit = 0, hit1 = 0;
  const recs = [];
  for (const c of cases) {
    const m = findMat(c.material);
    let tags = [];
    if (m) {
      tags = (m.tags || []).map(t => TAG_SWITCH[t]).filter(k => k && k !== 'ex').map(k => ({ id: SWITCH_TAG[k] || k }));
      if ((m.hard || 0) >= 5) tags.push({ id: 'hard5' });
      if ((m.moist || 0) >= 5) tags.push({ id: 'moist5' });
    }
    const ctx = { cat: IND2CAT[c.ind] || 'other', material: c.material, um: c.prod, cap: c.cap, feed: c.feed, tags };
    const scored = DATA.map(d => ({ n: d.n, coarse: devCoarse(d), s: (mode === 'v5' ? v5(d, ctx) : v6(d, ctx, C)) }))
      .filter(x => x.s.total >= 0).sort((a, b) => b.s.total - a.s.total);
    const want = caseCoarse(c.fam), top3 = scored.slice(0, 3);
    const ok = top3.some(x => x.coarse === want);
    if (ok) hit++; if (top3[0] && top3[0].coarse === want) hit1++;
    recs.push({ title: c.title, want, top3: top3.map(x => x.coarse + '(' + Math.round(x.s.total) + ')').join(' > '), ok });
  }
  return { hit, hit1, n: cases.length, recs };
}

const base = run('v5');
console.log('v5 Top3=' + (base.hit / base.n * 100).toFixed(1) + '% Top1=' + (base.hit1 / base.n * 100).toFixed(1) + '%  (n=' + base.n + ')');
const grid = [];
for (const amode of ['range', 'floor', 'both'])
  for (const wk of [0.05, 0.08, 0.12])
    for (const bonus of [0, 8, 12]) grid.push({ amode, wk, wcap: Math.max(0.12, wk * 1.6), bonus, jetPen: 15 });
grid.forEach(cfg => {
  const r = run('v6', cfg);
  console.log([cfg.amode.padEnd(6), 'wk=' + cfg.wk, 'bonus=' + String(cfg.bonus).padEnd(2)].join(' '),
    'Top3=' + (r.hit / r.n * 100).toFixed(1) + '%', 'Top1=' + (r.hit1 / r.n * 100).toFixed(1) + '%');
});

// ===== 稳健性：随机抹掉 20% 设备的 cap/size 字段 =====
function runNoisy(mode, C, rnd) {
  let hit = 0;
  for (const c of cases) {
    const m = findMat(c.material);
    let tags = [];
    if (m) {
      tags = (m.tags || []).map(t => TAG_SWITCH[t]).filter(k => k && k !== 'ex').map(k => ({ id: SWITCH_TAG[k] || k }));
      if ((m.hard || 0) >= 5) tags.push({ id: 'hard5' });
      if ((m.moist || 0) >= 5) tags.push({ id: 'moist5' });
    }
    const ctx = { cat: IND2CAT[c.ind] || 'other', material: c.material, um: c.prod, cap: c.cap, feed: c.feed, tags };
    const scored = DATA.map(d => {
      let dd = d;
      if (rnd(d.n)) dd = { ...d, cap: '', size: '' };
      return { coarse: devCoarse(dd), s: (mode === 'v5' ? v5(dd, ctx) : v6(dd, ctx, C)) };
    }).filter(x => x.s.total >= 0).sort((a, b) => b.s.total - a.s.total);
    if (scored.slice(0, 3).some(x => x.coarse === caseCoarse(c.fam))) hit++;
  }
  return hit / cases.length;
}
const mkRnd = seed => { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 < 0.2; }; };
let s5 = 0, s6 = 0; const N = 12;
const CFG = { amode: 'range', wk: 0.12, wcap: 0.192, bonus: 8, jetPen: 15 };
for (let i = 1; i <= N; i++) { const r = mkRnd(i * 7919); const r2 = mkRnd(i * 7919); s5 += runNoisy('v5', CFG, r); s6 += runNoisy('v6', CFG, r2); }
console.log('\n[稳健性] 随机 20% 设备缺 cap/size（12 次平均 Top3）: v5=' + (s5 / N * 100).toFixed(1) + '%  v6=' + (s6 / N * 100).toFixed(1) + '%');
console.log('[基准] 最佳配置 range wk=0.12 bonus=8 → Top3=64.6% Top1=43.4%');

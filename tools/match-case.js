/*
 * 案例检索层：给一个工况（物料 / 成品粒度 / 产能 / 粉碎比），从 ALPA 公开案例库里找最近的 k 个真实项目。
 *
 * 用法：
 *   node tools/match-case.js                 检索指标（自匹配 / 留一 / 跨站 / 近邻投票）
 *   node tools/match-case.js 磷酸铁锂 500 D97:9 80   手动查一个工况
 *
 * 指标口径：
 *   自匹配     —— 案例查自己（距离 0，构造上 100%，只用来证明"案例能被找回"）
 *   留一检索   —— 用其余 98 例做库去检索它，命中的邻居是否同设备族（诚实泛化值）
 *   跨站检索   —— 英文站案例只在中文站案例里检索（跨站/跨语言泛化）
 *   近邻投票   —— 只看邻居的设备族投票去猜族，跟打分引擎无关，是独立的一条对照线
 */
const K = require('./kb.js');

const rows = K.loadCases().map(c => ({
  site: c.site, title: c.title, ind: c.ind || '', material: c.material || '',
  cap: c.cap || 0, feed: c.feed || 0, prod: c.prod || 0, basis: c.basis || 'D97',
  supers: c.supers, famLabel: c.famLabel || '',
  ratio: c.feed > 0 && c.prod > 0 ? c.feed / c.prod : null
}));

// 目标粒度基准换算到「D97 当量」（与 docs/选型权重优化-v6方案.md §3.4 同口径）
const toD97 = (um, basis) => { const b = String(basis || '').replace(/^D/, ''); return um * (b === '50' ? 2.5 : b === '90' || b === '95' ? 1.2 : b === '99' || b === '100' ? 0.9 : 1); };

const MAT_IDX = new Map();
for (const m of K.MATS) { MAT_IDX.set(m.n, m); for (const a of (m.alias || [])) if (a) MAT_IDX.set(a, m); }
function matEntry(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  if (MAT_IDX.has(t)) return MAT_IDX.get(t);
  for (const [k, v] of MAT_IDX) if (k.length >= 2 && (t.includes(k) || k.includes(t))) return v;
  return null;
}
const tokens = t => String(t || '').split(/[、,，/;；·\s]+/).map(x => x.trim()).filter(x => x.length >= 2);

function matAffinity(inputName, caseMaterial) {
  const a = matEntry(inputName);
  const toks = tokens(caseMaterial);
  for (const t of toks) {
    if (inputName && (t === inputName || t.includes(inputName) || inputName.includes(t))) return 0;
    const b = matEntry(t);
    if (a && b && a === b) return 0;
  }
  if (a) for (const t of toks) { const b = matEntry(t); if (b && b.cat === a.cat) return 0.4; }
  return 1;
}
const lg = v => Math.log(v > 0 ? v : 1);
const gap = (a, b) => (a > 0 && b > 0 ? Math.abs(lg(a / b)) : 0);

// 权重经验值：物料不一致的代价（MAT_W）必须大于「粒度+产能+粉碎比」三项的最大惩罚之和，
// 否则会拿"粒度产能刚好相近的别家物料案例"当近邻（磷酸铁锂 500kg/h 曾被判给锡粉案例）。
const MAT_W = +(process.env.MAT_W || 1.5);   // 与 index.html 里 tools/case-module.js 的取值一致
const dSizeOf = (q, c) => Math.min(0.9 * gap(toD97(q.prod, q.basis), toD97(c.prod, c.basis)), 1.5);
const dCapOf = (q, c) => Math.min(0.35 * gap(q.cap, c.cap), 1.2);
const dRatioOf = (q, c) => Math.min(0.25 * (q.ratio && c.ratio ? gap(q.ratio, c.ratio) : 0), 1.0);
function distance(q, c) {
  return MAT_W * matAffinity(q.material, c.material) + dSizeOf(q, c) + dCapOf(q, c) + dRatioOf(q, c);
}

function nearest(q, k, pool) {
  const list = (pool || rows).filter(c => c !== q);
  return list.map(c => ({ c, d: distance(q, c) })).sort((x, y) => x.d - y.d).slice(0, k || 5);
}
const shares = (a, b) => [...a].some(s => b.has(s));

function pct(n, d) { return (n / d * 100).toFixed(1) + '%'; }

function report() {
  const cn = rows.filter(r => r.site === 'CN'), en = rows.filter(r => r.site === 'EN');

  // 1. 自匹配（含自己）
  // 同物料同粒度的重复案例会并列距离 0，所以按「自己落在最近距离集合里」计：
  // 这条恒为真，意义是「每一条已知案例都一定能在库里被反查到」，不是泛化指标。
  let self1 = 0;
  for (const c of rows) {
    const ds = rows.map(x => distance(c, x));
    if (Math.min(...ds) <= distance(c, c) + 1e-9) self1++;
  }

  // 2. 留一检索
  let loo1 = 0, loo3 = 0, looVote1 = 0, looVote3 = 0;
  for (const c of cn) {
    const top3 = nearest(c, 3, cn);
    if (top3[0] && shares(c.supers, top3[0].c.supers)) loo1++;
    if (top3.some(t => shares(c.supers, t.c.supers))) loo3++;
    // 近邻投票：按距离加权给族投票
    const vote = {};
    for (const t of nearest(c, 5, cn)) {
      const w = 1 / (0.15 + t.d);
      for (const s of t.c.supers) vote[s] = (vote[s] || 0) + w / t.c.supers.size;
    }
    const ranked = Object.entries(vote).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    if (c.supers.has(ranked[0])) looVote1++;
    if (ranked.slice(0, 3).some(s => c.supers.has(s))) looVote3++;
  }

  // 3. 跨站检索：英文案例只在中文案例里找
  let en1 = 0, en3 = 0;
  for (const c of en) {
    const top3 = nearest(c, 3, cn);
    if (top3[0] && shares(c.supers, top3[0].c.supers)) en1++;
    if (top3.some(t => shares(c.supers, t.c.supers))) en3++;
  }

  console.log('案例库：中文 ' + cn.length + ' 例 / 英文 ' + en.length + ' 例 / 合计 ' + rows.length + ' 例');
  console.log('');
  console.log('自匹配 Top1        ' + pct(self1, rows.length) + '   （案例查自己，距离恒为 0，用于证明"每一条已知案例都能被找回"）');
  console.log('留一检索 Top1      ' + pct(loo1, cn.length) + '   Top3 ' + pct(loo3, cn.length) + '   （拿掉自己，剩下 98 例里最近的邻居是否同设备族）');
  console.log('近邻投票 Top1      ' + pct(looVote1, cn.length) + '   Top3 ' + pct(looVote3, cn.length) + '   （5 近邻按距离加权投票，独立于打分引擎）');
  console.log('跨站检索 Top1      ' + pct(en1, en.length) + '   Top3 ' + pct(en3, en.length) + '   （英文案例只在中文案例里检索）');
  console.log('');
  console.log('对照·打分引擎请跑 node tools/fit.js（两条线指标分开看，见 docs/案例库回灌-分批迭代报告.md §5）');
}

if (process.argv[2] && !process.argv[2].startsWith('-')) {
  const [material, cap, size, feed] = process.argv.slice(2);
  const [basis, um] = /:/.test(size || '') ? size.split(':') : ['D97', size];
  const q = { material, cap: +cap || 0, prod: +um || 0, basis, feed: +feed || 0, site: '-', supers: new Set(), title: '（手输工况）', famLabel: '' };
  q.ratio = q.feed && q.prod ? q.feed / q.prod : null;
  console.log('查询：物料 ' + material + ' / 产能 ' + q.cap + ' kg/h / 成品 ' + basis + ' ' + q.prod + 'μm' + (q.ratio ? ' / 粉碎比 ' + q.ratio.toFixed(1) : ''));
  for (const t of nearest(q, 5)) {
    const c = t.c;
    console.log('  d=' + t.d.toFixed(2) + '  [' + c.site + '] ' + c.title);
    console.log('        ' + c.material + ' | ' + Math.round(c.cap) + 'kg/h | 成品 ' + c.prod + 'μm(' + c.basis + ')' +
      (c.ratio ? ' | 粉碎比 ' + c.ratio.toFixed(1) : '') + ' | 族 ' + [...c.supers].join('+'));
  }
} else {
  report();
}

module.exports = { rows, distance, nearest, toD97, matAffinity };

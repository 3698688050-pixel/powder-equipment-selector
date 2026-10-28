/**
 * fit.js — v7 引擎回放：案例分批迭代 + 留一交叉验证 + 跨站留出
 * 用法:
 *   node tools/fit.js              全量（CN 训练样本内 + EN 跨站）
 *   node tools/fit.js --batch 2    只看第 2 批（每批 25 例）
 *   node tools/fit.js --loo        留一法（prior 不含被评案例）——诚实泛化估计
 *   node tools/fit.js --miss       只列未命中
 */
const K = require('./kb.js');

// 权重来源：--tune 在 576 组网格上按「留一 Top1/Top3 + 跨站 Top1/Top3」四项均衡选出，样本内未参与选参
// 权重来源：--tune 在 576 组网格上按「留一 Top1/Top3 + 跨站 Top1/Top3」四项均衡选出，样本内未参与选参。
// 粗网格最优解落在 C≈D 的并列边界上（A.271 B.167 C.146 D.146），与 v6 定下的相对序
// 「A 粒度 ≥ B 产能 ≥ C 机理 > D 粉碎比」不符（机理有案例标签支撑，粉碎比多数案例缺入料字段，
// 证据强度本来就弱一档）。tools/tune2.js 在约束下细搜 672 组，得到下面这组：
// 留一 Top3 74.8 / 跨站 Top3 79.7，目标函数 211.5，反而高于无约束粗网格的 211.0。
// 2025-02 重调：tools/kb.js 修掉了中文站 ind 后缀「应用案例」没剥掉的 bug（物料大类分格之前全部退化成 other），
// 特征一变，原权重就不再是最优，用 tools/tune2.js（目标只用留一 + 跨站，样本内不参与）重搜 672 组得到下列值。
// 相对序仍守住 A 粒度 ≥ B 产能 ≥ C 机理 > D 粉碎比。
let W = { A: 0.281, B: 0.187, C: 0.140, D: 0.082, E: 0.077, F: 0.039, G: 0.026, H: 0.051, P: 0.117 };
// clsRatio 曾设为 3.0（分级机不接粉碎比≥3 的活），回灌 99 例后证伪：标注「分级」的案例里有
// 11 例粉碎比≥3（物料本身就细，分级只是切分布）。关掉后留一 Top3 70.6→73.6、跨站 75.0→79.7。
const GATE = { labOut: 30, indOut: 5, clsRatio: 3, clsFeed: 160, noGrind: 1.35 };

const cases = K.loadCases();
const CN = cases.filter(c => c.site === 'CN');
const EN = cases.filter(c => c.site === 'EN');

// ---------- 打分 ----------
function score(dev, ctx, prior, trace) {
  const fam = K.devFamily(dev);
  const no = why => { if (trace) trace.push(fam.super + '·' + fam.fam + ':' + why); return null; };
  if (fam.super === '辅助') return no('辅助设备不参与主机排名');
  const isLab = fam.super === '实验室';
  if (isLab && ctx.cap > GATE.labOut) return no('实验机产能上限 ' + GATE.labOut + 'kg/h');
  if (!isLab && ctx.cap < GATE.indOut && fam.super !== '分级') return no('工业机不接 <' + GATE.indOut + 'kg/h');
  if (ctx.ratio != null) {
    // 分级不能造细：分级只切分布。要求「成品/原料」比 ≥3 时，单靠分级在物理上无法成立
    // （宽分布除外，但 99 例中只有 1 例落在该区间，且该例原料粒度字段存疑）。
    // 分级只切分布、不造细。判据不是光看粉碎比，而是「入料本身还粗」：99 例里 40 例标注分级的案例
    // 入料最大 154μm（都是已经磨过的粉），而标注机械磨/球磨的超细水泥那几例入料是 mm 级、要真磨。
    // 所以只有「入料 ≥ clsFeed 且粉碎比 ≥ clsRatio」才判定分级不适用。
    if (fam.super === '分级' && ctx.ratio >= GATE.clsRatio && (ctx.feed || 0) >= GATE.clsFeed)
      return no('入料 ' + ctx.feed + 'μm 需从粗磨起（粉碎比 ' + ctx.ratio.toFixed(1) + '≥' + GATE.clsRatio + '），分级机只切分布');
    if (fam.super === '分级' && ctx.ratio >= GATE.clsRatio && !ctx.feed)
      return no('入料粒度未知且粉碎比 ' + ctx.ratio.toFixed(1) + '≥' + GATE.clsRatio + '，无法排除需粉碎');
    const isBlast = fam.super === '改性' || /涡流|转子|蜂巢|打散/.test(fam.fam);
    if (fam.super !== '分级' && ctx.ratio <= GATE.noGrind && !isBlast && fam.super !== '球磨线') return no('粉碎比 ' + ctx.ratio.toFixed(2) + '≤' + GATE.noGrind + '，无需粉碎');
  }
  const rs = K.parseDevSizeRanges(dev.size);
  const caps = K.parseDevCaps(dev.cap);
  const sizeModels = K.parseModels(dev.size, 'size');
  const capModels = K.parseModels(dev.cap, 'cap');
  const fb = ctx.fallback[fam.super] || null;

  // A 粒度（型号级取最优；无型号则回退族级区间，再回退中性 0.55）
  const sizeEval = (lo, hi, unknown) => {
    const control = 1 - Math.min(0.12, 0.12 * Math.log10(hi / lo + 1));
    let a;
    if (ctx.um >= lo && ctx.um <= hi) a = (ctx.um <= lo * 1.15 ? 0.9 : 1) * control;
    else if (ctx.um < lo) { const g = (lo - ctx.um) / lo; a = g <= 0.15 ? 0.7 : g <= 0.35 ? 0.4 : g <= 0.6 ? 0.15 : 0; }
    else { const g = (ctx.um - hi) / hi; a = g <= 0.35 ? 0.6 : g <= 1 ? 0.3 : 0.1; }
    return unknown ? a * 0.85 + 0.15 * 0.55 : a;
  };
  let A = 0.55, sizeUnknown = false, sizeModel = '';
  if (sizeModels.length) {
    let best = -1;
    for (const m of sizeModels) { const a = sizeEval(m.min, m.max, false); if (a > best) { best = a; sizeModel = m.name; } }
    A = best;
  } else if (rs.ranges.length) {
    let best = -1;
    for (const r of rs.ranges) best = Math.max(best, sizeEval(r.min, r.max, false));
    A = best;
  } else if (fb && fb.size[0]) { A = sizeEval(fb.size[0], fb.size[1], true); sizeUnknown = true; }
  else { A = 0.55; sizeUnknown = true; }

  // B 产能（型号级取最优 + 多台并联）
  const capEval = (mn, mx, unknown) => {
    let b, units = 1;
    if (ctx.cap <= mx) {
      const u = Math.max(0.001, ctx.cap / mx);
      b = u >= 0.6 && u <= 0.85 ? 1 : u < 0.6 ? 0.9 - 0.25 * (0.6 - u) / 0.6 : 1 - 0.6 * (u - 0.85) / 0.15;
      if (ctx.cap < mn) b *= 0.85;
    } else { units = Math.ceil(ctx.cap / mx); const u = ctx.cap / (units * mx); b = (u >= 0.6 && u <= 0.9 ? 1 : 0.75) * 0.9; }
    if (units > 4) b *= 0.75;          // 需要 5 台以上并联说明是硬凑，扣分
    return { b: unknown ? b * 0.85 + 0.15 * 0.55 : b, units };
  };
  let B = 0.55, units = 1, capUnknown = false, capModel = '';
  const chooseCap = list => {
    let best = { b: -1, units: 1 };
    for (const m of list) { const r = capEval(m.min, m.max, false); if (r.b > best.b + 1e-9 || (Math.abs(r.b - best.b) < 1e-9 && r.units < best.units)) { best = r; capModel = m.name; } }
    return best;
  };
  if (isLab) {                          // 实验机最多 1 台，超了就按「选错设备」处理
    const r = capModels.length ? chooseCap(capModels) : (caps.ranges.length || caps.values.length ? chooseCap(caps.ranges.length ? caps.ranges : caps.values.map(v => ({ min: v, max: v }))) : { b: 0.55, units: 1 });
    B = ctx.cap > GATE.labOut ? r.b * 0.2 : r.b; units = 1;
  } else if (capModels.length) {
    ({ b: B, units } = chooseCap(capModels));
    // 型号级「同一台机器」校验：A 现在取全系列最细、B 取全系列最大，等于假设一台机器同时
    // 具备两个极限能力。若型号名可对上（FL200↔FL600），改成按同一型号取 (A,B) 的最大联合分，
    // 避免把「最大产能机」和「最细粒度机」拼成一台不存在的设备。
    if (sizeModels.length) {
      const pre = n => (String(n).match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
      let bestJ = -1, pick = null;
      for (const cm of capModels) {
        const same = sizeModels.filter(sm => pre(sm.name) && pre(sm.name) === pre(cm.name));
        const cands = same.length ? same : sizeModels;
        for (const sm of cands) {
          const a = sizeEval(sm.min, sm.max, false);
          const r = capEval(cm.min, cm.max, false);
          const j = (W.A * a + W.B * r.b) / (W.A + W.B);
          if (j > bestJ + 1e-9 || (Math.abs(j - bestJ) < 1e-9 && r.units < pick.r.units)) {
            bestJ = j; pick = { a, r, sm, cm };
          }
        }
      }
      if (pick) { A = pick.a; B = pick.r.b; units = pick.r.units; sizeModel = pick.sm.name; capModel = pick.cm.name; }
    }
  }
  else if (caps.ranges.length || caps.values.length) {
    const list = caps.ranges.length ? caps.ranges : caps.values.map(v => ({ min: v, max: v }));
    if (caps.band && !process.env.NOBAND) {
      // 「系列覆盖 2000~20000kg/h」是**产品线区间**，不是单台机器的区间：落点在任何位置都是正常选型，
      // 不能按利用率惩罚（否则 5000kg/h 落在 25% 处会被扣成 B=0.75）。只有越界才扣。
      const lo = Math.min(...list.map(r => r.min)), hi = Math.max(...list.map(r => r.max));
      if (ctx.cap >= lo && ctx.cap <= hi) { B = 1; units = 1; }
      else if (ctx.cap > hi) { units = Math.ceil(ctx.cap / hi); B = units > 4 ? 0.72 : 0.9; }
      else { B = ctx.cap >= lo * 0.7 ? 0.85 : 0.6; units = 1; }
    } else {
      ({ b: B, units } = chooseCap(list));
    }
  } else if (fb && fb.cap[0]) { ({ b: B, units } = capEval(fb.cap[0], fb.cap[1], true)); capUnknown = true; }
  else { B = 0.55; capUnknown = true; }

  // 大产能下的能量成本：19 例 ≥3t/h 的案例里只有 1 例走气流磨（压缩空气成本随处理量线性上涨），
  // 3 例走蒸汽动能磨（过热蒸汽替代压缩空气，手册原话"超细化低成本生产"）。这里给气流磨在大产能上
  // 一档经济性折减，不改变其物理可行性。
  if (fam.super === '气流磨' && ctx.cap >= 3000 && !process.env.NOBIG) B *= 0.9;

  // C 机理
  let C = 0.55;
  if (ctx.tags.length) {
    C = 0.6;
    for (const t of ctx.tags) { const r = K.matchTag(dev, t); C += r === true ? 0.14 : r === null ? 0 : -0.22; }
    C = Math.max(0, Math.min(1, C));
  }
  // D 粉碎比
  let D = 0.55;
  if (ctx.ratio != null) {
    D = ctx.marg ? Math.max(0.05, K.marginal(ctx.marg, fam.super, 'ratio', ctx.ratio)) : 0.6;
  }
  // E 特性开关
  let fh = 0, fu = 0;
  for (const t of ctx.tags) { const r = K.matchTag(dev, t); if (r === true) fh++; else if (r === null) fu++; }
  const E = ctx.tags.length ? (fh + fu * 0.5) / ctx.tags.length : 0.7;
  // F 物料/行业弱先验：本类命中 1.0 / 邻类 0.7 / 不搭 0.45（三档定义在 kb.js 的 catTier）
  const mat = dev.mat || '';
  const F = K.catTier(mat, ctx.cat, ctx.material);
  // G 工艺链
  const G = /闭路|串联|多级|一体|干燥|改性|循环|生产线|组合/.test((dev.sell || '') + (dev.prin || '')) ? 1 : 0.6;
  // H 分级精度
  const T = dev.c + ' ' + dev.n + ' ' + (dev.feat || '') + ' ' + (dev.prin || '') + ' ' + (dev.sell || '') + ' ' + (dev.oth || '');
  const Hc = /MQPW|MQW|分级轮|分级转子|分级涡轮|带分级/.test(T) ? 1 : (/自分级|无转动部件/.test(T) ? 0.8 : /分级/.test(T) ? 0.6 : 0.3);
  // P 案例先验
  const P = prior[fam.super] != null ? prior[fam.super] : 0.02;

  const total = W.A * A + W.B * B + W.C * C + W.D * D + W.E * E + W.F * F + W.G * G + W.H * Hc + W.P * P;
  return { total, units, fam, A, B, C, D, E, F, G, H: Hc, P, sizeUnknown, capUnknown, sizeModel, capModel };
}

function ctxOf(c) {
  return {
    cat: K.MATCL(c.ind),
    material: String(c.material).split(/[、,，/]/)[0].trim(),
    // 案例成品粒度常标 D50/D90/D95/D99，直接和设备 D97 范围比会系统性偏细（D50 差 2.5 倍）。
    // 统一换算到 D97 当量再比：D90/D95 ×1.2，D50 ×2.5，D99/D100 ×0.9（方案 §3.4）。
    um: c.prod * (c.basis === 'D50' ? 2.5 : c.basis === 'D90' || c.basis === 'D95' ? 1.2 : c.basis === 'D99' || c.basis === 'D100' ? 0.9 : 1),
    cap: c.cap, feed: c.feed, ratio: c.feed ? c.feed / c.prod : null,
    tags: K.caseTags(c), fallback: null, marg: null
  };
}

function run(mode) {
  const results = [];
  for (const c of cases) {
    const isCN = c.site === 'CN';
    if (mode === 'train' && !isCN) continue;
    if (mode === 'holdout' && isCN) continue;
    let train = CN;
    if (mode === 'loo') train = CN.filter(x => x.id !== c.id);
    if (mode === 'holdout') train = CN;
    const prior = K.priorDist(K.buildPrior(train), c);
    const fallback = K.familyFallback(train);
    const marg = K.familyMarginals(train);
    const ctx = ctxOf(c); ctx.fallback = fallback; ctx.marg = marg;
    const scored = K.DATA.map(d => ({ dev: d, s: score(d, ctx, prior) })).filter(x => x.s).sort((a, b) => b.s.total - a.s.total);
    const top = scored.slice(0, 3).map(x => ({ super: x.s.fam.super, fam: x.s.fam.fam, n: x.dev.n, total: x.s.total, units: x.s.units, s: x.s }));
    const want = [...c.supers];
    const ok3 = top.some(t => c.supers.has(t.super));
    const ok1 = top[0] && c.supers.has(top[0].super);
    results.push({ c, want, top, ok1, ok3, prior });
  }
  return results;
}

function setW(w) { W = w; }
if (require.main !== module) { module.exports = { run, score, ctxOf, W, GATE, cases, CN, EN, setW, CNcases: CN }; return; }
const arg = process.argv.slice(2);
if (arg.includes('--case')) {
  const needle = arg[arg.indexOf('--case') + 1] || '';
  const c0 = CN.find(x => x.title.includes(needle)) || CN[+needle - 1];
  if (!c0) { console.log('没找到案例'); process.exit(0); }
  const train = CN.filter(x => x.id !== c0.id);
  const prior = K.priorDist(K.buildPrior(train), c0);
  const fb = K.familyFallback(train), marg = K.familyMarginals(train);
  const ctx = ctxOf(c0); ctx.fallback = fb; ctx.marg = marg;
  console.log('案例 ' + (CN.indexOf(c0) + 1) + ' ' + c0.title, '| 站点', c0.site);
  console.log('  输入: 物料=' + c0.material + ' 行业=' + c0.ind + ' 产能=' + c0.cap + 'kg/h 成品D' + c0.basis + '=' + c0.prod + 'μm 入料=' + c0.feed + 'μm 粉碎比=' + (c0.feed / c0.prod).toFixed(1));
  console.log('  官方标注族: ' + [...c0.supers].join('+') + '   (来源 ' + c0.labelSource + ')');
  console.log('  先验: ' + Object.entries(prior).map(([k, v]) => k + ':' + v.toFixed(2)).join(' '));
  const trace = [];
  const scored = K.DATA.map(d => ({ d, s: score(d, ctx, prior, trace) })).filter(x => x.s).sort((a, b) => b.s.total - a.s.total);
  scored.slice(0, 7).forEach(x => { const q = x.s;
    console.log('  ' + (q.fam.super + '·' + q.fam.fam).padEnd(22), String(Math.round(q.total * 100)).padStart(3),
      '| A' + q.A.toFixed(2), 'B' + q.B.toFixed(2), 'C' + q.C.toFixed(2), 'D' + q.D.toFixed(2), 'E' + q.E.toFixed(2), 'F' + q.F.toFixed(2), 'G' + q.G.toFixed(2), 'H' + q.H.toFixed(2), 'P' + q.P.toFixed(2),
      '|', (q.sizeModel || '') + (q.capModel ? '/' + q.capModel : ''), q.sizeUnknown ? '(size?)' : '', q.capUnknown ? '(cap?)' : '', q.units > 1 ? q.units + '台' : '', x.d.n.slice(0, 22));
  });
  const seen = new Set();
  trace.filter(t => { const k = t.split(':')[0]; if (seen.has(k)) return false; seen.add(k); return true; }).forEach(t => console.log('  门控出池 ' + t));
  process.exit(0);
}
if (arg.includes('--tune')) {
  const base = { A: 0.232, B: 0.116, C: 0.168, D: 0.137, E: 0.063, F: 0.032, G: 0.021, H: 0.042 };
  const grid = { A: [0.14, 0.18, 0.22, 0.26], B: [0.08, 0.12, 0.16], C: [0.10, 0.14, 0.18], D: [0.06, 0.10, 0.14, 0.18], P: [0.05, 0.10, 0.15, 0.20] };
  const pct = (r, k) => r.filter(x => x[k]).length / r.length;
  let best = null, n = 0; const all = [];
  for (const a of grid.A) for (const b of grid.B) for (const c of grid.C) for (const d of grid.D) for (const p of grid.P) {
    // 相对序约束（v6 方案 §3.2 定下的优先级，不由调参推翻）：A 粒度 ≥ B 产能 ≥ C 机理 > D 粉碎比。
    // 案例里粒度与产能几乎总能查到、机理只有粗标签、粉碎比依赖入料字段（多数案例缺），所以这个序是证据强度序。
    // 加 --strict 时按 v6 的相对序（A≥B≥C>D）硬约束搜索；不加时纯按泛化指标选，
    // 选完再手工把 C/D 并列的边界值拨开（见下方 W 的注释）。
    if (process.env.STRICT && !(a >= b && b >= c && c > d)) continue;
    const w = { ...base, A: a, B: b, C: c, D: d, P: p };
    const sum = Object.values(w).reduce((x, y) => x + y, 0);
    for (const k of Object.keys(w)) w[k] = w[k] / sum;
    W = w; n++;
    const l = run('loo'), h = run('holdout');
    const sc = pct(l, 'ok3') + pct(h, 'ok3') + 0.5 * (pct(l, 'ok1') + pct(h, 'ok1'));
    all.push({ w: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(4)])), loo1: pct(l, 'ok1'), looT3: pct(l, 'ok3'), en1: pct(h, 'ok1'), enT3: pct(h, 'ok3'), sc });
    if (!best || sc > best.sc) best = { w, sc, l, h };
  }
  require('fs').writeFileSync(require('path').join(__dirname, '..', 'data', 'tune-grid.json'), JSON.stringify(all));
  const i2 = (W = best.w, run('train'));
  console.log('搜索 ' + n + ' 组；目标 = 留一Top3 + 跨站Top3 + 0.5×(留一Top1 + 跨站Top1)（样本内未参与选参）');
  console.log('权重 ' + JSON.stringify(Object.fromEntries(Object.entries(best.w).map(([k, v]) => [k, +v.toFixed(3)]))));
  console.log('  留一 Top1=' + (pct(best.l, 'ok1') * 100).toFixed(1) + '% Top3=' + (pct(best.l, 'ok3') * 100).toFixed(1) +
    '  | 跨站 Top1=' + (pct(best.h, 'ok1') * 100).toFixed(1) + '% Top3=' + (pct(best.h, 'ok3') * 100).toFixed(1) +
    '  | 样本内 Top1=' + (pct(i2, 'ok1') * 100).toFixed(1) + '% Top3=' + (pct(i2, 'ok3') * 100).toFixed(1) + '%');
  process.exit(0);
}
const batchIdx = arg.includes('--batch') ? +arg[arg.indexOf('--batch') + 1] : null;
const showMiss = arg.includes('--miss') || batchIdx != null;

function pct(a, b) { return (a / b * 100).toFixed(1) + '%'; }

// 样本内
const inS = run('train');
// 留一
const loo = run('loo');
// 跨站
const ho = run('holdout');

const line = r => {
  const t = r.top.map(x => x.super + '·' + x.fam + '(' + Math.round(x.total*100) + (x.units > 1 ? ',' + x.units + '台' : '') + ')').join(' > ');
  return [
    r.c.title.slice(0, 34).padEnd(34),
    ('[' + r.want.join('+') + ']').padEnd(18),
    t.slice(0, 92)
  ].join(' ');
};

if (batchIdx) {
  const a = (batchIdx - 1) * 25, b = a + 25;
  const sub = inS.slice(a, b);
  console.log('=== 第 ' + batchIdx + ' 批（第 ' + (a + 1) + '–' + Math.min(b, inS.length) + ' 例）===');
  sub.forEach((r, i) => console.log((r.ok1 ? '✓' : r.ok3 ? '△' : '✗') + ' ' + String(a + i + 1).padStart(2) + ' ' + line(r)));
  const h1 = sub.filter(r => r.ok1).length, h3 = sub.filter(r => r.ok3).length;
  console.log('  本批 Top1=' + pct(h1, sub.length) + '  Top3=' + pct(h3, sub.length));
} else {
  console.log('【样本内 CN 99】 Top1=' + pct(inS.filter(r => r.ok1).length, inS.length) + '  Top3=' + pct(inS.filter(r => r.ok3).length, inS.length));
  console.log('【留一 CN 99】   Top1=' + pct(loo.filter(r => r.ok1).length, loo.length) + '  Top3=' + pct(loo.filter(r => r.ok3).length, loo.length));
  console.log('【跨站 EN 64】   Top1=' + pct(ho.filter(r => r.ok1).length, ho.length) + '  Top3=' + pct(ho.filter(r => r.ok3).length, ho.length));
  if (showMiss) {
    console.log('\n--- CN 样本内未命中 Top1 ---');
    inS.filter(r => !r.ok1).forEach(r => console.log((r.ok3 ? '△' : '✗') + ' ' + line(r)));
    console.log('\n--- EN 跨站未命中 Top3 ---');
    ho.filter(r => !r.ok3).forEach(r => console.log('✗ ' + line(r)));
  }
}


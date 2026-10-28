/**
 * audit-cat.js — 物料分类归属审计（只读，不改数据）
 *
 * 用途：核对「物料库 cat 列 → CAT_TO_VALUE → UI 类别 → 设备库 mat 关键词」这条链有没有断点，
 *       并对比同一物料在不同类别下的 Top3，量化分类标签对选型结果的影响。
 *
 * 用法：
 *   node tools/audit-cat.js                     # 映射链审计（有断点则 exit 1）
 *   node tools/audit-cat.js 乳糖 pharma food     # 追加：对比该物料在两类下的 Top3
 *   node tools/audit-cat.js 果胶 food other
 */
const fs = require('fs'), path = require('path');
const K = require('./kb.js'), F = require('./fit.js');
const H = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function cut(name, end) {
  const i = H.indexOf('const ' + name + ' ='), j = H.indexOf('const ' + end + ' =');
  return new Function(H.slice(i, j).replace('const ' + name, 'var ' + name) + ';return ' + name + ';')();
}
const MATS = cut('DATA_MATERIALS', 'CAT_DISPLAY');
const C2V = cut('CAT_TO_VALUE', 'CAT_ADJ');
// CATV 依赖 CAT_TO_VALUE，所以要连声明一起 eval，不能只截 CATV 本身
const cutAll = (from, to, ret) => {
  const i = H.indexOf('const ' + from + ' ='), j = H.indexOf('const ' + to + ' =');
  return new Function(H.slice(i, j) + ';return ' + ret + ';')();
};
const CATV = cutAll('CAT_TO_VALUE', 'SWITCH_TAG', 'CATV');
const ALIAS = cut('CAT_ALIAS', 'CAT_TO_VALUE');
const ADJ = cut('CAT_ADJ', 'CATV');

let broken = 0;

// ---------- 1. 映射链完整性（物料库 cat -> UI 类别） ----------
const dist = {};
MATS.forEach(m => { dist[m.cat] = (dist[m.cat] || 0) + 1; });
console.log(`物料库 ${MATS.length} 条，cat 去重 ${Object.keys(dist).length} 个`);
console.log('\n物料 cat'.padEnd(22) + '条数'.padStart(5) + '  ->  UI 类别');
console.log('-'.repeat(56));
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
  // 「逐字命中」和「归一化后命中」分开显示：后者说明映射表键名与实际标签不一致，能跑但属于待修的债
  const exact = Object.prototype.hasOwnProperty.call(C2V, c);
  const via = CATV(c);
  const norm = k => String(k).replace(/[\s\/\\、，,·・\-_]+/g, '');
  const fuzzy = !exact && Object.keys(C2V).some(k => norm(k) === norm(c));
  console.log((exact ? '  ' : fuzzy ? '~ ' : '✗ ') + c.padEnd(20) + String(n).padStart(5) + '  ->  ' + via
    + (exact ? '' : fuzzy ? '（靠 CATV 归一化兜底，建议直接改正键名）' : '（未映射 → other）'));
});
const hard = MATS.filter(m => !Object.prototype.hasOwnProperty.call(C2V, m.cat));
const unmapped = [...new Set(hard.map(m => m.cat))];
console.log(`\n逐字命中失败：${unmapped.length} 个 cat 标签 / ${hard.length} 条物料` + (unmapped.length ? '（' + unmapped.join('、') + '）' : ''));
const fallToOther = MATS.filter(m => CATV(m.cat) === 'other');
console.log(`落 other 类的物料：${fallToOther.length} 条（other 的 CAT_ALIAS 为空，这些物料的 F 项恒为 0.45，等于没有物料先验）`);
if (fallToOther.length) {
  const g = {};
  fallToOther.forEach(m => { g[m.cat] = (g[m.cat] || 0) + 1; });
  Object.entries(g).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('   - ' + c + ':' + n));
}
broken += unmapped.length;

// ---------- 2. 案例行业 -> 打分类别（离线与线上同一套 F） ----------
const cases = K.loadCases();
const inds = {};
cases.forEach(c => { inds[c.ind] = (inds[c.ind] || 0) + 1; });
const indMiss = Object.keys(inds).filter(i => K.MATCL(i) === 'other' && i !== 'other' && i !== '其他材料');
console.log(`\n案例行业标签 ${Object.keys(inds).length} 个，落 other 的 ${indMiss.reduce((s, i) => s + inds[i], 0)} 例`);
indMiss.forEach(i => console.log('   - ' + i + ' ×' + inds[i]));

// ---------- 3. 类别覆盖的设备数（F 项三档的分档依据） ----------
console.log('\n各类别：设备库关键词命中台数 / 邻类');
const hit = k => K.DATA.filter(d => (ALIAS[k] || []).some(a => a && (d.mat || '').includes(a))).length;
Object.keys(ALIAS).forEach(k => {
  console.log('   ' + k.padEnd(8) + String(hit(k)).padStart(3) + ' 台   邻类: ' + ((ADJ[k] || []).join(',') || '—'));
});

// ---------- 4. 单点对比：同一物料换类别后的 Top3 ----------
const [, , name, catA, catB] = process.argv;
if (name && catA && catB) {
  const TRAIN = cases.filter(c => c.site === 'CN');
  const PRIOR = K.buildPrior(TRAIN), FB = K.familyFallback(TRAIN), MARG = K.familyMarginals(TRAIN);
  const top = (cat) => {
    const q = { ind: '其他材料', material: name, prod: 45, cap: 500, feed: 0, supers: new Set() };
    const ctx = { cat, material: name, um: 45, cap: 500, feed: 0, ratio: null,
      tags: ['heat5', 'gmp'], prior: K.priorDist(PRIOR, q), fallback: FB, marg: MARG };
    return K.DATA.map(d => ({ d, s: F.score(d, ctx, ctx.prior) })).filter(x => x.s)
      .sort((a, b) => b.s.total - a.s.total).slice(0, 3)
      .map((x, i) => `${i + 1}. ${x.d.n} ${(x.s.total * 100).toFixed(1)}% (F=${x.s.F})`);
  };
  console.log(`\n单点对比：${name}  45µm / 500kg/h / tags=heat5+gmp`);
  [catA, catB].forEach(c => console.log('  [' + c + '] ' + top(c).join('  |  ')));
}

if (broken) { console.log(`\n✗ 有 ${broken} 个 cat 标签未映射，修 CAT_TO_VALUE 后重跑`); process.exit(1); }
console.log('\n√ 映射链无断点');

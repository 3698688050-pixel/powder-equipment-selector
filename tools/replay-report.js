/*
 * 回放报告：把 tools/fit.js 的逐例结果与 tools/match-case.js 的检索结果落成表，
 * 并给每一例打「未命中原因」标签，供 docs/案例库回灌-分批迭代报告.md 引用。
 *
 * 用法：node tools/replay-report.js           打印汇总 + 残差表
 *      node tools/replay-report.js --write   写 data/replay-cn99.tsv
 */
const fs = require('fs');
const path = require('path');
const K = require('./kb.js');
const F = require('./fit.js');
const M = require('./match-case.js');

const CN = F.CNcases;
const res = F.run('train');
const byId = new Map(res.map(r => [r.c.id, r]));

const rows = CN.map(c => {
  const r = byId.get(c.id) || { top: [], ok1: false, ok3: false };
  const top1 = r.top[0];
  const rankOf = (() => {                     // 标注族在排序里最好的名次
    for (let i = 0; i < r.top.length; i++) if (c.supers.has(r.top[i].super)) return i + 1;
    return 0;
  })();
  let cause = '';
  if (r.ok1) cause = '命中';
  else if (rankOf) cause = '排序：标注族已进 Top' + rankOf;
  else if (r.top.length === 0) cause = '门控：全部设备出池';
  else {
    const topDev = K.DATA.find(d => d.n === top1.n);
    const caps = K.parseDevCaps(topDev.cap), sizes = K.parseDevSizeRanges(topDev.size);
    if (c.feed && c.prod && c.feed / c.prod >= 3 && c.supers.has('分级')) cause = '规则冲突：标注分级但粉碎比≥3';
    else if (!caps.ranges.length && !caps.values.length) cause = '数据缺口：首选设备无产能数据';
    else if (!sizes.ranges.length) cause = '数据缺口：首选设备无粒度数据';
    else cause = '族边界：走的是另一条工艺路线';
  }
  // 近邻检索必须把案例自己从库里拿掉，否则最近邻恒为自己、命中率虚高成 99%
  const q = { site: c.site, material: c.material, cap: c.cap, prod: c.prod, basis: c.basis, ratio: c.feed ? c.feed / c.prod : null };
  const near = M.nearest(q, 1, M.rows.filter(x => x.title !== c.title))[0];
  const nearHit = near && [...near.c.supers].some(s => c.supers.has(s));
  return {
    id: c.id, title: c.title, label: [...c.supers].join('+'), famLabel: c.famLabel,
    material: c.material, cap: c.cap, prod: c.prod, basis: c.basis, ratio: c.feed ? +(c.feed / c.prod).toFixed(2) : 0,
    top1: top1 ? top1.super + '·' + top1.fam : '(空)', top1n: top1 ? Math.round(top1.total * 100) : 0,
    rankOfLabel: rankOf, ok1: r.ok1, ok3: r.ok3, cause,
    caseNeighbor: near ? near.c.title : '', caseNeighborHit: !!nearHit
  };
});

const pct = n => (n / rows.length * 100).toFixed(1) + '%';
const hits1 = rows.filter(r => r.ok1).length, hits3 = rows.filter(r => r.ok3).length;
const byCause = {};
for (const r of rows) { const k = r.ok1 ? '命中 Top1' : r.cause.split('：')[0]; byCause[k] = (byCause[k] || 0) + 1; }

console.log('中文案例 ' + rows.length + ' 例回放：Top1 ' + pct(hits1) + ' / Top3 ' + pct(hits3));
console.log('标注族进 Top3 但非 Top1：' + rows.filter(r => !r.ok1 && r.ok3).length + ' 例');
console.log('近邻检索（拿掉自己）同族：' + pct(rows.filter(r => r.caseNeighborHit).length));
console.log('');
console.log('未命中归因：');
Object.entries(byCause).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(28) + v + ' 例'));
console.log('');
console.log('--- 未进 Top3 的残差（' + rows.filter(r => !r.ok3).length + ' 例）---');
rows.filter(r => !r.ok3).forEach(r =>
  console.log('  ' + r.cause.padEnd(26) + '| ' + r.title.slice(0, 30).padEnd(32) + '| 标注 ' + r.label.padEnd(8) + '| 实得 ' + r.top1));

if (process.argv.includes('--write')) {
  const head = ['id', 'title', 'label', 'famLabel', 'material', 'cap_kg_h', 'prod_um', 'basis', 'ratio', 'top1', 'top1_score', 'label_rank', 'ok1', 'ok3', 'cause', 'case_neighbor', 'case_neighbor_hit'];
  const tsv = [head.join('\t')].concat(rows.map(r => head.map(h => r[h] === undefined ? '' : String(r[h]).replace(/\t/g, ' ')).join('\t'))).join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'replay-cn99.tsv'), tsv);
  console.log('\n已写 data/replay-cn99.tsv');
}

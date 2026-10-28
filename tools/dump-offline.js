/**
 * dump-offline.js — 把 CN 99 例逐例的离线 Top3 导出成 JSON，供页面侧逐例对齐。
 *
 * 用途：证明 index.html 里的 ENGINE 块和 node tools/fit.js 是同一份 score()。
 *   1) node tools/dump-offline.js                       → C:/tmp/offline.json
 *   2) ego-browser 里跑 round-11.mjs（页面内直接调 POWDER_ENGINE.rank 复算同一批案例）→ C:/tmp/parity.json
 *   3) 两份 JSON 的 tops 数组应逐例完全一致（当前 99/99）
 */

const fs = require('fs');
const K = require('./kb.js'), F = require('./fit.js');
const cases = K.loadCases();
const cn = cases.filter(c => c.site === 'CN');
const prior = K.buildPrior(cn), FB = K.familyFallback(cn), MARG = K.familyMarginals(cn);
const out = cn.map(c => {
  const ctx = F.ctxOf ? F.ctxOf(c) : null;
  ctx.prior = K.priorDist(prior, c); ctx.fallback = FB; ctx.marg = MARG;
  const list = K.DATA.map(d => ({ dev: d, s: F.score(d, ctx, ctx.prior) }))
    .filter(x => x.s).sort((a, b) => b.s.total - a.s.total);
  const f = x => K.devFamily(x.dev).super;
  return {
    title: c.title, ind: c.ind, basis: c.basis, prod: c.prod, feed: c.feed, cap: c.cap,
    top: list.slice(0, 3).map(f), tops: list.slice(0, 3).map(f),
    ok1: list[0] && c.supers.has(f(list[0])), ok3: list.slice(0, 3).some(x => c.supers.has(f(x)))
  };
});
const OUT = process.argv[2] || 'C:/tmp/offline.json';
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('dumped', out.length, 'top1', (out.filter(r => r.ok1).length / out.length * 100).toFixed(1), 'top3', (out.filter(r => r.ok3).length / out.length * 100).toFixed(1));

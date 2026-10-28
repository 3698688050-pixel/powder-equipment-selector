const K = require('./kb.js');
const F = require('./fit.js');
const cases = K.loadCases().filter(c => c.site === 'CN');
const idx = +process.argv[2] - 1;
const c = cases[idx];
const train = cases.filter(x => x.id !== c.id);
const prior = K.priorDist(K.buildPrior(train), c);
const fb = K.familyFallback(train);
console.log('案例', idx + 1, c.title);
console.log('  物料', c.material, '| 产能', c.cap, 'kg/h | 成品', c.prod, 'μm( D' + c.basis + ' ) | 入料', c.feed, '| 粉碎比', (c.feed / c.prod).toFixed(1));
console.log('  标注族', [...c.supers].join('+'));
console.log('  先验', Object.entries(prior).map(([k, v]) => k + ':' + v.toFixed(2)).join(' '));
const marg = K.familyMarginals(train);
const ctx = F.ctxOf(c); ctx.fallback = fb; ctx.marg = marg;
console.log('  族边缘 ratio(1.5-3):', K.SUPERS.map(s2=>s2+':'+(marg[s2]?K.marginal(marg,s2,'ratio',c.feed/c.prod).toFixed(2):'-')).join(' '));
const scored = K.DATA.map(d => ({ d, s: F.score(d, ctx, prior) })).filter(x => x.s).sort((a, b) => b.s.total - a.s.total);
scored.slice(0, 8).forEach(x => {
  const s = x.s;
  console.log(' ', (s.fam.super + '·' + s.fam.fam).padEnd(20), String(Math.round(s.total * 100)).padStart(3),
    '| A' + s.A.toFixed(2), 'B' + s.B.toFixed(2), 'C' + s.C.toFixed(2), 'D' + s.D.toFixed(2), 'E' + s.E.toFixed(2), 'F' + s.F.toFixed(2), 'G' + s.G.toFixed(2), 'H' + s.H.toFixed(2), 'P' + s.P.toFixed(2),
    '|', (s.sizeModel || '') + (s.capModel ? '/' + s.capModel : ''), s.sizeUnknown ? '(size?)' : '', s.capUnknown ? '(cap?)' : '', s.units > 1 ? s.units + '台' : '');
});

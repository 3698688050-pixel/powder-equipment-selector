const K = require('./kb.js');
const F = require('./fit.js');
const W0 = { ...F.W };
const rows = [];
for (const p of [0.05, 0.10, 0.189, 0.30, 0.45, 0.60, 0.75, 0.90]) {
  const rest = 1 - p;
  const base = { A: 0.232, B: 0.116, C: 0.168, D: 0.137, E: 0.063, F: 0.032, G: 0.021, H: 0.042 };
  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  const w = { P: p };
  for (const k of Object.keys(base)) w[k] = base[k] / sum * rest;
  F.setW(w);
  const i = F.run('train'), l = F.run('loo'), h = F.run('holdout');
  const f = r => [(r.filter(x => x.ok1).length / r.length * 100).toFixed(1), (r.filter(x => x.ok3).length / r.length * 100).toFixed(1)];
  rows.push([p, ...f(i), ...f(l), ...f(h)]);
}
console.log('P权重'.padEnd(8), '样本内T1  T3'.padEnd(14), '留一T1  T3'.padEnd(14), '跨站T1  T3');
rows.forEach(r => console.log(String(r[0]).padEnd(8), (r[1] + '%  ' + r[2] + '%').padEnd(16), (r[3] + '%  ' + r[4] + '%').padEnd(16), r[5] + '%  ' + r[6] + '%'));

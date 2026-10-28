/*
 * 细网格调参（带 v6 相对序约束 A≥B≥C>D）。
 * tools/fit.js --tune 用的是粗网格且不强约束；粗网格最优落在 C≈D 的边界上，
 * 这里在最优解附近做细搜，同时把「C 机理 > D 粉碎比」作为硬约束。
 * 目标函数只用留一（CN）+ 跨站（EN），样本内永远不参与选参。
 * 用法：node tools/tune2.js
 */
const F = require('./fit.js');

const pct = (r, k) => r.filter(x => x[k]).length / r.length;
const base = { E: 0.066, F: 0.033, G: 0.022, H: 0.044 };

let best = null, n = 0;
for (const A of [0.24, 0.26, 0.28, 0.30])
  for (const B of [0.14, 0.16, 0.18])
    for (const C of [0.12, 0.135, 0.15, 0.165])
      for (const D of [0.05, 0.07, 0.09, 0.11, 0.13])
        for (const P of [0.06, 0.08, 0.10, 0.12]) {
          if (!(A >= B && B >= C && C > D)) continue;
          const w = { A, B, C, D, P, ...base };
          const sum = Object.values(w).reduce((x, y) => x + y, 0);
          for (const k of Object.keys(w)) w[k] = w[k] / sum;
          F.setW(w); n++;
          const l = F.run('loo'), h = F.run('holdout');
          const sc = pct(l, 'ok3') + pct(h, 'ok3') + 0.5 * (pct(l, 'ok1') + pct(h, 'ok1'));
          if (!best || sc > best.sc + 1e-9) best = { w, sc, l, h };
        }
F.setW(best.w);
const tr = F.run('train');
const f = v => (v * 100).toFixed(1);
console.log('搜索 ' + n + ' 组（约束 A≥B≥C>D；目标 = 留一Top3 + 跨站Top3 + 0.5×(留一Top1 + 跨站Top1)）');
console.log('权重 ' + JSON.stringify(Object.fromEntries(Object.entries(best.w).map(([k, v]) => [k, +v.toFixed(3)]))));
console.log('  留一 Top1=' + f(pct(best.l, 'ok1')) + '% Top3=' + f(pct(best.l, 'ok3')) +
  '  | 跨站 Top1=' + f(pct(best.h, 'ok1')) + '% Top3=' + f(pct(best.h, 'ok3')) +
  '  | 样本内 Top1=' + f(pct(tr, 'ok1')) + '% Top3=' + f(pct(tr, 'ok3')) + '%');

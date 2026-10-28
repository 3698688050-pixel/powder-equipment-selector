const fs = require('fs');
const cls = {};
fs.readFileSync('id_cls.tsv', 'utf8').trim().split('\n').forEach(l => { const [k, v] = l.split('\t'); cls[k] = v || ''; });
const rows = fs.readFileSync('cn_table.tsv', 'utf8').trim().split('\n').slice(1).map(l => l.split('\t'));

const famOf = s => {
  const t = s || '';
  if (/三合一/.test(t)) return '三合一实验机';
  if (/球磨分级/.test(t)) return '球磨分级线';
  if (/蒸汽动能磨|蒸汽粉碎/.test(t)) return '蒸汽动能磨';
  if (/针盘磨/.test(t)) return '针盘磨';
  if (/锤式磨/.test(t)) return '锤式磨';
  if (/振动磨/.test(t)) return '振动磨';
  if (/涡流磨/.test(t)) return '涡流磨(改性/打散)';
  if (/转子磨/.test(t)) return '转子磨/蜂巢磨';
  if (/高速搅拌/.test(t)) return '高速搅拌改性机';
  if (/三辊磨/.test(t)) return '三辊磨';
  if (/圆盘式气流磨/.test(t)) return '圆盘式气流磨';
  if (/流化床/.test(t)) return '流化床气流磨';
  if (/气流粉碎/.test(t)) return '气流粉碎机(未细分)';
  if (/空气分级磨|机械粉碎/.test(t)) return '机械粉碎(空气分级磨)';
  if (/气流分级/.test(t)) return '气流分级机/线';
  return '未标注';
};
const numUm = s => { const m = String(s || '').match(/D\d+\s*[:：]\s*([\d.]+)/); if (m) return parseFloat(m[1]); const n = String(s || '').match(/([\d.]+)/); return n ? parseFloat(n[1]) : null; };
const feedUm = s => {
  const t = String(s || '').toLowerCase(); const n = t.match(/[\d.]+/g); if (!n) return null;
  const v = parseFloat(n[0]), h = n[1] ? parseFloat(n[1]) : v, mid = (v + h) / 2;
  if (/mm/.test(t)) return mid * 1000; if (/目|mesh/.test(t)) return 15400 / mid; return mid;
};
const capKgH = s => {
  const t = String(s || '').toLowerCase().replace(/\s/g, ''); const n = t.match(/[\d.]+/g); if (!n) return null;
  const v = parseFloat(n[0]), h = n[1] ? parseFloat(n[1]) : v, mid = (v + h) / 2;
  if (/年产/.test(t)) return mid * 1000 / 8000;
  if (/时产.*t|t\/h|-t/.test(t) || /时产[\d.]+t/.test(t)) return mid * 1000;
  return mid;
};
const data = rows.map(r => ({
  id: r[0].replace('.html', ''), title: r[1].split(' - ')[0], ind: (cls[r[0].replace('.html', '')] || '').split(' / ')[0] || '',
  fam: famOf((cls[r[0].replace('.html', '')] || '').split(' / ')[1] || r[1]),
  material: r[2], capTxt: r[3], cap: capKgH(r[3]), feedTxt: r[4], feed: feedUm(r[4]), prodTxt: r[5], prod: numUm(r[5]), site: r[6]
}));
fs.writeFileSync('final.tsv', ['id\ttitle\tindustry\tequip_family\tmaterial\tcapacity\tcap_kg_h\tfeed\tfeed_um\tproduct\tproduct_um\tsite',
  ...data.map(d => [d.id, d.title, d.ind, d.fam, d.material, d.capTxt, d.cap, d.feedTxt, d.feed, d.prodTxt, d.prod, d.site].join('\t'))].join('\n'));

const p = (a, q) => a.length ? +a[Math.min(a.length - 1, Math.floor(a.length * q))].toFixed(1) : '-';
console.log('n=' + data.length);
console.log('\n【A】设备族分布');
const fc = {}; data.forEach(d => fc[d.fam] = (fc[d.fam] || 0) + 1);
Object.entries(fc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(20), String(v).padStart(2), (v / data.length * 100).toFixed(0) + '%'));

console.log('\n【B】行业分布');
const ic = {}; data.forEach(d => ic[d.ind] = (ic[d.ind] || 0) + 1);
Object.entries(ic).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(18), v));

console.log('\n【C】成品粒度基准分布');
const bc = {}; data.forEach(d => { const b = (String(d.prodTxt).match(/D(\d+)/) || [, '未标注'])[1]; bc[b] = (bc[b] || 0) + 1; });
console.log(' ', bc);

console.log('\n【D】各族 成品粒度/产能 分位（μm, kg/h）');
const fams = Object.keys(fc).sort((a, b) => fc[b] - fc[a]);
famSort(fams).forEach(k => {
  const u = data.filter(d => d.fam === k && d.prod).map(d => d.prod).sort((a, b) => a - b);
  const c = data.filter(d => d.fam === k && d.cap).map(d => d.cap).sort((a, b) => a - b);
  console.log('  ' + k.padEnd(20), 'n=' + String(fc[k]).padStart(2),
    '| 粒度 p10/50/90 = ' + [p(u, .1), p(u, .5), p(u, .9)].join(' / ').padEnd(20),
    '| 产能 p10/50/90 = ' + [p(c, .1), p(c, .5), p(c, .9)].join(' / '));
});
function famSort(a) { return a; }

console.log('\n【E】粉碎比分布（入料/成品）');
const rec = data.filter(d => d.feed && d.prod).map(d => ({ ...d, r: d.feed / d.prod }));
const bk = [['<1.5 (只需分级/打散)', 0, 1.5], ['1.5-3 (轻粉碎/打散)', 1.5, 3], ['3-10 (常规粉碎)', 3, 10], ['10-50 (细粉碎)', 10, 50], ['>=50 (超细/多段)', 50, 1e9]];
bk.forEach(([n, a, b]) => console.log('  ' + n.padEnd(22), rec.filter(x => x.r >= a && x.r < b).length));
console.log('  最低 8 例:');
rec.sort((a, b) => a.r - b.r).slice(0, 8).forEach(x => console.log('    ' + x.r.toFixed(2).padStart(6), Math.round(x.feed) + 'μm→' + x.prodTxt.padEnd(12), x.fam.padEnd(18), x.material));

console.log('\n【F】同族内的粒度/产能跨度（说明"族"不是由粒度单一决定）');
[['气流磨类', /气流磨|气流粉碎/], ['机械粉碎', /空气分级磨/], ['分级机', /气流分级/], ['球磨线', /球磨/]].forEach(([n, re]) => {
  const s = data.filter(d => re.test(d.fam));
  const u = s.map(d => d.prod).filter(Boolean).sort((a, b) => a - b);
  const c = s.map(d => d.cap).filter(Boolean).sort((a, b) => a - b);
  console.log('  ' + n.padEnd(10), 'n=' + String(s.length).padStart(2), '粒度', Math.min(...u) + '~' + Math.max(...u) + 'μm', '产能', Math.min(...c) + '~' + Math.max(...c) + 'kg/h');
});

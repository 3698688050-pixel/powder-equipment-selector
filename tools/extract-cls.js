const fs = require('fs');
const lists = fs.readdirSync('.').filter(f => /^list_\d+\.html$/.test(f));
const map = {};
for (const f of lists) {
  const h = fs.readFileSync(f, 'utf8');
  const re = /href="\/projects\/(d_[a-z0-9]+)\.html"[\s\S]{0,4000}?rlist-tit">\s*([^<]+?)\s*<\/div>/g;
  let m;
  while ((m = re.exec(h))) {
    const id = m[1], cls = m[2].replace(/\s+/g, ' ').trim();
    if (!map[id] || (map[id].split(' / ').length < cls.split(' / ').length)) map[id] = cls;
  }
}
fs.writeFileSync('id_cls.tsv', Object.entries(map).map(([k, v]) => k + '\t' + v).join('\n'));
console.log('提取到案例分类', Object.keys(map).length);
const c = {};
Object.values(map).forEach(v => c[v] = (c[v] || 0) + 1);
Object.entries(c).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + v + '\t' + k));

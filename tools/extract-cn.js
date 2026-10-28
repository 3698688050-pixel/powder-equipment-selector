const fs = require('fs');
const path = 'proj/';
const files = fs.readdirSync(path).filter(f => f.endsWith('.html'));
const txt = s => s.replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<\/(p|div|li|h[1-6]|tr|td|br)>/g, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

const rows = [];
for (const f of files) {
  const h = fs.readFileSync(path + f, 'utf8');
  const title = ((h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/\s*-\s*[^-]*$/, '').trim();
  const t = txt(h);
  const g = (re) => { const m = t.match(re); return m ? m[1].replace(/\s+/g, '').trim() : ''; };
  const material = g(/物料[：:]\s*([^\n]{1,40})/) || g(/原料[：:]\s*([^\n]{1,30})/);
  const cap = g(/产[量能][：:]\s*([^\n]{1,30})/);
  const feed = g(/原料粒度[：:]\s*([^\n]{1,30})/) || g(/入料粒度[：:]\s*([^\n]{1,30})/);
  const prod = g(/(?:成品粒度|产品粒度|出料粒度)[：:]\s*([^\n]{1,40})/) || g(/(?:^|\n)\s*粒度[：:]\s*([^\n]{1,40})/);
  const site = g(/(?:项目地址|所在地|地点|地址)[：:]\s*([^\n]{1,30})/);
  const model = (t.match(/\b((?:MQL|MQW|MQP|MQPW|CSM-[A-Z]?|CUM-P|CUM-F|MZ|FL|FW|GX|RTM|ULM|IBM|TSM)[-A-Za-z0-9\/]{0,10})/g) || []).slice(0, 4).join('/');
  rows.push([f, title, material, cap, feed, prod, site, model].map(x => String(x).replace(/\t/g, ' ')).join('\t'));
}
fs.writeFileSync('cn_table.tsv', 'file\ttitle\tmaterial\tcapacity\tfeed\tproduct\tsite\tmodels\n' + rows.join('\n'));
console.log('rows', rows.length);
rows.slice(0, 8).forEach(r => console.log(r));
console.log('--- 空字段统计 ---');
const cols = ['material', 'capacity', 'feed', 'product', 'site'];
const data = rows.map(r => r.split('\t'));
cols.forEach((c, i) => {
  const n = data.filter(d => !d[i + 2]).length;
  console.log(c, '缺失', n + '/' + rows.length);
});

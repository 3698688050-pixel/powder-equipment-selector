/* 一次性数据补丁：给库里「粉尘爆炸风险无争议」的物料补 ex tag。
   只补金属粉末 / 煤与兰炭 / 硫磺 / 硝化棉 / 电石 / 木竹粉。
   淀粉、糖粉这类可燃但常规客户不认为会爆的，不预置——防爆提示误报一次，
   后面每条提示都不可信了。 */
const fs = require('fs');
const FILE = process.argv[2];
let h = fs.readFileSync(FILE, 'utf8');

const NAMES = ['硫磺', '硝化棉', '铝粉', '镁粉', '锌粉', '煤粉', '兰炭粉', '电石', '木粉', '竹粉'];
let n = 0;

for (const name of NAMES) {
  const re = new RegExp("\\{n:'" + name + "',([^\\n]*?)tags:\\[([^\\]]*)\\]\\}");
  const m = re.exec(h);
  if (!m) { console.log('✗ 找不到 ' + name); continue; }
  if (/ex/.test(m[2])) { console.log('  已含 ex: ' + name); continue; }
  h = h.replace(re, (s) => s.replace(/tags:\[([^\]]*)\]/, (t, inner) => "tags:[" + inner + ",'ex']"));
  n++;
}
fs.writeFileSync(FILE, h);
console.log('补了 ' + n + ' 条 ex tag');

const chk = fs.readFileSync(FILE, 'utf8');
for (const name of NAMES) {
  const m = new RegExp("\\{n:'" + name + "',[^\\n]*?tags:\\[([^\\]]*)\\]\\}").exec(chk);
  console.log('  ' + name.padEnd(5) + (m ? '[' + m[1] + ']' : '?? 未匹配'));
}

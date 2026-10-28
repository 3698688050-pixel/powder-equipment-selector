/*
 * 案例库回灌：把 data/cases-cn-99.tsv + data/cases-en-64.tsv 编译成 index.html 里的
 * DATA_CASES 常量（幂等：以 /* ==CASE_KB_START== *\/ … /* ==CASE_KB_END== *\/ 为界重写）。
 *
 * 用法：node tools/build-cases-embed.js          写入 index.html
 *      node tools/build-cases-embed.js --check  只报告差异，不写文件
 */
const fs = require('fs');
const path = require('path');
const K = require('./kb.js');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const START = '/* ==CASE_KB_START== */';
const END = '/* ==CASE_KB_END== */';

const cases = K.loadCases().sort((a, b) => (a.site === b.site ? 0 : a.site === 'CN' ? -1 : 1));
const rows = cases.map(c => [
  c.site === 'CN' ? 'C' : 'E',
  c.title,
  c.ind,
  c.material,
  c.cap || 0,
  c.feed || 0,
  c.prod || 0,
  c.basis,
  [...c.supers].join('+'),
  c.famLabel || ''
]);

const block = `${START}
// 案例库：ALPA 官网中文 99 例（含 6 例列表页无设备族标签、按标题弱标注）+ 英文站 64 例。
// 字段：[站点, 标题, 行业, 物料, 产能kg/h, 入料μm, 成品μm, 粒度基准, 设备族, 原始族标签]
// 由 tools/build-cases-embed.js 生成，请勿手改；案例增补后重跑该脚本即可。
const DATA_CASES=${JSON.stringify(rows)};
const CASE_WEAK_N=${cases.filter(c => c.labelSource === 'title-inferred').length};
${END}`;

let html = fs.readFileSync(HTML, 'utf8');
const i = html.indexOf(START), j = html.indexOf(END);
const check = process.argv.includes('--check');

if (i < 0 || j < 0) {
  console.error('index.html 里没有找到 CASE_KB 标记，先插入空标记块再运行：');
  console.error(START + '\n' + END);
  process.exit(1);
}
const old = html.slice(i, j + END.length);
// index.html 全文是 CRLF，脚本生成的 block 是 LF；直接比字符串会永远"需要更新"，
// 所以先归一化换行再比（写回时才统一成 CRLF）。
const lf = x => x.replace(/\r\n/g, '\n');
if (lf(old) === lf(block)) {
  console.log('已是目标状态（' + rows.length + ' 例），无需改动。');
  process.exit(0);
}
if (check) {
  const nOld = (lf(old).match(/\["[CE]",/g) || []).length;
  console.log('需要更新：当前 ' + nOld + ' 例 → 目标 ' + rows.length + ' 例');
  process.exit(1);
}

// 只替换标记块本身，其余 HTML 原样保留；写回统一 CRLF（index.html 全文是 CRLF）
const next = html.slice(0, i) + block + html.slice(j + END.length);
fs.writeFileSync(HTML, lf(next).replace(/\n/g, '\r\n'), 'utf8');
console.log('已写入 ' + rows.length + ' 例案例库');

/*
 * 案例时间回填：给 data/cases-cn-99.tsv / data/cases-en-64.tsv 补一列「时间」（YYYY-MM）。
 *
 * 时间口径：案例页在 ALPA 官网的上线月份。
 *  - 中文站：案例 id 是 MongoDB ObjectId（d_ + 24 位 hex），前 8 位是记录创建时间戳，
 *    直接解码成月份；页面正文和列表页都没有发布日期，这是唯一可核对的时间来源。
 *  - 英文站：没有 id、没有日期字段，但绝大多数是同一批项目的英文页。
 *    按「产能 + 入料粒度」在中文站里找对应案例，候选时间一致就继承；
 *    多个候选时间不同时取出现次数最多的月份；找不到候选就留空（页面显示「时间未标」）。
 *
 * 用法：node tools/backfill-case-dates.js          写入两个 TSV
 *      node tools/backfill-case-dates.js --check  只报告差异，不写文件
 */
const fs = require('fs');
const path = require('path');
const K = require('./kb.js');

const ROOT = path.join(__dirname, '..');
const CN = path.join(ROOT, 'data/cases-cn-99.tsv');
const EN = path.join(ROOT, 'data/cases-en-64.tsv');

const OID = /^d_([0-9a-f]{24})$/;
/* ObjectId 前 4 字节 = 秒级时间戳 → YYYY-MM */
function oidMonth(id) {
  const m = String(id || '').match(OID);
  if (!m) return '';
  return new Date(parseInt(m[1].slice(0, 8), 16) * 1000).toISOString().slice(0, 7);
}

/* 相对差 < 2% 视为同一个工况参数（页面上的 500kg/h、1mm 是同一档规格） */
const near = (a, b) => a > 0 && b > 0 && Math.abs(Math.log(a / b)) < 0.02;
const lg = v => Math.log(v > 0 ? v : 1);

function readTsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const head = lines[0].split('\t');
  const rows = lines.slice(1).map(l => l.split('\t'));
  return { head, rows, eol: fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n' };
}

const cn = readTsv(CN);
const ci = Object.fromEntries(cn.head.map((h, i) => [h, i]));
const cnCases = cn.rows.map(r => ({
  row: r,
  date: oidMonth(r[ci.id]),
  cap: +r[ci.cap_kg_h] || 0,
  feed: +r[ci.feed_um] || 0,
  prod: +r[ci.product_um] || 0
}));

function inheritDate(enCase) {
  let cands = cnCases.filter(c => near(enCase.cap, c.cap) && near(enCase.feed, c.feed));
  if (!cands.length) cands = cnCases.filter(c => near(enCase.cap, c.cap) && enCase.prod > 0 && c.prod > 0 && Math.abs(lg(enCase.prod / c.prod)) < 0.35);
  const months = cands.map(c => c.date).filter(Boolean);
  if (!months.length) return '';
  const freq = new Map();
  for (const m of months) freq.set(m, (freq.get(m) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

const en = readTsv(EN);
const ei = Object.fromEntries(en.head.map((h, i) => [h, i]));
/* 英文站 TSV 存的是原文（"20000t/y"、"100 mesh"、"D50:5-8μm"），与 kb.loadCases 用同一套解析 */
const enCases = en.rows.map(r => ({
  row: r,
  date: inheritDate({
    cap: +K.capToKgH(r[ei.capacity]) || 0,
    feed: +K.sizeToUm(r[ei.feed]) || 0,
    prod: +K.sizeToUm(r[ei.product]) || 0
  })
}));

function write(file, table, cases) {
  const head = table.head.includes('date') ? table.head : table.head.concat(['date']);
  const out = [head.join('\t')].concat(cases.map(c => {
    const r = c.row.slice(0, head.indexOf('date'));
    while (r.length < head.indexOf('date')) r.push('');
    r[head.indexOf('date')] = c.date;
    return r.join('\t');
  }));
  const text = out.join(table.eol) + table.eol;
  const old = fs.readFileSync(file, 'utf8');
  return { text, changed: text !== old };
}

const cnOut = write(CN, cn, cnCases);
const enOut = write(EN, en, enCases);
const missing = [...cnCases, ...enCases].filter(c => !c.date).length;
const report = {
  cn: cnCases.length, cnMissing: cnCases.filter(c => !c.date).length,
  en: enCases.length, enMissing: enCases.filter(c => !c.date).length
};

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(report));
  console.log(cnOut.changed || enOut.changed ? '需要更新' : '已是最新');
  process.exit(cnOut.changed || enOut.changed ? 1 : 0);
}
if (cnOut.changed) fs.writeFileSync(CN, cnOut.text);
if (enOut.changed) fs.writeFileSync(EN, enOut.text);
console.log('中文站 %d 例（时间缺失 %d），英文站 %d 例（时间缺失 %d，按同工况继承）',
  report.cn, report.cnMissing, report.en, report.enMissing);
console.log(cnOut.changed || enOut.changed ? '已写入 TSV' : '无变化');

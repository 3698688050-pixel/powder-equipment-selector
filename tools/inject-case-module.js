/*
 * 把 tools/case-module.js（案例检索层源码）注入 index.html 的
 * /* ==CASE_KB_END== *\/ … /* ==CASE_KB_LOGIC_END== *\/ 之间。幂等。
 * 用法：node tools/inject-case-module.js [--check]
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = path.join(ROOT, 'index.html');
const src = fs.readFileSync(path.join(__dirname, 'case-module.js'), 'utf8');
const START = '/* ==CASE_KB_END== */';
const END = '/* ==CASE_KB_LOGIC_END== */';
let s = fs.readFileSync(html, 'utf8');
const i = s.indexOf(START), j = s.indexOf(END);
if (i < 0 || j < 0) { console.error('缺少 CASE_KB 标记'); process.exit(1); }
const block = START + '\n\n' + src.trim() + '\n' + END;
const cur = s.slice(i, j + END.length);
if (cur === block) { console.log('案例检索层已是最新。'); process.exit(0); }
if (process.argv.includes('--check')) { console.log('需要更新案例检索层（' + cur.length + ' → ' + block.length + ' 字符）'); process.exit(0); }
s = s.slice(0, i) + block + s.slice(j + END.length);
fs.writeFileSync(html, s);
console.log('已更新 index.html 里的案例检索层（' + block.length + ' 字符）');

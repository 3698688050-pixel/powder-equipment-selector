/*
 * 把 tools/case-module.js（案例检索层源码）注入 index.html 的
 * CASE_KB_END … CASE_KB_LOGIC_END 之间。幂等，并且会顺手清掉历史上重复的 END 标记。
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
const i = s.indexOf(START);
if (i < 0) { console.error('缺少 ' + START + ' 标记'); process.exit(1); }

// 取「最后一个」END：之前脚本版本定位第一个 END，导致重复注入时尾部残留多个 END。
const j = s.lastIndexOf(END);
if (j < i) { console.error('缺少 ' + END + ' 标记'); process.exit(1); }

// index.html 是 CRLF，源码是 LF：比较/写入都按 LF 归一再用文件自身的换行风格输出，
// 否则每次 --check 都会因为行尾的 \r 误报「需要更新」。
const EOL = s.includes('\r\n') ? '\r\n' : '\n';
const norm = t => t.replace(/\r\n/g, '\n');
const block = (START + '\n\n' + norm(src).trim() + '\n' + END).replace(/\n/g, EOL);
const cur = s.slice(i, j + END.length);

if (norm(cur) === norm(block)) {
  console.log('案例检索层已是最新。');
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const dupNote = cur.split(END).length - 2 > 0 ? '（含 ' + (cur.split(END).length - 2) + ' 个重复 END 标记待清理）' : '';
  console.log('需要更新案例检索层（' + cur.length + ' → ' + block.length + ' 字符）' + dupNote);
  process.exit(0);
}
s = s.slice(0, i) + block + s.slice(j + END.length);
fs.writeFileSync(html, s);
console.log('已更新 index.html 里的案例检索层（' + block.length + ' 字符）');

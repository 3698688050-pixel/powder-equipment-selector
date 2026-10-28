// 回归测试：用最小 DOM 桩验证公司名称校验与拼接逻辑（跑的是 index.html 里的真实代码文本）
// 版本号从 index.html 的 <title> 里读，改版本不用改这个文件。
const fs = require('fs');
const H = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const VER = (H.match(/<title>粉体预选型 (v\d+)<\/title>/) || [])[1];
if (!VER) throw new Error('index.html <title> 里没找到版本号');
const a = H.indexOf('/* ============ 公司名称：导出前置必填校验 ============ */');
const b = H.indexOf('// 初始化颜色');
if (a < 0 || b < 0) throw new Error('切片失败');
const code = H.slice(a, b);

function makeEl(id) {
  const cls = new Set();
  return {
    id, value: '', textContent: '', hidden: false, attrs: {},
    classList: { toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); }, contains: c => cls.has(c), _s: cls },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this._l = this._l || {})[t] = f; },
    fire(t) { this._l && this._l[t] && this._l[t](); },
    focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
    _cls: cls
  };
}
const E = {};
['company', 'companyErr', 'companyTag', 'printCompany', 'printMeta', 'pdfBtn'].forEach(id => E[id] = makeEl(id));
E.printMeta.textContent = '乳糖，D97 45 µm，500 kg/h｜2026-01-01';
const bodyCls = new Set();
const body = { classList: { toggle: (c, on) => { on ? bodyCls.add(c) : bodyCls.delete(c); } } };
let printed = 0;
const winL = {};
global.window = {
  addEventListener: (t, f) => { winL[t] = f; },
  print: () => { printed++; },
};
global.document = {
  title: '粉体预选型 ' + VER,
  getElementById: id => E[id] || null,
  body,
};
global.$ = id => E[id] || null;
const outEl = { addEventListener: (t, f) => { (outEl._l = outEl._l || {})[t] = f; } };

const API = new Function('window', 'document', '$', 'outEl', code + '; return {exportPdf, companyName, setCompanyError};')(global.window, global.document, global.$, outEl);

const click = () => outEl._l.click({ target: { id: 'pdfBtn' } });
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  √ ' : '  ✗ ') + msg); if (!cond) fail++; };
const TAIL = VER + '后';

function show(label) {
  console.log(`  ${label} | 提示=${E.companyErr._cls.has('on') ? 'ON「' + E.companyErr.textContent + '」' : 'off'}`
    + ` | 标红=${E.company._cls.has('is-invalid')} | 标题=${JSON.stringify(document.title)}`
    + ` | ${TAIL}=${JSON.stringify(E.printCompany.textContent)} | 打印次数=${printed}`);
}

console.log('=== 验收 1：未填 → 阻断 ===');
click();
ok(printed === 0 && E.companyErr._cls.has('on') && E.company._cls.has('is-invalid'), '空字符串不弹打印、字段标红');
show('空字符串');

console.log('=== 验收 2：纯空格 → 阻断 ===');
for (const [v, label] of [['   ', '三个半角空格'], ['\u3000\u3000', '两个全角空格'], ['\t\n ', '制表符+换行']]) {
  printed = 0; E.company.value = v; click();
  ok(printed === 0, label + ' 被阻断');
  show(label);
}

console.log('=== 验收 3：填了 → 放行 + 拼接在 ' + VER + ' 之后 ===');
E.company.value = '  埃尔派粉体科技  '; E.company.fire('input');
show('去空格后有效');
printed = 0; click();
ok(printed === 1, '导出时调用一次 window.print()');
ok(E.printCompany.textContent === '｜埃尔派粉体科技', '页眉公司名紧跟版本号、分隔符为｜');
ok(document.title === '粉体预选型 ' + VER + '｜埃尔派粉体科技｜乳糖，D97 45 µm，500 kg/h｜2026-01-01', 'PDF 文件名也拼在公司名之后');
show('导出');
console.log('  标题(导出瞬时) =', JSON.stringify(document.title));

console.log('=== 验收 4：内部多空格压成一个 ===');
E.company.value = '山东  埃尔派'; E.company.fire('input');
ok(API.companyName() === '山东 埃尔派', 'companyName() 折叠内部空白');
console.log('  companyName() =', JSON.stringify(API.companyName()), '| 屏幕 ' + TAIL + ' =', JSON.stringify(E.companyTag.textContent));

console.log('=== 验收 5：Ctrl+P（beforeprint）未填 → 纸面阻断 ===');
E.company.value = '  '; E.company.fire('input');
winL.beforeprint();
ok(bodyCls.has('company-missing'), '绕过按钮直接打印也被拦');
console.log('  body.company-missing =', bodyCls.has('company-missing'), '| 提示=', E.companyErr._cls.has('on'));
E.company.value = '埃尔派'; winL.beforeprint();
ok(!bodyCls.has('company-missing') && E.printCompany.textContent === '｜埃尔派', '填了之后解除阻断');

console.log(fail ? `\n✗ ${fail} 项未通过` : '\n√ 全部通过');
process.exit(fail ? 1 : 0);

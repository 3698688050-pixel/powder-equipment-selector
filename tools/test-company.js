// 回归测试：用最小 DOM 桩验证「点导出 → 填公司名 → 才打印」的逻辑
//（跑的是 index.html 里的真实代码文本）
// 版本号从 index.html 的 <title> 里读，改版本不用改这个文件。
const fs = require('fs');
const H = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const VER = (H.match(/<title>粉体预选型 (v[\d.]+)<\/title>/) || [])[1];
if (!VER) throw new Error('index.html <title> 里没找到版本号');
const a = H.indexOf('/* ============ 公司名称：点了导出才问，填完再导出 ============ */');
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
    fire(t, ev) { this._l && this._l[t] && this._l[t](ev || {}); },
    focus() { this.focused = true; }, select() { this.selected = true; },
    scrollIntoView() { this.scrolled = true; },
    _cls: cls
  };
}
const E = {};
['company', 'companyErr', 'printCompany', 'printMeta', 'pdfBtn',
 'exportDialog', 'exportConfirm', 'exportCancel'].forEach(id => E[id] = makeEl(id));
E.printMeta.textContent = '乳糖，D97 45 µm，500 kg/h｜2026-01-01';
const bodyCls = new Set();
const body = { classList: { toggle: (c, on) => { on ? bodyCls.add(c) : bodyCls.delete(c); } } };
let printed = 0;
const winL = {};
global.window = {
  addEventListener: (t, f) => { winL[t] = f; },
  print: () => { printed++; },
};
const docL = {};
global.document = {
  title: '粉体预选型 ' + VER,
  getElementById: id => E[id] || null,
  body,
  addEventListener: (t, f) => { docL[t] = f; },
};
global.$ = id => E[id] || null;
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
const outEl = { addEventListener: (t, f) => { (outEl._l = outEl._l || {})[t] = f; } };

const API = new Function('window', 'document', '$', 'outEl', 'localStorage', code
  + '; return {exportPdf, companyName, setCompanyError};')(global.window, global.document, global.$, outEl, global.localStorage);

const click = () => outEl._l.click({ target: { id: 'pdfBtn' } });
const confirm = () => E.exportConfirm.fire('click');
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  √ ' : '  ✗ ') + msg); if (!cond) fail++; };

function show(label) {
  console.log(`  ${label} | 弹层=${E.exportDialog.hidden ? 'off' : 'ON'}`
    + ` | 提示=${E.companyErr._cls.has('on') ? 'ON「' + E.companyErr.textContent + '」' : 'off'}`
    + ` | 标红=${E.company._cls.has('is-invalid')} | 标题=${JSON.stringify(document.title)}`
    + ` | 页眉=${JSON.stringify(E.printCompany.textContent)} | 打印次数=${printed}`);
}

console.log('=== 验收 1：点导出 → 先开框，不打印 ===');
document.title = '粉体预选型 ' + VER;
E.company.value = '';
click();
ok(!E.exportDialog.hidden, '点「导出」先弹出填公司名的框');
ok(printed === 0, '此时还没有调用 window.print()');
ok(E.company.focused === true, '焦点落在输入框');
show('点导出');

console.log('=== 验收 2：空 / 纯空格 → 仍不打印 ===');
for (const [v, label] of [['', '空字符串'], ['   ', '三个半角空格'], ['\u3000\u3000', '两个全角空格'], ['\t\n ', '制表符+换行']]) {
  printed = 0; E.company.value = v; confirm();
  ok(printed === 0, label + ' 被阻断');
  show(label);
}
ok(E.exportDialog.hidden === false, '阻断后弹层保持打开，客户可以直接改');

console.log('=== 验收 3：填了 → 关框 + 打印一次 + 拼接在 ' + VER + ' 之后 ===');
printed = 0;
E.company.value = '  埃尔派粉体科技  '; E.company.fire('input');
confirm();
ok(printed === 1, '确认后调用一次 window.print()');
ok(E.exportDialog.hidden === true, '打印前弹层已关闭（不会印到纸上）');
ok(E.printCompany.textContent === '｜埃尔派粉体科技', '页眉公司名紧跟版本号、分隔符为｜');
ok(document.title === '粉体预选型 ' + VER + '｜埃尔派粉体科技｜乳糖，D97 45 µm，500 kg/h｜2026-01-01',
   'PDF 文件名也拼在公司名之后');
console.log('  标题(导出瞬时) =', JSON.stringify(document.title));
show('导出');

console.log('=== 验收 4：内部多空格压成一个 + 记住上次抬头 ===');
E.company.value = '山东  埃尔派'; E.company.fire('input');
ok(API.companyName() === '山东 埃尔派', 'companyName() 折叠内部空白');
ok(store.get('pes_company') === '埃尔派粉体科技', '上次导出的抬头已记住');
// 第二次打开：输入框清空后应从记忆里带出来
E.company.value = '';
click();
ok(E.company.value === '埃尔派粉体科技', '再次导出自动带出上次的抬头');
E.exportConfirm && E.exportCancel.fire('click');
ok(E.exportDialog.hidden === true, '「取消」关掉弹层');
click(); docL.keydown({ key: 'Escape' });
ok(E.exportDialog.hidden === true, 'Esc 关掉弹层');

console.log('=== 验收 5：Ctrl+P（beforeprint）不阻断，只补抬头 ===');
document.title = '粉体预选型 ' + VER;
E.company.value = '  ';
winL.beforeprint();
ok(!bodyCls.has('company-missing'), '直接 Ctrl+P 不阻断（页面没填公司也照印）');
ok(E.printCompany.textContent === '', '没填公司名时页眉只留版本号');
E.company.value = '埃尔派'; winL.beforeprint();
ok(E.printCompany.textContent === '｜埃尔派', '填了公司名就补到页眉');

console.log(fail ? `\n✗ ${fail} 项未通过` : '\n√ 全部通过');
process.exit(fail ? 1 : 0);

/**
 * build-engine-embed.js — 把 v7 打分引擎（tools/kb.js + tools/fit.js）打包进 index.html
 *
 * 目的：让线上页面和 tools/fit.js 的离线评估用**同一份** score()，避免「离线 61.6%，页面另一套公式」
 * 这种两套实现各自漂移的情况。打包方式是最小 CommonJS shim：kb.js / fit.js 源码原封不动塞进
 * 两个函数作用域，提供 require/process/module 三个桩；kb.js 用全局变量 _DOM 取页面已有的
 * DATA / DATA_MATERIALS / DATA_CASES，所以不读文件、不联网。
 *
 * 用法：
 *   node tools/build-engine-embed.js            重新生成并注入 index.html
 *   node tools/build-engine-embed.js --check    只校验（不写文件），用于 CI / 提交前自查
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const START = '/* ==ENGINE_START== */';
const END = '/* ==ENGINE_END== */';

const kbSrc = fs.readFileSync(path.join(__dirname, 'kb.js'), 'utf8');
const fitSrc = fs.readFileSync(path.join(__dirname, 'fit.js'), 'utf8');

// 注入代码里出现 `*/` 会提前截断注释块；源码里没有，但打包前还是显式挡一下
for (const [name, src] of [['kb.js', kbSrc], ['fit.js', fitSrc]]) {
  if (src.includes('</script')) throw new Error(name + ' 里出现 </script，会截断页面脚本');
}

function bundle() {
  return `${START}
// 由 tools/build-engine-embed.js 生成，请勿手改；改算法请改 tools/kb.js + tools/fit.js 后重跑。
// 浏览器环境里的 v7 打分引擎：与 node tools/fit.js 完全同一份 score()/prior/gate。
// 数据来自本页已有常量（DATA / DATA_MATERIALS / DATA_CASES），不读文件。
;(function(){
  'use strict';
  var process = { env: {} };            // fit.js 用 process.env.NOBAND / NOBIG 做对照开关，线上恒为关闭
  var _DOM = { DATA: DATA, DATA_MATERIALS: DATA_MATERIALS, CAT_ALIAS: CAT_ALIAS, CAT_ADJ: CAT_ADJ,
               SWITCH_TAG: SWITCH_TAG, TAG_SWITCH: TAG_SWITCH, DATA_CASES: DATA_CASES };
  var __mods = {}, __cache = {};
  function __req(name){
    if (name === 'fs') return { readFileSync: function(){ throw new Error('browser: no fs'); } };
    if (name === 'path') return { join: function(){ return Array.prototype.join.call(arguments, '/'); } };
    if (__cache[name]) return __cache[name].exports;
    var m = { exports: {} }; __cache[name] = m;
    __mods[name](m, m.exports, __req);
    return m.exports;
  }
  __mods['./kb.js'] = function(module, exports, require){
${kbSrc}
  };
  __mods['./fit.js'] = function(module, exports, require){
${fitSrc}
  };
  var K = __req('./kb.js'), F = __req('./fit.js');

  // UI 的物料类别 -> 案例行业（feats() 用行业算物料大类分格）
  var CAT2IND = {
    mineral: '非金属矿', hard: '非金属矿', battery: '电池材料', pharma: '医药',
    food: '食品/保健品/化妆品', chem: '颜料/染料', herb: '其他材料',
    metal: '粉末冶金', waste: '建材及固废', other: '其他材料'
  };
  // 先验只用中文站 99 例训练（与 tools/fit.js 的 train 同口径），跨站 EN 64 例留作验证，不参与线上先验。
  var TRAIN = K.loadCases().filter(function(c){ return c.site === 'CN'; });
  var PRIOR = K.buildPrior(TRAIN);
  var FB = K.familyFallback(TRAIN);
  var MARG = K.familyMarginals(TRAIN);

  /**
   * 把 UI 输入转成引擎上下文。
   * um 必须是 D97 当量（D50×2.5 / D90,D95×1.2 / D99,D100×0.9），和一个案例的 ctxOf() 口径一致。
   * feed 是入料粒度 μm（可选）：给了才算粉碎比，没给则该维度按中性处理、分级门控也不触发。
   * size 是用户填的**原始**成品粒度（没换算成 D97 当量）：粉碎比要用原值算，
   * 与 tools/fit.js 的 ctxOf()「ratio = feed / prod」口径保持一致，否则跨站对比会失真。
   */
  function makeCtx(o) {
    var feed = +o.feed > 0 ? +o.feed : 0;
    var raw = +o.size > 0 ? +o.size : o.um;
    var q = { ind: CAT2IND[o.cat] || '其他材料', material: o.material || '', prod: raw, cap: o.cap, feed: feed, supers: new Set() };
    return {
      cat: o.cat || '', material: o.material || '', um: o.um, cap: o.cap, feed: feed,
      ratio: feed > 0 ? feed / raw : null, tags: o.tags || [],
      prior: K.priorDist(PRIOR, q), fallback: FB, marg: MARG
    };
  }

  /** 排名：返回 [{dev, s}]，s 是 score() 的完整拆解（A/B/C/D/E/F/G/H/P）。 */
  function rank(o, limit) {
    var ctx = makeCtx(o);
    var list = K.DATA.map(function(d){ return { dev: d, s: F.score(d, ctx, ctx.prior) }; })
      .filter(function(x){ return x.s; })
      .sort(function(a, b){ return b.s.total - a.s.total; });
    return limit ? list.slice(0, limit) : list;
  }

  window.POWDER_ENGINE = { K: K, F: F, W: F.W, GATE: F.GATE, CAT2IND: CAT2IND, TRAIN: TRAIN, PRIOR: PRIOR, makeCtx: makeCtx, rank: rank };
})();
${END}`;
}

// index.html 全文是 CRLF，注入块也统一成 CRLF 写回，git diff 里就只出现新增行而不是整文件重写
function norm(s) { return s.replace(/\r\n/g, '\n'); }

const body = bundle();
const src = norm(fs.readFileSync(HTML, 'utf8'));

if (process.argv.includes('--check')) {
  const i = src.indexOf(START), j = src.lastIndexOf(END);
  if (i < 0 || j < 0) { console.error('× index.html 里找不到 ENGINE 标记'); process.exit(1); }
  const cur = src.slice(i, j + END.length);
  if (norm(cur) !== norm(body)) { console.error('× index.html 内的引擎块不是最新，请跑 node tools/build-engine-embed.js'); process.exit(1); }
  console.log('√ 引擎块已是最新（' + cur.split('\n').length + ' 行）');
  process.exit(0);
}

// 注入位置必须在 const DATA_CASES 之后：引擎是一个立即执行的 IIFE，一启动就要读页面常量，
// 放在案例库前面会踩 TDZ（const 绑定未初始化，ReferenceError → 整个 <script> 中止）。
const anchor = '/* ==CASE_KB_LOGIC_END== */';
// 自愈式处理：先摘掉历史残留的引擎块（lastIndexOf 顺带吃掉重复 END 标记），再整体插到锚点后面
let base = src;
const i = base.indexOf(START), j = base.lastIndexOf(END);
if (i >= 0 && j > i) base = base.slice(0, i) + base.slice(j + END.length);
const k = base.indexOf(anchor);
if (k < 0) throw new Error('找不到注入锚点：' + anchor);
const at = k + anchor.length;
const html = base.slice(0, at) + '\n\n' + body + base.slice(at);
// 标记块在 <script> 内，写回时统一 CRLF
fs.writeFileSync(HTML, norm(html).replace(/\n/g, '\r\n'), 'utf8');
console.log('√ 已注入引擎块（' + body.split('\n').length + ' 行，' + body.length + ' 字节）');

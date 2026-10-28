/* ============ 案例库检索（回灌层） ============
   案例来源：ALPA 官网中文站 99 例 + 英文站 64 例（docs/案例库回灌-分批迭代报告.md）。
   检索维度只有三个：物料、粒度、产量。工艺名称（气流磨 / 机械粉碎 等）不参与检索，
   也不在结果里展示——同一工况下工艺是结论，不是筛选项。
   时间：官网案例页上线月份（YYYY-MM），见 tools/backfill-case-dates.js。 */

const _CASE_ROWS = DATA_CASES.map(r => ({
  site: r[0], title: r[1], ind: r[2], material: r[3], cap: r[4], feed: r[5], prod: r[6],
  basis: r[7], supers: String(r[8]).split('+').filter(Boolean), famLabel: r[9],
  date: r[10] || ''
}));

/* 物料名 → 归一到没找到就返回 null，用来判断「是不是同一种料」 */
const _MAT_IDX = (() => {
  const idx = new Map();
  for (const m of DATA_MATERIALS) {
    idx.set(m.n, m);
    for (const a of (m.alias || [])) if (a) idx.set(a, m);
  }
  return idx;
})();
function matEntry(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  if (_MAT_IDX.has(t)) return _MAT_IDX.get(t);
  for (const [k, v] of _MAT_IDX) if (k.length >= 2 && (t.includes(k) || k.includes(t))) return v;
  return null;
}
function matTokens(txt) { return String(txt || '').split(/[、,，/;；·\s]+/).map(s => s.trim()).filter(s => s.length >= 2); }

/* 物料相似度：0 同一种料 / 0.4 同类别 / 1 无关 */
function matAffinity(inputName, caseMaterial) {
  const a = matEntry(inputName);
  const toks = matTokens(caseMaterial);
  for (const t of toks) {
    if (inputName && (t === inputName || t.includes(inputName) || inputName.includes(t))) return 0;
    const b = matEntry(t);
    if (a && b && a === b) return 0;
  }
  if (a) for (const t of toks) { const b = matEntry(t); if (b && b.cat === a.cat) return 0.4; }
  return 1;
}

const _lg = v => Math.log(v > 0 ? v : 1);
/* 案例成品粒度换算到 D97 当量（与 tools/fit.js ctxOf 同口径） */
const _d97 = (um, basis) => { const b = String(basis || '').replace(/^D/, ''); return um * (b === '50' ? 2.5 : b === '90' || b === '95' ? 1.2 : b === '99' || b === '100' ? 0.9 : 1); };
function _gap(a, b) { return (a > 0 && b > 0) ? Math.abs(_lg(a / b)) : 0; }

/* 返回与当前工况最接近的案例（分数越小越近）：物料 / 粒度 / 产量 三项加权距离 */
function matchCases(input, k, sameOnly) {
  const target = input.um * (input.basis === 'D50' ? 2.5 : input.basis === 'D90' ? 1.2 : input.basis === 'D95' ? 1.2 : input.basis === 'D99' ? 0.9 : input.basis === 'D100' ? 0.9 : 1);
  const rows = _CASE_ROWS.map(c => {
    const dMat = matAffinity(input.name, c.material);
    const dSize = _gap(target, _d97(c.prod, c.basis));
    const dCap = _gap(input.cap, c.cap);
    // 物料不一致的代价要大于「粒度 + 产量」两项惩罚之和的上限，
    // 否则会拿"粒度产量刚好相近的别家物料案例"当最近邻（磷酸铁锂 500kg/h 被判给锡粉案例就是这种情况）。
    const dist = dMat * 1.5 + Math.min(dSize * 0.9, 1.5) + Math.min(dCap * 0.35, 1.2);
    return { c, dist, dMat, dSize, dCap };
  });
  const pool = sameOnly ? rows.filter(r => r.dMat < 1) : rows;
  pool.sort((x, y) => x.dist - y.dist);
  return pool.slice(0, k || 5);
}

const _fmtCap = v => v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + ' t/h' : Math.round(v) + ' kg/h';
/* 案例成品粒度常带三位小数（29.129），展示统一收到 1 位，不制造虚假精度 */
const _fmtProd = v => { const n = +v; return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v); };
const _escape = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* 英文站标题尾部统一带 " - ALPA Powder Equipment"，展示时去掉；
   个别标题被抓成重复两遍（WeihaiSea cucumber…），也一并收干净。 */
const _caseTitle = t => {
  let s = String(t || '').replace(/\s*-\s*ALPA Powder Equipment\s*$/i, '').trim();
  const h = s.length / 2;
  if (Number.isInteger(h) && s.slice(0, h) === s.slice(h)) s = s.slice(0, h);
  return s;
};

/* 案例时间：官网正文只有站内上线批次（2020 年），没有逐条成交日期，
   所以只展示到年份——精确到月会造出不存在的精度。 */
const _caseDate = d => String(d || '').slice(0, 4);

/* 结果区下方的「参考成交案例」
   只出同一种料（或同料族）的案例：物料不一致的近邻只是在粒度、产量上凑巧接近，
   放进「参考」里就是误导。匹配不到同类时才退化成“最近邻 + 明说不同类”。 */
function caseSectionHtml(items, ctx) {
  const input = { name: ctx.name || '', um: ctx.sizeInfo.um, basis: ctx.sizeInfo.key, cap: ctx.cap };
  const same = matchCases(input, 5, true);
  const picks = same.length ? same : matchCases(input, 5);
  if (!picks.length) return '';

  const rows = picks.map(p => {
    const c = p.c;
    return `<div class="case-item">
        <div class="case-head">
          <span class="case-title">${_escape(_caseTitle(c.title))}</span>
          <span class="case-time">${_caseDate(c.date)}</span>
        </div>
        <div class="case-meta">${_escape(c.material)}，${_fmtCap(c.cap)}，成品 ${_fmtProd(c.prod)} μm（${_escape(c.basis)}）</div>
      </div>`;
  }).join('');

  const warn = same.length ? ''
    : `<div class="case-warn"><b>案例库里没有同类物料</b>下面几条只是粒度、产量接近的其它物料项目。</div>`;
  const meta = same.length ? `同料 ${same.length} 例` : '异料参考';

  return `<section class="case-section no-print">
    <div class="res-header">
      <h2>参考成交案例</h2>
      <span class="res-header-meta">${meta}</span>
    </div>
    <div class="card"><div class="card-body" style="padding-top:16px;">
      ${warn}
      <div class="case-list">${rows}</div>
    </div></div>
  </section>`;
}

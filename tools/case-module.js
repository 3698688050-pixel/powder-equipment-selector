/* ============ 案例库检索（回灌层） ============
   案例来源：ALPA 官网中文站 99 例 + 英文站 64 例（docs/案例库回灌-分批迭代报告.md）。
   作用：设备排序之外，再给出一组「真实成交工况」作为佐证/反证，避免只凭打分排序下结论。
   注意：检索是 1:1 最近邻，已知案例必然命中自身；它证明的是「案例能被找回」，
        不等于「设备排序全对」（排序指标见回放脚本，Top3≈78%，见报告 §4）。 */
const CASE_SUPER_NAME = { '气流磨': '气流磨', '机械磨': '机械粉碎', '分级': '分级机', '球磨线': '球磨线', '改性': '改性/打散', '实验室': '实验室机', '蒸汽': '蒸汽动能磨' };

/* 设备 → 设备族（与 tools/kb.js devFamily 同规则） */
function devSuperOf(d) {
  const n = d.n, c = d.c;
  if (c === '辅助设备') return '辅助';
  if (c === '改性机') return '改性';
  if (c === '实验室设备') return '实验室';
  if (c === '球磨分级生产线') return '球磨线';
  if (c === '分级机') return '分级';
  if (/蒸汽/.test(n)) return '蒸汽';
  if (/MQP01|MZL|MZW|MQL|MQW|MQPW|MQP/.test(n)) return '气流磨';
  if (/MZ|CUM|ULM|RTM|TSM|CSM/.test(n)) return '机械磨';
  if (c === '机械粉碎') return '机械磨';
  if (c === '气流粉碎') return '气流磨';
  return '其他';
}

const _CASE_ROWS = DATA_CASES.map(r => ({
  site: r[0], title: r[1], ind: r[2], material: r[3], cap: r[4], feed: r[5], prod: r[6],
  basis: r[7], supers: String(r[8]).split('+').filter(Boolean), famLabel: r[9],
  ratio: r[5] > 0 && r[6] > 0 ? r[5] / r[6] : null
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

/* 返回与当前工况最接近的案例（分数越小越近） */
function matchCases(input, k) {
  const target = input.um * (input.basis === 'D50' ? 2.5 : input.basis === 'D90' ? 1.2 : input.basis === 'D95' ? 1.2 : input.basis === 'D99' ? 0.9 : input.basis === 'D100' ? 0.9 : 1);
  const rows = _CASE_ROWS.map(c => {
    const dMat = matAffinity(input.name, c.material);
    const dSize = _gap(target, _d97(c.prod, c.basis));
    const dCap = _gap(input.cap, c.cap);
    const dRatio = (input.feed > 0 && c.ratio) ? _gap(input.feed / input.um, c.ratio) : 0;
    // 物料不一致的代价要大于「粒度+产能+粉碎比」三项惩罚之和的上限，
    // 否则会拿"粒度产能刚好相近的别家物料案例"当最近邻（磷酸铁锂 500kg/h 被判给锡粉案例就是这种情况）。
    const dist = dMat * 1.5 + Math.min(dSize * 0.9, 1.5) + Math.min(dCap * 0.35, 1.2) + Math.min(dRatio * 0.25, 1.0);
    return { c, dist, dMat, dSize, dCap };
  });
  rows.sort((x, y) => x.dist - y.dist);
  return rows.slice(0, k || 5);
}

const _fmtCap = v => v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + ' t/h' : Math.round(v) + ' kg/h';
/* 案例成品粒度常带三位小数（29.129），展示统一收到 1 位，不制造虚假精度 */
const _fmtProd = v => { const n = +v; return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v); };
const _escape = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* 结果区里的「参考案例 + 案例佐证」 */
function caseSectionHtml(items, ctx) {
  const input = { name: ctx.name || '', um: ctx.sizeInfo.um, basis: ctx.sizeInfo.key, feed: ctx.feedUm || 0, cap: ctx.cap };
  const picks = matchCases(input, 5);
  if (!picks.length) return '';

  // 案例佐证：近 20 例里，与该设备族一致的案例数。同族的多名候选合并成一条，
  // 否则 Top1/Top2/Top3 同族时会重复三遍一模一样的话。
  const near = matchCases(input, 20);
  const badge = [];
  items.forEach((it, i) => {
    const sup = devSuperOf(it.dev);
    const hit = near.filter(p => p.c.supers.includes(sup));
    const got = badge.find(b => b.sup === sup);
    if (got) got.ranks.push(i + 1);
    else badge.push({ sup, ranks: [i + 1], n: hit.length, eg: hit[0] && hit[0].c });
  });

  const rows = picks.map(p => {
    const c = p.c;
    const why = [];
    if (p.dMat === 0) why.push('同物料');
    else if (p.dMat < 0.5) why.push('同物料类别');
    if (p.dSize < 0.12) why.push('粒度相当');
    if (p.dCap < 0.25) why.push('产能相当');
    return `<div class="case-item">
        <div class="case-head">
          <span class="case-title">${_escape(c.title)}</span>
          <span class="case-src">${c.site === 'C' ? '中文站' : '英文站'}</span>
        </div>
        <div class="case-meta">${_escape(c.material)}，${_fmtCap(c.cap)}，成品 ${_fmtProd(c.prod)} μm（${_escape(c.basis)}）${c.ratio ? '，粉碎比 ' + (c.ratio >= 10 ? Math.round(c.ratio) : c.ratio.toFixed(1)) : ''}</div>
        <div class="case-tag">官方标注族 <b>${c.supers.map(s => CASE_SUPER_NAME[s] || s).join(' + ')}</b>${c.famLabel ? '（' + _escape(c.famLabel) + '）' : ''}${why.length ? '，' + why.join('、') : ''}</div>
      </div>`;
  }).join('');

  const badgeRows = badge.map(b => {
    const supName = CASE_SUPER_NAME[b.sup] || b.sup;
    const where = b.ranks.length === 1 ? `排序第 ${b.ranks[0]} 位` : `排序第 ${b.ranks.join('、')} 位`;
    const n = b.ranks.length;
    if (!b.n) return `<div class="ev-row none"><b>${supName}</b><span>${where}，近邻案例里没有这条路线，按上面的案例族复核</span></div>`;
    return `<div class="ev-row"><b>${supName}</b><span>${where}，近邻案例里有 ${n} 例${b.eg ? '，如 ' + _escape(b.eg.title) : ''}</span></div>`;
  }).join('');
  const badgeHtml = badge.length ? `<div class="ev"><div class="ev-head">案例佐证</div>${badgeRows}</div>` : '';

  // 案例库里找不到相近物料时，最近邻只是「粒度产能碰巧接近」，参考价值很低，必须说出来
  const noMat = picks.every(p => p.dMat >= 1);
  const warn = noMat ? `<div class="case-warn"><b>案例库里没有同类物料</b>下面 5 条只是粒度/产能恰好接近的其它物料项目，参考价值有限。</div>` : '';

  return `<div class="res-header">
      <h2>参考成交案例</h2>
      <span class="res-header-meta">案例库 ${DATA_CASES.length} 例，取最近 5 例</span>
    </div>
    <div class="card"><div class="card-body" style="padding-top:16px;">
      <p class="res-intro">按物料、粒度、产能、粉碎比加权距离检索，下面是案例库里离当前工况最近的 5 个真实项目。</p>${warn}
      <div class="case-list">${rows}</div>
      <div class="case-notes">
        ${badgeHtml}
        <p><b>怎么用</b>　案例族标注是 ALPA 官网自己的分类，属于成交参考，不是唯一最优解。排序走向若与近邻案例族差得远，先按案例族复核。</p>
        <p><b>口径</b>　这是按工况做的 1:1 最近邻检索，能保证已知案例都被找回，不等于设备排序全对；案例参数摘自官网公开页面，标「资料待确认」的部分需工程师复核。</p>
      </div>
    </div></div>`;
}

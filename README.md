# 粉体设备高级预选型

输入物料、产能、目标粒度和工艺属性，输出 Top3 设备方案；结果页可一键导出这 3 条为 PDF。
纯单页工具，无框架、无后端、无外部字体，断网也能用。

## 在线使用

**https://3698688050-pixel.github.io/powder-equipment-selector/**

打开即用，手机和桌面都适配。想让同事也能用，把这个网址发过去就行；需要离线留档时下载 `index.html` 双击打开。

## 怎么填

| 区块 | 填什么 | 说明 |
|---|---|---|
| 01 物料与产能 | 物料名称（可从 1433 条库选，也可手填）、产能 kg/h | 手填时按名称 / 别名 / 英文名 / CAS 号去库里匹配，匹配不到自动降级为通用先验 |
| 02 粒度标准 | 目标粒径 + 分布（D50/D90/D97/D99/D100）、单位（µm / 目）、入料粒度 | 入料粒度可不填，不填时粉碎比按中性处理 |
| 03 物理与工艺属性 | 13 项开关：莫氏硬度高、磨蚀性极强、含水率高、纤维 / 高韧性、粘性易糊壁、易起静电、流动性差、热敏 / 低熔点、易氧化、易挥发、易燃易爆、无金属污染、医药食品级 | 勾选会改变机型与防护配置；只有勾了「易燃易爆」才出现防爆强制提示 |

## 结果怎么读

每张结果卡三行：**推荐型号**、**可达粒度**、**推荐理由**。推荐理由把各分项压成一条可扫读的串：

```
最符合 · 粒度匹配 83%（型号） · 产能匹配 100% · 粉碎比 12（90%） · 分级精度 95%
```

其中粒度、产能是工况硬约束；粉碎比、分级精度由设备库参数和入料/出料粒度推算；机理、物料行业先验、工艺链来自知识库。

下面「参考成交案例」按**物料 / 粒度 / 产量**三个维度做最近邻检索，只列同料（或同料族）的案例，每条带时间。时间只到年份：官网只给了站内上线批次，没有逐条成交日期，精确到月等于编精度。

**导出 PDF**：结果区右上角「导出 PDF（前 3 名）」，只导出这 3 张推荐卡 + 一行免责声明，不含输入区与案例列表。

**注意边界**：

- 排序是启发式加权，不是实验结论。留一交叉验证 Top3 命中率约 78%（见 `docs/案例库回灌-分批迭代报告.md` §4）。
- 案例检索是最近邻，已知案例必然能命中自身，只能证明「可检索」，不等于「排序正确」。
- 案例时间统一是 2020 年那批官网内容的上线批次，不代表近期成交。
- 出现「磨蚀性极强」「防爆强制要求」提示时，那是全局约束，先按它筛掉不合适的机型再看排序。
- 最终选型请工程师复核。

## 本地运行

双击 `index.html` 即可，不需要 `npm install`、不需要起服务器。

## 数据与引擎

- 设备库 48 个系列，分 7 类：分级机 / 气流粉碎 / 机械粉碎 / 改性机 / 球磨分级生产线 / 实验室设备 / 辅助设备
- 物料库 1433 条，含密度、莫氏硬度、含水率、CAS、中英文名与别名
- 成交案例 163 例（ALPA 官网中文站 99 + 英文站 64）
- 打分引擎 v7：源码在 `tools/kb.js` + `tools/fit.js`，打包进 `index.html` 的 `==ENGINE_START== … ==ENGINE_END==` 块。页面和 `node tools/fit.js` 跑的是同一份 `score()`，不会出现「离线一套、页面另一套」。

## 目录

```
index.html                    单页应用（样式 + 数据 + 引擎 + 案例层，全部内联）
data/
  cases-cn-99.tsv             中文站案例（训练集）
  cases-en-64.tsv             英文站案例（跨站留出）
  replay-cn99.tsv             回放逐例结果
  tune-grid.json              调参网格
docs/
  案例库回灌-分批迭代报告.md   案例层设计与验收
  选型权重优化-v6方案.md       v5 → v6 权重推导
tools/
  kb.js / fit.js              打分核与回放（引擎源码）
  build-engine-embed.js       把引擎打包注入 index.html
  case-module.js              案例检索层源码
  inject-case-module.js       把案例层注入 index.html
  build-cases-embed.js        把 TSV 编译成 DATA_CASES
  match-case.js               离线找最近案例
  fit.js --tune / tune2.js    调参
  replay-report.js            回放报告
  extract-cn.js / extract-cls.js  案例抓取（一次性）
  dump-offline.js             导出离线 Top3 供逐例对齐
  replay-bench.js / frontier.js / dbg.js / analyze.js  辅助脚本
```

## 维护

改完源码后必须重新注入，`index.html` 里的三个标记区间禁止手改：

```bash
# 改打分逻辑：先改 tools/kb.js / tools/fit.js，再注入
node tools/build-engine-embed.js          # 写入
node tools/build-engine-embed.js --check  # 只校验（提交前自查）

# 改案例检索/展示：先改 tools/case-module.js，再注入
node tools/inject-case-module.js
node tools/inject-case-module.js --check

# 改案例数据：先改 data/*.tsv，再编译
node tools/build-cases-embed.js
```

回放验证排序质量：

```bash
node tools/fit.js          # 训练集 + 跨站留出
node tools/fit.js --tune   # 粗网格调参
```

## 部署

GitHub Pages，从 `3698688050-pixel/powder-equipment-selector` 的 `main` 分支根目录构建。
本地 `mine` remote 指向该仓库，`origin` 指向原作者仓库（无推送权限）。

```bash
git push mine HEAD:main
```

推送后 Pages 约需 1 分钟重新构建，用 `gh api repos/3698688050-pixel/powder-equipment-selector/pages --jq .status` 查 `built` 即生效。

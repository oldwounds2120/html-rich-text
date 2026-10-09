---
title: v1.0.3 发布说明
date: 2026-10-09
---

# v1.0.3 发布说明

> **发布于 2026-10-09**
> 升级方式：`ohpm i htmlrichtext@1.0.3`（或更新依赖中的版本号）
> 🌐 官方网站：<https://www.htmlrichtext.com/>（完整文档 / API 参考 / 历史版本）

v1.0.3 是**表格与样式渲染的一次集中重构**：修掉表格跨行跨列合并错乱的根本原因，
补齐 `background-color` 的全链路支持，并新增"宽表横向滚动 / 长表固定表头"两个能力。
另修复三处解析容错缺陷（其中含一处**内容丢失级**问题）。

> **无破坏性变更**：既有 API 与配置项全部向后兼容。三个新配置项的默认值均为
> "不改变现有观感"的档位（`tableMaxHeight` 默认 0 = 不限高）。

---

## ✨ 新增功能

### 表格区域独立横向滚动 `tableMinColumnWidth`

列多的表格过去会被压窄、长文本逐字换行。现在当 `列数 × tableMinColumnWidth`
超过表格可用宽度时，**表格区域单独横向滚动**，列宽不再被压缩，也不影响整页纵向滚动；

```ts
const config = new RichTextConfig();
config.tableMinColumnWidth = 80;   // 默认 80(vp)。0 = 关闭，列宽一律等分可用宽度
```

表格放得下时**不套 Scroll 容器**（实测可用宽度后再决定），避免无谓的嵌套层级。

### 长表格固定表头 `tableMaxHeight` + `tableStickyHeader`

```ts
config.tableMaxHeight = 400;      // 默认 0(vp) = 不限高，表格随页面一起滚动
config.tableStickyHeader = true;  // 默认 true
```

`tableMaxHeight > 0` 时表体在限高区域内**独立纵向滚动**，几十行的长表不再淹没页面；
此时表头行（连续的全 `<th>` 行）独立渲染在滚动区之外，**滚动时始终可见**。

---

## 🔧 问题修复

### 表格跨行 / 跨列合并错乱（根因）

**根因**：旧实现依赖 ArkUI Grid 的 `columnStart/columnEnd/rowStart/rowEnd` 绝对定位，
而 **Grid 只在 `rowsTemplate` 与 `columnsTemplate` 同时设置时才支持绝对定位**。
本项目表格行数不固定、只设 `columnsTemplate`，后果是：

1. `rowspan`（跨行）被**完全忽略**；
2. `colspan` 单元格若其目标列已被上一行的 `rowspan` 占住，GridItem 会**直接换到下一行**；
3. 旧实现把"数组下标"当"列号"，遇到含 `rowspan` 的行时列号整体偏移。

**修法**：把"布局计算"与"渲染"解耦。

- 新增 `core/TableLayout.ets`，用**稠密网格铺砖算法**算出每格的真实行列坐标
  （跳过上方 `rowspan` 占位、`colspan` 越界钳制、行尾补空位），输出 `TableSlot[]`；
- 渲染层改为**顺序填充**，跨行跨列用
  `GridLayoutOptions.onGetIrregularSizeByIndex` 表达 —— 该选项只需 `columnsTemplate` 即可工作；
- 表格列数统计同步修正：旧算法"每行 colspan 之和取最大值"会被 `rowspan` 堆叠出的
  占位**低估**，改用占位矩阵逐行推进统计，与浏览器行为一致。

### `background-color` 全链路失效

用户实测反馈"所有自定义背景色都没了"。根因是**架构缺字段 + 错误的样式继承**两层叠加：

- `computeStyle` 把 `background-color` 当可继承属性，块级底色顺着 DOM 树漏给每一个子 Span
  —— CSS 里 `background-color` 是**不可继承**属性，这本身就违反语义；
- `RenderBlock` / `TableCell` 没有承载背景的字段，块级底色最终无处安放。

修复后：

| 位置 | 落点 | 表现 |
| ---- | ---- | ---- |
| 段落 / 标题 / 列表项 | `RenderBlock.backgroundColor` | **整段铺满**（含右侧留白与内边距） |
| `<td>` / `<th>` | `TableCell.backgroundColor` | **优先于**表头底色与斑马纹 |
| `<pre>` / `<blockquote>` | `RenderBlock.backgroundColor` | 内联优先、config 兜底 |
| `<span>` / `<mark>` / `<code>` | `RichSpan.textBackgroundStyle` | 只覆盖文字 |

- **行内底色在真机上完全不显示**：ArkUI 的 `Span` 只是 Text 的子元素，不支持
  `backgroundColor`（继承自 `CommonMethod`，**能编译通过、运行时被静默忽略**）。
  改用 `textBackgroundStyle`（API 11+），一次性救活 `<mark>` 默认高亮、
  `<span style="background-color">` 与块级继承下来的底色。
- **行内 code / mark 嵌套一层行内标签后底色丢失**：`<code><strong>文字</strong></code>`
  的内层 `strong` 重算样式时把 code 的灰底一并丢掉（整句只剩玫红字、没有底色）。
  改为「**块级不继承、行内祖先 → 行内子元素继承**」。
- **容器包裹导致内部块级元素内联样式整体失效**（隐蔽、影响面大）：正文被
  `<div>` / `<article>` / `<section>` 包一层时，容器递归处理块级子标签没有重新叠加样式，
  子元素的 `font-size` / `color` / `background-color` / `margin` **全部失效**。
  后台模板常见的"内容容器"结构会直接中招。

### 解析容错

- **含连字符的自定义标签会吞掉后续全部内容**（内容丢失级）：标签名正则
  `^[a-zA-Z][a-zA-Z0-9]*` 遇到 `-` 即截断 → `<my-widget>` 被当成 `<my>` 打开，
  而闭合标签 `</my-widget>` 与栈中的 `my` 永远匹配不上，**标签不闭合、独占后续全部内容**。
  正则放宽为 `^[a-zA-Z][a-zA-Z0-9_.:-]*`，同时支持 Web Components 的 `<my-widget>`、
  命名空间标签 `<o:p>`、组件库风格的 `<el-table-column>`。
- **被协议白名单拦截的图片未丢弃**：行内图片组缺 `src` 为空时的守卫，
  会产生 `src=''` 的图片组，在真机上渲染为空占位框。

---

## ⚙️ 配置项变化

**新增 3 个 `RichTextConfig` 配置项：**

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `tableMinColumnWidth` | `80` | 列最小宽度(vp)。列数 × 该值 > 表格可用宽度时，表格区域独立横向滚动；`0` = 关闭 |
| `tableMaxHeight` | `0` | 表体最大高度(vp)。`> 0` 时表体在表格内独立纵向滚动；`0` = 不限高 |
| `tableStickyHeader` | `true` | 配合 `tableMaxHeight`，长表格滚动时固定表头 |

> 另有 3 处**语义调整**（更贴浏览器行为）：`<pre>` / `<blockquote>` 的背景改为
> **内联优先、config 兜底**（原为 config 永远覆盖）；`<td>` / `<th>` 的内联字号、
> 颜色开始生效（内边距仍统一走 `config.tableCellPadding`）。

---

## 📊 质量数据

- 逻辑层单元测试：**157 条断言全部通过**（新增背景色语义、表格矩阵布局、解析与图片容错三组）
- `verify-fixture` 场景校验：源 fixture **44 项**全过；真实接口快照
  （`from-api-180` / `from-api-178`）可直接作为回归样本喂入，分别 **14 / 9 项**全过
- 新增 `test/sync-core.py`：`core/*.ets ↔ test/*.ts` 同步与一致性校验工具
- 全部修复均由真实博客正文实测反馈驱动（表格合并错位、背景色消失、代码块底色丢失）

---

## 🧭 官网信息同步提醒

- 首页统计"逻辑层单测断言"由 **91 → 157**；
- 首页当前版本徽标 **1.0.2 → 1.0.3**；
- API / 配置页补 3 个表格新配置项（`tableMinColumnWidth` / `tableMaxHeight` /
  `tableStickyHeader`）；
- 表格能力描述可补一句："列多可横向滚动、长表可固定表头"；
- 本文件即官网发布稿，可直接贴入「更新日志」页。

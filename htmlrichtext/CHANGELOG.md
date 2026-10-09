# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.3] - 2026-10-09

### 新增
- **表格区域独立横向滚动**：新增 `config.tableMinColumnWidth`（默认 80）。当
  `列数 × 该值` 超过表格可用宽度时，表格区域**单独横向滚动**，不再挤压列宽，也不影响
  整页纵向滚动；表格本身放得下时不套 Scroll 容器（实测可用宽度后再决定，避免无谓嵌套）
- **长表格固定表头**：新增 `config.tableMaxHeight`（默认 0 = 不限高）与
  `config.tableStickyHeader`（默认 true）。`tableMaxHeight > 0` 时表格正文在限高区域内
  纵向滚动，表头行（连续的全 `<th>` 行）独立渲染、滚动时始终可见

### 修复
- **表格跨行/跨列合并错乱（根因）**：旧实现依赖 Grid 的 `columnStart/columnEnd/
  rowStart/rowEnd` 绝对定位，而 **ArkUI 只在 `rowsTemplate` 与 `columnsTemplate`
  同时设置时才支持绝对定位**。本项目表格只用 `columnsTemplate`（行数不固定），
  `rowSpan` 被完全忽略，`colspan` 单元格一旦落到已被占用的列就直接换行 —— 表现为
  "合并单元格错位、行错乱"。重构为：新增 `core/TableLayout.ets` 用"稠密网格铺砖"
  算法算出每格的真实行列坐标（含 rowspan 占位、行尾补空格），渲染层改为**顺序填充**
  并用 `GridLayoutOptions.onGetIrregularSizeByIndex` 表达跨行跨列（仅需
  `columnsTemplate`）
- **表格列数统计偏小**：旧实现按"每行 colspan 之和取最大值"统计列数，遇到跨行合并
  （rowspan 堆叠出的占位）会低估真实列数，导致列宽与对齐异常。改由
  `countTableCols` 用占位矩阵逐行推进统计，与浏览器行为一致
- **背景色全链路失效**（`background-color`）：解析层把 `background-color` 当成可继承属性，
  块级底色顺着 DOM 树漏给每一个子 Span，渲染成"文字底下一条条碎色块"；同时
  `RenderBlock` / `TableCell` 没有承载背景的字段，块级底色最终无处安放 —— 表现为
  页面上"所有自定义背景色都没了"
  - `RichTextBuilder` 不再继承 `background-color`（符合 CSS 语义），块级底色改由块自己持有
  - `RenderBlock` / `TableCell` 新增 `backgroundColor` 字段；`BlockBuilder` 外层 Column
    挂载背景，**整段铺满**（含每行右侧留白）
  - `<td>` / `<th>` 自身底色落到单元格上，**优先于**表头底色与斑马纹规则
  - `<pre>` / `<blockquote>` 背景改为**内联优先、config 兜底**（原为 config 永远覆盖）
  - 行内 `<span>` 底色仍只覆盖文字；`<mark>` 默认浅黄保留
  - 容器只有块级子元素时（`<div style="background">` 包着 `<p>`），底色下放给未自带底色的
    直接子块，保证底色可见
- **行内底色在真机完全不显示**：ArkUI 的 `Span` 只是 Text 的子元素，不支持 `backgroundColor`
  （从 `CommonMethod` 继承的方法会被静默忽略，编译通过但不渲染）。行内底色改用
  `textBackgroundStyle`（API 11+），一并救活 `<mark>` 高亮、`<span style="background-color">`
  与块级继承下来的底色
- **容器包裹导致内部块级元素的内联样式整体失效**（隐蔽且影响面大）：正文被
  `<div>` / `<article>` / `<section>` 包一层时，容器递归处理块级子标签没有重新叠加样式，
  子元素的 `font-size` / `color` / `background-color` / `margin` 会**全部失效**。
  后台模板常见的"内容容器"结构会直接中招；外层容器被剥掉时看不出问题
- **`<td>` / `<th>` 自身的内联样式不生效**：改为经 `computeStyle` 计算，单元格的背景色、
  字号、颜色均生效（内边距仍统一走 `config.tableCellPadding`，不读单元格自己的 padding）
- **含连字符的自定义标签会吞掉后续全部内容**（内容丢失级）：标签名正则
  `^[a-zA-Z][a-zA-Z0-9]*` 遇到 `-` 即截断，`<my-widget>` 被当成 `<my>` 打开，
  而闭合标签 `</my-widget>` 与栈中的 `my` 永远匹配不上 → 标签不闭合、独占后续全部内容。
  放宽为 `^[a-zA-Z][a-zA-Z0-9_.:-]*`（同时支持 Web Components 的 `<my-widget>`、
  命名空间标签 `<o:p>`、组件库风格的 `<el-table-column>` 等）
- **行内 code / mark 嵌套一层行内标签后底色丢失**：`computeStyle` 的继承基线为阻止
  "块级底色漏给每个 Span"而把 `background-color` 从继承中排除，该例外对**行内嵌套**
  也生效了 —— `<code><strong>文字</strong></code>` 的内层 `strong` 重算样式时把 code 的
  灰底一并丢掉，表现为整句只剩玫红字、没有底色。改为**块级不继承、行内祖先 → 行内子元素继承**
  （块级底色在 `flattenInline` / 表格单元格入口已被 `copyWithoutBackground` 剥离，不会漏出）
- **被协议白名单拦截的图片未丢弃**：行内 `makeImageGroup` 缺 `src` 为空时的守卫
  （块级 `pushImage` 有），会产出一个 `src=''` 的图片组，真机渲染为空占位框

### 测试
- `test/run.ts` 新增 `[17] 背景色语义`（含 17i/17j 行内嵌套继承，共 30 项断言）、
  `[18] 表格矩阵布局`（20 项断言，覆盖跨列定位、跨行合并、行尾补格、rowspan 堆叠列数、
  colspan 越界撑宽、表头行识别）与 `[19] 解析与图片容错`（16 项断言，覆盖连字符/命名空间标签、
  空 src 图片丢弃），合计 **157 项全绿**
- `test/sync-core.py`：新增 `core/*.ets → test/*.ts` 同步与一致性校验工具
  （`--check` 只校验），保证逻辑层副本不跑偏
- `docs/test/full-compat-blog.html` 新增「九·附：背景色专项」（CASE-14a~14f，七组用例），
  并更正了因本次修复而**反转**的旧期望（段落底色、单元格内联背景、pre/blockquote 背景、
  表格跨行跨列 9.3 / 宽表横向滚动 9.6）；附录用例扩至 85 行（新增 15a~15d）
- `docs/test/verify-fixture.ts` 增至 **44 项断言**，新增背景落点、"容器包裹"、
  「表格矩阵展开」专项校验（对 9.3 表逐格比对 HTML 语义）与「无空 src 图片组」通用不变量；
  同时把"源 fixture 专用断言"（payload 形态、样本字符/复位、CASE-14 组、宽表覆盖度）
  收进 `isSourceFixture` 分支 —— 真实接口快照（`from-api-180.html` / `from-api-178.html`）
  现在可直接喂入而不产生误报（分别 14 / 9 项全绿）

## [1.0.2] - 2026-08-08

### 新增
- **链接打开浏览器开关**：新增 `config.linkOpenBrowser`（**默认 true**）。未传
  `onLinkClick` 回调时，点击链接默认用系统浏览器打开；传了回调始终以回调为准
  （组件不跳转），便于使用方在回调里做自定义行为（弹窗/复制/站内跳转等）；
  置 false 可关闭默认跳转

### 修复
- **表格不渲染（严重）**：后端常见的 `<table><tbody><tr>…</tr></tbody></table>`
  结构以及 `<div class="entry-content">` 包裹正文时，表格整体不渲染、内容被压成纯文本。
  根因与修复：
  - `pushTable` 只收集 table 直接子 `tr`，`tbody` 容器被跳过 → 递归穿透
    `thead/tbody/tfoot` 等容器收集 `tr`；
  - 容器（div 等）内块级子标签原直接遍历子节点，导致 table/标题/代码块/列表/分割线
    落入兜底分支退化为普通文本或丢失 → 新增 `processBlock` 统一分发，容器与顶层共用；
  - `isBlockTag` 补充 `h1~h6`，div 内标题不再退化为正文；
  - 表格列数改为按 colspan 展开统计，支持跨列单元格的列模板
- **同一行内单元格不撑满行高**：某单元格换行变高时，同行的矮单元格背景铺不满整行、
  露出边框底色。`TableBlock` 改为委托独立组件 `TableBlockView`：通过 `onAreaChange`
  测量每行最高单元格高度，全部行测出后给 GridItem 与内层 Column 同时加
  `constraintSize({ minHeight })`，同一行矮单元格被撑满、背景铺满（保持只用
  `columnsTemplate`；`rowsTemplate` 固定行列模式实测只渲染第一行，勿用）
- **表格最后一行没有下边框**：Grid 底部补 1vp 同色横线（`rowsGap` 只产生行间缝隙）
- **新增 5 个表格样式配置项**：`tableHeaderTextColor` / `tableHeaderTextWeight` /
  `tableEvenRowBackground` / `tableOddRowBackground`（斑马纹）/ `tableMinRowHeight`
  （最小行高兜底，0 = 不设下限）
- **引用块高度异常**：左侧竖线改用 `Row` 边框实现。原 `Column().height('100%')` 在
  父容器自适应 + 外层 Scroll 无界高度约束下被解析成最大可用高度，把引用块撑到异常大
  （实测 669vp，与内容多少无关），现高度完全由内容驱动
- **引用块背景内空白**：内部首块 `marginTop`、末块 `marginBottom` 清零，段间距不再
  落在背景内部造成底部多余空白（中间块保留间距作段落分隔）
- **混排链接换行顶对齐错位**：文本 + `<br>` + 链接/图片混排时按"视觉行"拆分渲染
  （构建层按 `\n` 拆行并填充 `RenderBlock.groupLines`，组件层逐行独立 Flex），修复
  含换行文本组与单行链接/文本组在同一 Flex 顶对齐导致链接被顶到上一行的错位；
  链接内嵌 `<br>` 拆段后每段保留 `href` 仍可点击

## [1.0.1] - 2026-08-05

### 修复
- **图片渲染大图自适应**：段内大图（带 width/height）现在会按屏幕宽度自适应铺满，不再撑爆布局；
  小图标/表情保持原尺寸不放大（新增 `largeImageRatio` 配置项，默认 0.6）
- **图片预览手势**：新增双指捏合缩放（1~4 倍）、放大后单指拖动查看细节；
  修复拖动时画面"来回跑"（位移累计语义错误 + Swiper 手势冲突）
- **图片预览序号**：点击第 N 张图打开预览从第 N 张开始（不再停在首张）
- **安全加固**：链接/图片 URL 协议白名单，拦截 `javascript:` / `vbscript:` 伪协议
- **代码块**：内容不足屏幕宽度时保持左对齐（不再居中）
- **ForEach key 稳定性**：改用内容稳定 key，为后续增量渲染/懒加载扫清隐患
- 修复 `$images` / `$previewIndex` 未定义变量导致的预览闪退

## [1.0.0] - 2026-08-04

首个稳定版发布。

### 新增
- 手写递归下降 HTML 解析器（实体解码、属性解析、未闭合标签容错、script/style 内容跳过）
- ArkUI 原生渲染，不依赖 WebView 与系统 RichText 组件
- 支持标签：`h1-h6` / `p` / `strong` / `em` / `u` / `del` / `a` / `img` / `ul` / `ol` / `li`（嵌套）/ `blockquote` / `pre` / `code` / `table`（含 colspan/rowspan）/ `hr` 等
- 样式三层级联：父级继承 → 标签默认样式 → 内联 `style` 属性
- 图片：占位背景、加载失败回调、点击全屏预览（Swiper 滑动 + 双击缩放）
- 代码块：横向滚动 + 轻量语法高亮（注释/字符串/关键字/数字/函数）
- 集中式样式配置 `RichTextConfig`
- 逻辑层单元测试（53 条断言）
- ohpm 三方库标准结构（`oh-package.json5` + 包级入口 `Index.ets`）

### 修复
- ArkTS 编译器兼容性问题（struct 命名冲突、`this` 于静态方法、字符串下标、`LengthMetrics` 参数类型等）

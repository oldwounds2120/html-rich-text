# htmlrichtext 新功能开发方案（存档）

> 初稿：2026-08-06 ｜ **更新：2026-09-16（插入 Markdown 支持，重排发版序列，补版本号规则）**
> 状态：**方案冻结，暂缓实施** —— 当前优先完成 v1.0.3 的真机验证与发布
> 版本策略：均为向后兼容的新增能力，按 SemVer 走 **MINOR**；仅新增可选配置项不视为破坏性变更

## 0. 本次更新摘要（2026-09-16）

1. **新增功能 ⑤ Markdown 支持**，定为 1.1.0 的 headline 功能，**不进 v1.0.3**。
2. 厘清 Markdown 与「公开类型冻结」的先后关系 —— 结论：**耦合比预想的小**，
   但冻结声明里必须额外限定 `RichNode.attrs` 的语义（见 §2.6）。
3. 补 §5「版本号规则」，明确**发布之后发现问题时版本号怎么定**（含本项目 PATCH 携带新配置项的既有约定）。
4. 原 ① ② ③ ④ 四项顺延，阶段编号重排（Markdown 为阶段一）。
5. **入口设计由「禁止嗅探」修订为「三态开关，默认 html，auto 显式开启」**（见 §2.4）——
   初稿的"一刀切禁止"只覆盖了"后端可控"的场景，漏掉**遗留后端无法加 `content_type`** 的
   真实需求；但默认值仍必须是 `'html'`（存量使用者不传新参数，默认嗅探即为隐性 breaking）。
   `'auto'` 的判据经实测重写（§2.4.1 / §2.4.2）。
6. **入口签名定稿（2026-09-16 拍板）**：`contentType?: 'html' | 'markdown' | 'auto'`，默认 `'html'`，
   `'auto'` 需显式开启，三态与默认值一并随 **1.1.0** 落地（不拆版）。

## 1. 功能总览

| # | 功能 | 核心 API | 难度 | 阶段 | 发版 |
|---|---|---|---|---|---|
| ⑤ | **Markdown 支持** | `contentType: 'html' \| 'markdown' \| 'auto'`（默认 `'html'`）+ `markdownBreaks` | ★★★★ | 一 | **1.1.0** |
| ④ | 解析异常兜底 | `onParseError?: (error: ParseError) => void` | ★ | 一 | 1.1.0 |
| ② | AST 导出（读写双入口） | `onParseComplete` / `preprocessAst` / `RichNode.clone()` / `toJSON()` | ★ | 二 | 1.2.0 |
| ① | 解析缓存 | `ParseCache`（静态 LRU）+ `enableCache` / `cacheSize` | ★★ | 三 | 1.3.0 |
| ③ | 自定义节点渲染钩子 | `customNodeRender?: (node, position) => void` | ★★★★ | 四 | 1.4.0 |

> 变更说明：② 由"阶段一"后移到"阶段二"，与 ⑤ 拉开 —— ⑤ 与 ② 都会触碰 `RichNode`，
> 不宜同版交付（见 §4 依赖分析）。

---

## 2. Markdown 支持（新增）

### 2.1 为什么值得做

- 组件的输入面从「后台编辑器产出的 HTML」扩展到「AI 生成内容 / 手写笔记 / 技术文档」。
  LLM 输出的事实标准是 Markdown，而它现在必须由使用方自己转成 HTML 才能喂给组件。
- 与既有能力天然互补：渲染层（跨行跨列表格、代码高亮、引用块、图片预览）**全部可复用**，
  增量成本集中在解析层，性价比高。

### 2.2 架构：直接产出 RichNode，不走 HTML 中转

**唯一正确路径**（现有解析/渲染链已就位，接入点很干净）：

```
markdown 文本 ──MarkdownParser.parse()──┐
                                        ├─▶ RichNode（根 #root） ─▶ RichTextBuilder.build() ─▶ RenderBlock[] ─▶ ArkUI
html 文本 ────HtmlParser.parse()────────┘
```

- `HtmlParser.parse(html): RichNode`、`new RichTextBuilder(root, config, baseUrl).build(): RenderBlock[]`
  —— 上下游接口都已稳定，Markdown 只需**产出同构的 RichNode**，`RichTextBuilder` 及其之下**零改动**。
- ❌ **禁止** `Markdown → HTML 字符串 → HtmlParser` 的中转实现：等于序列化后再解析一遍，
  白跑一趟解析器，还多出一层「转义 / 属性引号 / 实体」的出错面。
- 同理不引第三方 markdown 库：ArkTS 生态无成熟实现，且第三方普遍产出 HTML 字符串或自有 AST，
  与"直接产 RichNode"的要求相悖。手写增量解析器（块级 + 行内两级），与 `HtmlParser` 既有风格一致。

### 2.3 语义映射表（关键：现有模型能承接多少）

| Markdown 语法 | 产出 RichNode | 现有渲染模型能否承接 |
|---|---|---|
| `# H1` ~ `###### H6` | `h1` ~ `h6` | ✅ `RenderBlock.headingLevel` |
| `**粗**` `_斜_` `~~删~~` | `strong` / `em` / `del` 行内节点 | ✅ 行内标签分发已支持 |
| `` `code` `` / 围栏代码块 | `code` / `pre > code` | ✅ `RenderBlock.codeLang`（语言写 `attrs['data-language']`） |
| `[text](url)` / `![alt](src)` | `a[href]` / `img[src,alt]` | ✅ |
| `> quote`（含嵌套） | `blockquote` | ✅ 支持嵌套块 |
| `-` `*` `+` / `1.` | `ul > li` / `ol > li` | ✅ |
| 有序列表非 1 起始（`3.`） | `ol[start=3]` | ✅ **`listMarker` 是字符串**，直接给 `3.` |
| `---` | `hr` | ✅ |
| `\| a \| b \|` + `:--:` 对齐 | `table > tr > td/th` | ✅ **`TableCell.align` 已存在** |
| 硬换行（行尾双空格 / `\`） | `br` | ✅ |
| 单换行是否成 `br` | 由 `config.markdownBreaks` 决定 | ✅ 解析层开关 |
| 引用式链接 `[a][1]` | 解析期展开为普通 `a` | ✅ 解析层消化，不下传 |
| `- [ ]` / `- [x]` 任务列表 | `li` + `attrs['checked']` | ⚠️ **唯一需要决策的点**，见 §2.6 |

**结论：`RichNode` 有开放的 `attrs: Map<string,string>` 属性袋，`RenderBlock` 已具备
`codeLang` / `listMarker` / `TableCell.align`，因此 Markdown 几乎不需要新增公开字段** ——
这与初稿的担心相反（详见 §2.6 对冻结声明的影响）。真正的成本在解析器的正确性，
不在数据模型。

### 2.4 入口设计：三态开关（默认 html，auto 需显式开启）

```ts
HtmlRichText({
  html: this.content,               // 参数名保持不变（避免破坏既有调用）
  contentType: 'auto',              // 'html'（默认）| 'markdown' | 'auto'
  config: this.config,
  // onLinkClick / onImageClick / onImageLoadError / baseUrl 全部照旧复用
})
```

- **复用同一个组件**，只切换"解析前置"。不新增独立组件（渲染层会被复制一遍，维护成本翻倍），
  也不新增 `markdown` 入参（与 `html` 互斥要额外校验、状态分支增多）。
- **`'auto'` 存在，但必须显式传。** 它覆盖的是真实存在的场景：**后端是遗留系统、
  接口无法加 `content_type` 字段**，业务方只能拿一个来路不明的字符串。这类使用者需要一条路。
- ⚠️ **但默认值必须是 `'html'`，不能是 `'auto'`。** 理由与场景无关，是版本纪律：
  本库已发布到 ohpm，存量使用者升级到 1.1.0 后**不会传新参数**。若默认嗅探，
  他们的既有 HTML 内容就有概率被误判 → 整篇渲染变样，纯属隐性 breaking（违反 §5 规则）。
  默认值要留给"零风险"的那一档。
- 嗅探**只做一次**并缓存结果（`html` / `contentType` 变化时重算），**绝不在 `build()` 内嗅探**
  —— 实测单次耗时近似线性：116K 字符 ≈ 9.3ms、928K 字符 ≈ 74.8ms（Python 参考值，
  量级可类比）。滚动重建路径上每次多花这个开销会累积成掉帧。
- 缓存键必须带上 `contentType`（1.3.0 的 `ParseCache` 要同步这条）。

#### 2.4.1 `'auto'` 的判据设计（保守优先）

**只使用在 HTML 文本里几乎不会出现的强信号判 markdown**：

| 判据 | 强度 | 说明 |
|---|---|---|
| 行首 `#{1,6}` + 空格 | 强 | HTML 正文文本节点里不出现 |
| 行首三反引号（围栏代码块） | 强 | 同上 |
| 行内 `[text](url)` / `![alt](src)` | 强 | HTML 里对应形态是 `<a href>` / `<img src>` |
| 表格分隔行 `\|:?-{3,}:?\|` | 强 | 表格语法的标志 |
| 行内同行配对的 `**x**`（限长、禁跨行回溯） | 中 | 只在同一行内配对，避免 `.*?` 的宽回溯 |

**冲突或不确定时回退 `'html'`**，因为误判代价不对称：

- 误判 **HTML → markdown**：整篇标签裸露（`<p>` `<div>` 变成可见文字）、样式体系全崩，**灾难性降级**；
- 误判 **markdown → HTML**：显示原始 `# ` `**` 字符，**难看但内容完整、样式正常**，可恢复。

#### 2.4.2 必须避开的判据（实测有害）

| 反例判据 | 实测后果 |
|---|---|
| `^\s*[-*+]\s` | **CSS 通配符选择器 `* { box-sizing: ... }` 命中** —— 对 `full-compat-blog.html` 实测被误判为 markdown |
| `^\s*\d+\.\s` | 中文文档里的编号说明行命中 —— 正文实测有 `1. 2. 3. 不跳号；start 被忽略` 这类句子 |
| `\*\*.*?\*\*` | `.*?` 跨行回溯，既慢又宽（性能实测明显劣于受限写法） |

> 依据：`docs/FEATURE_PLAN.md` 更新时对本仓库两份真实 HTML 实测 —— 用上述宽泛判据，
> `full-compat-blog.html` 被误判为 markdown；改用保守判据后两份**零误判**，
> 且对标题 / 链接 / 围栏代码块 / 表格样本**全部正确识别**。
> 代价：仅有行内 `**粗体**` 的 markdown 认不出（由"同行配对"判据覆盖）。

#### 2.4.3 可观测性：导出检测函数，不要回调

**不做 `onContentTypeResolved` 回调**（初稿曾提议，经复核撤回），改为导出纯逻辑函数：

```ts
// core/ContentDetector.ets（纯逻辑，无 ArkUI 依赖，可单测）
export function detectContentType(text: string): 'html' | 'markdown'
```

撤回回调的三条理由：

1. **目标用户错位**：会开 `'auto'` 的人正是**不掌控数据格式**的人，回调给他 `detected` 结果后
   无从处置；真正需要掌握格式的人会用显式 `contentType`，不经过嗅探。
2. **解决不了它声称的问题**：回调只能告知"判成了什么"，无法告知"判错了" —— 误判的发现依赖
   人眼看渲染结果或对照原始数据，回调给不了这类信息，实际只等于打印一行日志。
3. **是渲染路径上的钩子，易误用**：使用者若在回调里更新 `@State` → 触发额外重建 → 再次解析
   → 再次回调（有缓存则不止一次，判定不稳则反复）。给使用者一个"在渲染路径上写状态"的入口，
   风险大于收益。

**函数的优势**：调用时机由使用者决定；可先自行判定再显式传参覆盖；**可进 `test/run.ts` 建用例
矩阵**（保守判据的正确性正该用"误判样本 + 正判样本"两套用例锁住，回调做不到）；无时序副作用。
`contentType: 'auto'` 由此退化为**语法糖**（内部调同一函数），想要完全控制权的使用者走
"自己调 + 显式传参"这条路。

#### 2.4.4 一条结构性事实：嗅探只是"上手期能力"

后端加 `content_type` 字段始终是第一选择（业务方自己知道数据来源，最可靠）。
因此 `auto` 的价值在**降低接入门槛**：让"不知道接口返回什么格式"的人先跑起来，
长期使用者最终都会显式指定。**定位清楚了，就不该把它设为默认值。**

### 2.5 新增配置项

```ts
// RichTextConfig
markdownBreaks: boolean = false   // false = 传统 Markdown（单换行并入同段）；true = GFM 硬换行
```

`contentType?: 'html' | 'markdown' | 'auto'` 落在**组件参数**上（见 §2.4），Config 不重复声明。

`markdownBreaks` 是 Markdown 渲染**必须**暴露的分歧点：技术文档习惯 `false`，
聊天 / AI 场景习惯 `true`。默认 `false`（保守，与 CommonMark 一致）。

初版**不做**（留 backlog）：脚注、定义列表、Markdown 内嵌 HTML 块、自动链接扩展（`www.` 识别）。

### 2.6 与「公开类型冻结」的关系（重要修正）

**修正初稿判断**：原以为 Markdown 要往 `RichNode` 加一批字段、因此必须与冻结同版。
看了实际模型后 —— `RichNode.attrs` 是开放 Map、`RenderBlock.codeLang` / `listMarker` /
`TableCell.align` 均已存在 —— **Markdown 基本无需新增字段**，耦合远小于预估。

但仍有两个真实约束，**必须在冻结声明里写明**：

1. **`RichNode.attrs` 的 key 不属于稳定 API。** 它是开放属性袋，HTML 走 `href` / `src` /
   `data-language`，Markdown 走 `checked` / `start`。若冻结时把 `attrs` 的 key 一并承诺，
   后续任何新标签属性都会变成"破坏性变更"。**冻结范围 = 类型与字段名，不含 `attrs` 的 key 集合。**
2. **任务列表的"已完成"视觉**：初版把 `- [x]` / `- [ ]` 渲染成 `☑` / `☐` 作 marker
   （零改动，`listMarker` 是字符串就够了）。若要区分"已完成"的样式（置灰 + 删除线），
   `RenderBlock` 需加一个字段 —— **要么在冻结前一次性加上，要么明确放弃**。
   倾向：初版只做 marker，不加字段（组件是只读渲染，勾选交互本就无意义）。

### 2.7 风险

| 风险 | 级别 | 应对 |
|---|---|---|
| 手写解析器覆盖不全（CommonMark 边界多：嵌套列表、懒惰续行、行内嵌套） | 高 | 先划定支持的语法子集并写入文档；`test/run.ts` 以"语法 × 边界"建用例矩阵（参照表格矩阵的做法） |
| 与 HTML 模式的渲染一致性 | 中 | 同一份内容分别写 markdown / 等价 HTML，断言产出的 `RenderBlock[]` 语义等价 |
| 解析器体量（预计 600~900 行 + 单测） | 中 | 块级 / 行内两级拆分，行内解析器可独立单测 |
| `'auto'` 误判（使用者显式开启后仍可能判错） | 中 | 判据保守（只认强信号）+ 冲突回退 html；`detectContentType()` 为导出纯函数 → 业务可自行调用观察、可用 `test/run.ts` 的"误判样本 + 正判样本"用例矩阵锁住；文档写明"auto 仅作上手期兜底，后端能加字段就别用嗅探"（§2.4.3 / §2.4.4） |
| 使用者误以为 `html` 参数能自动吃 markdown | 低 | 文档首屏用反例说明；不做**默认**嗅探的理由一并写明（§2.4） |

---

## 3. 其余四项详细设计（原方案，保持）

### 3.1 ④ onParseError

```ts
onParseError?: (error: ParseError) => void
// ParseError { message: string; stage: 'parse' | 'build'; html: string; cause?: Error }
```

- `rebuild()` 整条 parse+build 包 try/catch：异常 → 回调 → 降级渲染（默认空态，可配 `fallback:'text'` 纯文本）→ 组件不闪退
- 附带修复：`decodeEntities` 中超范围码点（如 `&#x110000;`）触发 `String.fromCodePoint` 抛 `RangeError` 的隐患
- 与 Markdown 的关系：`stage` 同时覆盖 markdown 解析（`contentType='markdown'` 时共用同一条 catch 链）

### 3.2 ② AST 导出（读写双入口）

```ts
onParseComplete?: (ast: RichNode) => void   // 只读观察：分析/提取/统计/转换
preprocessAst?:   (ast: RichNode) => void   // 可写预处理：过滤/替换/插入，影响本次渲染
clone(): RichNode    // 深拷贝：业务在只读回调里要改树做自己的事时自取
toJSON(): object     // 序列化：埋点/调试
```

- 时序：`parse（或缓存命中）→ onParseComplete(ast) → preprocessAst(ast) → build → 渲染`
- 读型（图片列表/摘要/统计/敏感词扫描）→ `onParseComplete` 遍历即可，树不动
- 写型（过滤节点/替换文本/插入节点）→ `preprocessAst` 是**唯一可写窗口**
- 安全设计：缓存开启时组件内部先 clone 再交给 preprocessAst，防污染缓存树
- **类型冻结**：公开类型字段变更属破坏性更新（触发 MAJOR），1.x 冻结，README 写明承诺；
  **冻结范围不含 `RichNode.attrs` 的 key 集合**（见 §2.6）
- 缓存联动：命中时两个回调**依然照常触发**，缓存只省"解析"这一步
- 注：`Markdown → RichNode` 也在 `parse` 阶段，故 AST 导出天然对两种输入形态都生效

### 3.3 ① 解析缓存

```ts
// RichTextConfig 新增
enableCache: boolean = true
cacheSize: number = 32
// 新增 core/ParseCache.ets：模块级静态 LRU（Map 迭代顺序实现）
get(key): RichNode | undefined / put(key, root) / clear()
```

- **缓存键 = `contentType + ':' + 原文`**（1.1.0 引入 `contentType` 后必须带上，否则
  HTML 与 Markdown 会互相串键）
- 只缓存 `原文 → RichNode`（与 config/baseUrl 无关，永远安全）；跨组件实例共享；命中后 build 仍每次重跑
- 缓存树为共享引用 → 靠"preprocessAst 内 clone 保护 + onParseComplete 只读约定"双保险

### 3.4 ③ customNodeRender

```ts
customNodeRender?: (node: RichNode, position: 'block' | 'inline') => void  // 业务侧 @Builder 函数传入
```

- 抽取**已知标签全集 KNOWN_TAGS**（现有块级分发链 + `INLINE_TAGS` + void/skip 集中管理）
- 块级未知标签 → `RenderBlock{kind:'custom', customNode}` → `BlockBuilder` 调钩子
- 行内未知标签 → `InlineGroup{kind:'custom', customNode}` → `TextBlock` Flex 分支调钩子
- **未配钩子时保持现有降级逻辑（按文本渲染），行为零变化**，向后兼容
- 行内钩子建议渲染轻量内容（块级内容可能撑爆 Flex），文档注明
- ⚠️ `RenderBlock.kind` / `InlineGroup.kind` 是公开字符串字面量：新增 `'custom'` 是新枚举值
  而非改字段，不算破坏性变更，但需在文档中登记

---

## 4. 发版序列与依赖

| 发版 | 内容 | 依赖关系 |
|---|---|---|
| **1.1.0** | ⑤ Markdown（含 `contentType` **三态** `'html' \| 'markdown' \| 'auto'`）+ ④ onParseError | 两者都动"解析阶段"，同版可共用一条 catch 链与 `contentType` 分支；对外是"支持 Markdown 了"这一个叙事 |
| **1.2.0** | ② AST 导出 + **公开类型冻结** | Markdown 先落地，冻结时字段集已定型（`attrs` key 除外，见 §2.6）；`clone()/toJSON()` 要覆盖 Markdown 产出的树 |
| **1.3.0** | ① 解析缓存 | 缓存键含 `contentType`；冻结后的树做共享引用，风险隔离在独立版本 |
| **1.4.0** | ③ customNodeRender | 依赖 1.2.0 抽取的 `KNOWN_TAGS` |

**为什么不把 ⑤ 和 ② 同版**：两者都要触碰 `RichNode`。放在一起，一旦 AST 的字段设计被
Markdown 的实现细节倒逼着改，就会在"刚要冻结"的时候反复挪字段 —— 而冻结一次的成本
远高于分两次发版。Markdown 先落地 → 树结构被真实使用检验过 → 再冻结，这个顺序最稳。

**为什么 ⑤ 不能塞进 v1.0.3**：v1.0.3 已是约 1000 行改动（表格重构 + 背景色全链路 + 2 个新配置），
且有 3 项真机待验证（9.3 表合并、9.6 宽表横向滚动、附录长表固定表头）。
`onGetIrregularSizeByIndex` 在纵向滚动 Grid 上的表现逻辑层证明不了 —— 若同时引入 Markdown，
设备上一旦出问题无法归因。**且 Markdown 是定位级变更**（README 首行、官网、ohpm 包描述、
关键词全要改），塞进 PATCH 号会被 CHANGELOG 标题"表格修复"埋没，拿不到应有的发布叙事。

---

## 5. 版本号规则（发版之后发现问题，号怎么定）

### 5.1 判定表

| 这一批攒了什么 | 版本号 | 例子 |
|---|---|---|
| 只有 bug 修复，无新增公开 API / 配置项 | **PATCH +1** | 1.1.0 → 1.1.1 |
| 修复 + 新增公开 API 或配置项（可选、默认值不改变既有行为） | **MINOR +1**，PATCH 归零 | 1.1.1 → 1.2.0 |
| 改动既有 API 的语义 / 默认值 / 删字段 / 改公开类型字段 | **MAJOR +1**，其余归零 | 1.2.x → 2.0.0 |

### 5.2 附则

1. **已发布的版本号不可复用。** 1.1.0 发出后哪怕当天就能修完的 bug，也只能发 1.1.1；
   版本号一旦推到 ohpm 就不能覆盖重发。
2. **"归并"只影响发版频率，不影响号的定法。** 攒 10 个修复合并成一个版本，仍然是 **+PATCH**；
   攒批不等于升 MINOR。
3. **发布前发现的问题直接改进当前未发布的版本号**，不要另开新号。
   （例：v1.0.3 尚未 commit，此刻发现的表格问题就直接并入 1.0.3。）
4. ⚠️ **本项目的既有约定：新增可选配置项可能出现在 PATCH 版本中**
   （v1.0.2 的 `linkOpenBrowser`、v1.0.3 的 `tableMinColumnWidth` / `tableMaxHeight` /
   `tableStickyHeader` 都落在 PATCH）。这与严格 SemVer 有偏差 —— 好处是版本号简洁、
   与"功能域归并"习惯一致，代价是使用者按严格预期"PATCH 不含新 API"会措手不及。
   **建议在 README 增一节「版本约定」把这条写明**，把它从"隐性偏差"变成"公开承诺"。
5. **公开类型的字段变更一律 MAJOR**，不论多小 —— 1.2.0 冻结声明之后的直接推论。
   冻结范围不含 `RichNode.attrs` 的 key（见 §2.6）。
6. 维护分支（可选）：若在 1.1.0 之后仍需给锁死 `1.0.x` 的使用者补修复，
   可从 `v1.0.3` tag 拉分支发 `1.0.4`。注意 ohpm 上 `^1.0.0` 会解析到 1.1.0，
   维护分支只对版本锁死的使用者有意义。

---

## 6. 改动文件清单

| 文件 | 改动 |
|---|---|
| `htmlrichtext/src/main/ets/core/MarkdownParser.ets` | **新增**：块级 + 行内两级解析，产出 `RichNode` |
| `htmlrichtext/src/main/ets/core/ContentDetector.ets` | **新增**：`detectContentType()` 保守判据（`'auto'` 的实现，**导出**供业务自行调用/埋点/单测） |
| `htmlrichtext/src/main/ets/core/ParseCache.ets` | **新增**：静态 LRU 缓存 |
| `htmlrichtext/src/main/ets/core/RichTextConfig.ets` | +`markdownBreaks` / `enableCache` / `cacheSize` / `fallback` |
| `htmlrichtext/src/main/ets/core/RichTextModels.ets` | `ParseError`；`RichNode.clone()/toJSON()`；custom 块字段（若任务列表需区分样式） |
| `htmlrichtext/src/main/ets/core/RichTextBuilder.ets` | 抽取 `KNOWN_TAGS`；未知标签 → custom 块 / 行内 custom 组 |
| `htmlrichtext/src/main/ets/core/HtmlParser.ets` | 超范围码点防护 |
| `htmlrichtext/src/main/ets/components/HtmlRichText.ets` | `contentType` 分支 + 接入全部新 API + try/catch + 缓存 + preprocessAst clone 保护 |
| `htmlrichtext/src/main/ets/Index.ets` | 导出 `MarkdownParser` / `ParseCache` / `ParseError` / `detectContentType` / 新类型 |
| `test/` | 补：Markdown 语法矩阵、HTML/Markdown 等价性、LRU 淘汰、clone、错误捕获；`sync-core.py` 覆盖新文件 |
| `demo/` + `README.md` | Markdown 示例、customNodeRender 示例（真机验证 @Builder 传递）、新 API 文档、**版本约定**一节 |

## 7. 风险与注意

1. **@Builder 参数传递**（阶段四）：唯一有技术不确定性的点。ArkUI 对 `@Builder` 传参有限制
   （不能用匿名箭头函数、不能存 `@State`），**需 demo 真机验证**；备选 `@BuilderParam` / 内嵌组件
2. **缓存树共享引用**：preprocessAst 内 clone 保护 + onParseComplete 只读约定，双保险
3. **公开类型冻结**：1.2.0 起的承诺，README 声明；冻结范围不含 `attrs` 的 key
4. **KNOWN_TAGS 维护**：后续加标签支持需同步，建议加单测断言内置标签都在全集内
5. **Markdown 语法子集**：手写解析器不可能一次覆盖全部 CommonMark，**必须先把支持的语法
   写进 README 并明确"不在子集内的语法按纯文本渲染"**，避免使用者误判为 bug

## 8. 已确认 / 待拍板

**已确认（2026-08-06）**：
- ~~三阶段分开做，三次 MINOR 发版（1.1.0 → 1.2.0 → 1.3.0）~~ → 本次重排为四阶段（见 §4）
- AST 导出采用读写双入口（onParseComplete 只读 + preprocessAst 可写 + clone/toJSON）
- customNodeRender 块级 + 行内双覆盖，单钩子带 `position` 参数
- 解析缓存只缓存解析树（RichNode），静态跨实例 LRU

**已确认（2026-09-16）**：
- Markdown 独立成 MINOR，**不进 v1.0.3**
- 接入走 `contentType` 三态开关；**默认 `'html'`**（存量使用者零变化），`'auto'` 必须显式开启
- **参数签名定稿（2026-09-16 拍板）**：
  ```ts
  contentType?: 'html' | 'markdown' | 'auto'   // 默认 'html'，'auto' 需显式开启
  ```
  —— 命名、三态取值、默认值三项一并定稿，**`'auto'` 与 `'html' | 'markdown'` 同版落地于 1.1.0**
  （不做"先两态、auto 留后续"的分步）
- Markdown 解析器**直接产出 RichNode**，不走 HTML 字符串中转
- 发版序列重排为 1.1.0(Markdown+onParseError) → 1.2.0(AST 冻结) → 1.3.0(缓存) → 1.4.0(customNodeRender)
- `'auto'` 判据原则：**保守优先（只认强信号）、冲突或不确定回退 `'html'`**（§2.4.1）
- 可观测性用**导出检测函数**（`detectContentType()`），**不做 `onContentTypeResolved` 回调**（§2.4.3）

**实施前待拍板**：
- 检测器导出形态：`ContentDetector.detect()` 类静态方法，还是 `detectContentType()` 独立函数
- `markdownBreaks` 默认 `false`（对齐 CommonMark）还是 `true`（对齐 GFM / AI 输出习惯）
- 任务列表是否只做 `☑`/`☐` marker（不加字段），还是要在 `RenderBlock` 加"已完成"字段
- API 命名：`onParseComplete` vs 豆包建议的 `onAstReady`（倾向维持前者）
- `clone()` / `toJSON()` 是否与冻结同版（1.2.0）
- `onParseError` 降级策略细节：默认空态 + `fallback:'text'` 可配是否够用
- 是否在 README 增「版本约定」一节（§5.2 第 4 条）

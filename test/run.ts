/**
 * run.ts - 纯逻辑层单测（Node 22+，无需 ArkUI 环境）
 * 运行方式见 README：将 .ets 复制为 .ts 后执行
 *   node --experimental-transform-types run.ts
 */
import { HtmlParser } from './HtmlParser.ts';
import { RichTextBuilder } from './RichTextBuilder.ts';
import { RichTextConfig } from './RichTextConfig.ts';
import { SimpleCodeHighlighter } from './SimpleCodeHighlighter.ts';
import { NodeType, RenderBlock, InlineGroup, RichSpan, TableCell } from './RichTextModels.ts';
import { buildTableSlots, countTableCols, countHeaderRows } from './TableLayout.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function build(html: string): RenderBlock[] {
  const root = HtmlParser.parse(html);
  return new RichTextBuilder(root, new RichTextConfig(), '').build();
}

function textOf(blocks: RenderBlock[]): string {
  let out = '';
  const walk = (bs: RenderBlock[]): void => {
    for (const b of bs) {
      for (const g of b.groups) {
        for (const sp of g.spans) {
          out += sp.text;
        }
      }
      walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

console.log('\n[1] HtmlParser 基础解析');
{
  const root = HtmlParser.parse('<p>Hello <strong>World</strong></p>');
  assert(root.children.length === 1, '根节点有一个子节点');
  const p = root.children[0];
  assert(p.tag === 'p', '子节点为 p 标签');
  assert(p.children.length === 2, 'p 有两个子节点');
  assert(p.children[0].text === 'Hello ', '第一个子节点文本为 "Hello "');
  assert(p.children[1].tag === 'strong', '第二个子节点为 strong');
}

console.log('\n[2] 实体解码');
{
  const root = HtmlParser.parse('<p>a&amp;b &lt;c&gt; &#39;x&#39; &#x41; &nbsp;end</p>');
  const text = root.children[0].children[0].text;
  assert(text === 'a&b <c> \'x\' A \u00A0end', '实体正确解码: ' + JSON.stringify(text));
}

console.log('\n[3] 属性解析与自闭合');
{
  const root = HtmlParser.parse('<img src="a.png" width="200" /><br><img src=\'b.png\'>');
  const img1 = root.children[0];
  assert(img1.tag === 'img' && img1.attrs.get('src') === 'a.png', '双引号属性解析');
  assert(img1.attrs.get('width') === '200', 'width 属性解析');
  const br = root.children[1];
  assert(br.tag === 'br', 'br 自闭合');
  const img2 = root.children[2];
  assert(img2.attrs.get('src') === 'b.png', '单引号属性解析');
}

console.log('\n[4] 容错：未闭合标签');
{
  const root = HtmlParser.parse('<div><p>abc');
  const div = root.children[0];
  assert(div.tag === 'div', 'div 为根子节点');
  const p = div.children[0];
  assert(p.tag === 'p', '未闭合 p 自动补全为 div 子节点');
  assert(p.children[0].text === 'abc', 'p 内容正确');
}

console.log('\n[5] 注释与 script 跳过');
{
  const root = HtmlParser.parse('<p>a<!-- comment -->b<script>var x=1;</script>c</p>');
  const text = root.children[0].children[0].text;
  assert(text === 'abc', '注释和 script 内容被跳过: ' + JSON.stringify(text));
}

console.log('\n[6] 文本渲染模型（样式继承）');
{
  const blocks = build('<p>今天<strong>很<em>棒</em></strong>！</p>');
  assert(blocks.length === 1, '生成一个 text 块');
  const groups = blocks[0].groups;
  assert(groups.length === 1 && groups[0].kind === 'text', '文本连片合并为单个 group');
  const spans = groups[0].spans;
  assert(spans.length === 4, '四个 span（正文/加粗/加粗斜体/正文）: ' + String(spans.length));
  assert(spans[0].fontWeight === undefined && spans[1].fontWeight === 600, 'strong 加粗继承(600)');
  assert(spans[2].fontStyle === 1, 'em 斜体生效');
}

console.log('\n[7] 链接与图片分组');
{
  const blocks = build('<p>点击<a href="/doc/1">这里</a>查看<img src="x.png">图片</p>');
  const groups = blocks[0].groups;
  assert(groups.length === 5, '分组为 text/link/text/image/text 共 5 组');
  const link = groups.find((g: InlineGroup) => g.kind === 'link');
  assert(link !== undefined && link.href === '/doc/1', '链接分组携带 href');
  const img = groups.find((g: InlineGroup) => g.kind === 'image');
  assert(img !== undefined && img.src === 'x.png', '图片分组携带 src');
}

console.log('\n[8] 列表与嵌套');
{
  const blocks = build('<ul><li>甲<ul><li>乙1</li><li>乙2</li></ul></li><li>丙</li></ul>');
  const first = blocks[0];
  assert(first.kind === 'list-item' && first.listMarker === '•', '一级列表 marker 为圆点');
  assert(first.listLevel === 1, '一级层级=1');
  assert(first.children.length === 3, '嵌套列表生成子块（内容块 + 2 个二级项）: ' + String(first.children.length));
  const nested = first.children[1];
  assert(nested.kind === 'list-item' && nested.listMarker === '○', '二级列表 marker 为空心圆');
  const second = blocks[1];
  assert(second.kind === 'list-item' && second.listMarker === '•', '第二个一级项');
}

console.log('\n[9] 有序列表序号');
{
  const blocks = build('<ol><li>一</li><li>二</li><li>三</li></ol>');
  assert(blocks[0].listMarker === '1.', '第一项为 1.');
  assert(blocks[1].listMarker === '2.', '第二项为 2.');
  assert(blocks[2].listMarker === '3.', '第三项为 3.');
}

console.log('\n[10] 引用块与代码块');
{
  const blocks = build('<blockquote><p>引用文字</p></blockquote><pre><code>const a = 1; // 注释</code></pre>');
  assert(blocks[0].kind === 'quote', '引用块生成');
  assert(blocks[0].children[0].groups.length > 0, '引用块内部有文本');
  assert(blocks[1].kind === 'code', '代码块生成');
  const tokens: RichSpan[][] = blocks[1].codeLinesTokens;
  assert(tokens.length === 1, '代码块拆分为一行');
  const lineText = tokens[0].map((s: RichSpan) => s.text).join('');
  assert(lineText.includes('const'), '代码内容保留: ' + JSON.stringify(lineText));
  assert(tokens[0].some((s: RichSpan) => s.color === '#6A737D'), '注释被高亮为注释色');
}

console.log('\n[10b] 引用块：内部段间距压缩');
{
  // pushQuote 压缩内部子块边距：首块 marginTop、末块 marginBottom 清零，
  // 避免段间距落在引用背景内部造成多余空白；中间块保留间距作分隔
  const single = build('<blockquote><p>引用文字</p></blockquote>');
  assert(single[0].kind === 'quote', '引用块生成');
  assert(single[0].children.length === 1, '单段引用只有一个内部块');
  assert(single[0].children[0].marginTop === 0, '首块 marginTop 清零');
  assert(single[0].children[0].marginBottom === 0, '单段时末块 marginBottom 清零');
  assert(single[0].marginTop === 8 && single[0].marginBottom === 8, '引用块自身边距保留(quoteMarginTop/Bottom=8)');

  const multi = build('<blockquote><p>第一段</p><p>第二段</p><p>第三段</p></blockquote>');
  assert(multi[0].children.length === 3, '多段引用生成 3 个内部块');
  assert(multi[0].children[0].marginTop === 0, '多段时首块 marginTop 清零');
  assert(multi[0].children[0].marginBottom === 12, '中间块保留段间距(paragraphSpacing=12): ' + String(multi[0].children[0].marginBottom));
  assert(multi[0].children[1].marginBottom === 12, '中间块间保留分隔: ' + String(multi[0].children[1].marginBottom));
  assert(multi[0].children[2].marginBottom === 0, '末块 marginBottom 清零');
}

console.log('\n[11] 表格');
{
  const blocks = build('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  assert(blocks[0].kind === 'table', '表格生成');
  assert(blocks[0].tableRows.length === 2, '两行');
  assert(blocks[0].tableCols === 2, '两列');
  assert(blocks[0].tableRows[0][0].isHeader === true, '表头识别');
  const cellGroups: InlineGroup[] = blocks[0].tableRows[1][0].groups;
  assert(cellGroups.length > 0 && cellGroups[0].spans[0].text === '1', '单元格内容正确');
}

console.log('\n[11b] 表格：tbody/thead 容器包裹');
{
  // 后端常见结构：<table><tbody><tr>…</tr></tbody></table>，行被容器包裹，
  // 修复前 pushTable 只找 table 直接子 tr，tbody 被跳过导致整个表格不渲染
  const blocks = build('<table style="width:auto;"><tbody>' +
    '<tr><th>类型</th><th>含义</th></tr>' +
    '<tr><td><strong>feat</strong></td><td>新功能</td></tr>' +
    '</tbody></table>');
  assert(blocks.length === 1 && blocks[0].kind === 'table', 'tbody 包裹的表格正常生成（不丢失）');
  assert(blocks[0].tableRows.length === 2, '两行（穿透 tbody 收集）');
  assert(blocks[0].tableCols === 2, '两列');
  assert(blocks[0].tableRows[0][0].isHeader === true, 'th 表头识别');
  const sp: RichSpan = blocks[0].tableRows[1][0].groups[0].spans[0];
  assert(sp.text === 'feat' && sp.fontWeight === 600, '单元格内 strong 加粗保留');

  const blocks2 = build('<table><thead><tr><th>H</th></tr></thead><tfoot><tr><td>F</td></tr></tfoot></table>');
  assert(blocks2.length === 1 && blocks2[0].tableRows.length === 2, 'thead + tfoot 行均被收集');
}

console.log('\n[11c] 表格：colspan 展开列数');
{
  const blocks = build('<table><tr><td colspan="2">跨两列</td><td>c</td></tr><tr><td>a</td><td>b</td><td>d</td></tr></table>');
  assert(blocks[0].tableCols === 3, '按 colspan 展开统计列数（3 列）: ' + String(blocks[0].tableCols));
  assert(blocks[0].tableRows[0][0].colSpan === 2, 'colspan 属性保留');
}

console.log('\n[11d] 表格：div 容器包裹（常见正文结构）');
{
  // 后端正文常整体包在 <div class="entry-content"> 里，修复前 div 内的
  // table 经 processContainer 递归时 tbody/tr 落入兜底分支，被压成纯文本
  const blocks = build('<div class="entry-content"><p>前文</p><table><tbody>' +
    '<tr><th>类型</th><th>含义</th></tr><tr><td>feat</td><td>新功能</td></tr>' +
    '</tbody></table><p>后文</p></div>');
  const kinds = blocks.map((b: RenderBlock) => b.kind).join(',');
  assert(kinds === 'text,table,text', 'div 内表格生成独立表格块: ' + kinds);
  const tableBlock = blocks.find((b: RenderBlock) => b.kind === 'table');
  assert(tableBlock !== undefined && tableBlock.tableRows.length === 2, 'div 内表格行数正确');
  assert(tableBlock !== undefined && tableBlock.tableCols === 2, 'div 内表格列数正确');
}

console.log('\n[11e] 表格：div 容器内标题保持标题块');
{
  // isBlockTag 补充 h1~h6 后，div 内标题不再退化为正文
  const blocks = build('<div><h2>类型速查表</h2><p>正文</p></div>');
  assert(blocks[0].kind === 'heading' && blocks[0].headingLevel === 2, 'div 内 h2 生成标题块');
  assert(blocks[1].kind === 'text', 'div 内 p 生成文本块');
}

console.log('\n[12] 标题与内联样式');
{
  const blocks = build('<h1 style="color:#ff0000;">红标题</h1><p style="font-size:20px;text-align:center;">居中</p>');
  assert(blocks[0].kind === 'heading' && blocks[0].headingLevel === 1, 'h1 标题块');
  const h1Spans = blocks[0].groups[0].spans;
  assert(h1Spans[0].color === '#ff0000', '内联 color 生效');
  assert(blocks[0].fontSize === 24, 'h1 默认字号 24');
  assert(blocks[1].groups[0].spans[0].fontSize === 20, '内联 font-size 生效');
  assert(blocks[1].textAlign === 1, 'text-align:center 生效');
}

console.log('\n[13] 代码高亮器');
{
  const tokens = SimpleCodeHighlighter.highlight('const x = "str"; // note');
  const joined = tokens.map((s: RichSpan) => s.text).join('|');
  assert(tokens.some((s: RichSpan) => s.color === '#CF222E'), '关键字被高亮');
  assert(tokens.some((s: RichSpan) => s.color === '#22863A'), '字符串被高亮');
  assert(tokens.some((s: RichSpan) => s.color === '#6A737D'), '注释被高亮');
  assert(joined.includes('const'), '内容不丢失');
}

console.log('\n[13b] 链接打开浏览器开关默认值');
{
  const cfg = new RichTextConfig();
  assert(cfg.linkOpenBrowser === true, 'linkOpenBrowser 默认 true（默认用系统浏览器打开）');
}

console.log('\n[14] baseUrl 拼接');
{
  const root = HtmlParser.parse('<p><img src="img/a.png"></p>');
  const builder = new RichTextBuilder(root, new RichTextConfig(), 'https://cdn.x.com/static/');
  const blocks = builder.build();
  const g = blocks[0].groups.find((x: InlineGroup) => x.kind === 'image');
  assert(g !== undefined && g.src === 'https://cdn.x.com/static/img/a.png', '相对路径拼接正确');
}

console.log('\n[15] 复杂文档整体渲染');
{
  const html = '<h2>标题</h2><p>正文<strong>加粗</strong></p>' +
    '<blockquote><p>引用</p></blockquote>' +
    '<ul><li>列表1</li><li>列表2</li></ul>' +
    '<pre><code>fn main() {}</code></pre>' +
    '<table><tr><td>a</td><td>b</td></tr></table>';
  const blocks = build(html);
  assert(blocks.length === 7, '生成 7 个顶层块: ' + String(blocks.length));
  const kinds = blocks.map((b: RenderBlock) => b.kind).join(',');
  assert(kinds === 'heading,text,quote,list-item,list-item,code,table', '块类型顺序正确: ' + kinds);
}

console.log('\n[16] 混排链接换行拆分（视觉行 groupLines）');
{
  // 主问题场景：<br> 把文本组拆成两行，链接与后续文本应与第二行顶对齐
  const blocks = build('<p>安装Vagrant<br>官网：https://www.<a href="/v">vagrant</a>up.com/</p>');
  assert(blocks.length === 1 && blocks[0].kind === 'text', '生成一个文本块');
  const lines = blocks[0].groupLines;
  assert(lines.length === 2, '按 \\n 拆成 2 个视觉行: ' + String(lines.length));
  assert(lines[0].length === 1 && lines[0][0].kind === 'text'
    && lines[0][0].spans[0].text === '安装Vagrant', '行1 为文本组"安装Vagrant"');
  assert(lines[1].length === 3, '行2 含 3 个组（文本/链接/文本）: ' + String(lines[1].length));
  assert(lines[1][0].kind === 'text' && lines[1][0].spans[0].text === '官网：https://www.', '行2 组1 为文本');
  assert(lines[1][1].kind === 'link' && lines[1][1].href === '/v'
    && lines[1][1].spans[0].text === 'vagrant', '行2 组2 为链接且保留 href');
  assert(lines[1][2].kind === 'text' && lines[1][2].spans[0].text === 'up.com/', '行2 组3 为文本');
  assert(textOf(blocks) === '安装Vagrant\n官网：https://www.vagrantup.com/', '拆分后原始 groups 文本不丢失');
}

console.log('\n[16b] 视觉行拆分：纯文本/链接内嵌 br/空行');
{
  // 纯文本单组不拆分：单个 Text 原生支持 \n 与 textAlign
  const plain = build('<p>hello<br>world</p>');
  assert(plain[0].groupLines.length === 0, '纯文本单组不拆分（groupLines 为空）');

  // 链接内嵌 <br>：拆成两段都保留 href（每段仍可点击）
  const linkBr = build('<p>a<a href="/x">链<br>接</a>b</p>');
  const lbLines = linkBr[0].groupLines;
  assert(lbLines.length === 2, '链接内嵌 br 拆成 2 行: ' + String(lbLines.length));
  const link1 = lbLines[0].find((g: InlineGroup) => g.kind === 'link');
  const link2 = lbLines[1].find((g: InlineGroup) => g.kind === 'link');
  assert(link1 !== undefined && link1.href === '/x' && link1.spans[0].text === '链', '链接第一段保留 href');
  assert(link2 !== undefined && link2.href === '/x' && link2.spans[0].text === '接', '链接第二段保留 href');

  // 连续 <br> 空行：以空格文本组占位，行高不塌陷
  const emptyLine = build('<p>a<br><br><a href="/y">b</a></p>');
  const elLines = emptyLine[0].groupLines;
  assert(elLines.length === 3, '连续空行生成 3 行（含占位行）: ' + String(elLines.length));
  assert(elLines[1].length === 1 && elLines[1][0].spans[0].text === ' ', '空行以空格文本占位');
}

console.log('\n[17] 背景色语义（块级铺块 / 不可继承 / 行内只覆盖文字 / config 兜底）');
{
  const cfg = new RichTextConfig();

  // 17a 段落背景：整段由"块"持有，不再漏给段内每个 Span
  const p = build('<p style="background-color:#FFF3CD;">换行测试：<span style="color:#1E6FFF;">局部 span</span>，回到段落自己的颜色。</p>');
  assert(p.length === 1 && p[0].kind === 'text', '段落生成一个文本块');
  assert(p[0].backgroundColor === '#fff3cd', '段落背景落到块上（整段铺满）: ' + String(p[0].backgroundColor));
  const pSpans = p[0].groups[0].spans;
  assert(pSpans.every((sp: RichSpan) => sp.backgroundColor === undefined), '段内 Span 不再继承段落底色');
  const blue = pSpans.find((sp: RichSpan) => sp.color === '#1e6fff');
  assert(blue !== undefined && blue.backgroundColor === undefined, '段内 span 只保留自己的文字色');

  // 17b 行内元素自身的背景：留在 Span 上（只覆盖文字），且不污染同级文字
  const inline = build('<p><span style="background-color:#FFE58F;">行内底色</span>普通文字</p>');
  assert(inline[0].backgroundColor === undefined, '行内底色不会上升成块背景');
  assert(inline[0].groups[0].spans[0].backgroundColor === '#ffe58f', 'span 自身底色保留在 Span 上');
  assert(inline[0].groups[0].spans[1].backgroundColor === undefined, '同级普通文字不被 span 底色污染');

  // 17c mark 标签默认高亮（硬编码 #FFE58F）与内联覆盖
  const mark = build('<p>这是<mark>高亮</mark>文字</p>');
  const markSpan = mark[0].groups[0].spans.find((sp: RichSpan) => sp.backgroundColor !== undefined);
  assert(markSpan !== undefined && markSpan.backgroundColor === '#FFE58F', 'mark 默认高亮保留在 Span 上');
  const mark2 = build('<p><mark style="background-color:#D0EBFF;">蓝底</mark></p>');
  assert(mark2[0].groups[0].spans[0].backgroundColor === '#d0ebff', 'mark 内联背景覆盖默认色');

  // 17d 段落之间互不污染
  const two = build('<p style="background-color:#FFF3CD;">有底色</p><p>没底色</p>');
  assert(two[0].backgroundColor === '#fff3cd' && two[1].backgroundColor === undefined,
    '块级底色不影响相邻块（不继承）');

  // 17e 单元格背景：td/th 自身底色落到 TableCell，且不再漏进单元格内 Span
  const table = build('<table><tr><th style="background-color:#F5F6F7;">H</th><td style="background-color:#FFE58F;">A</td></tr><tr><td>B</td></tr></table>');
  assert(table[0].kind === 'table', '表格生成');
  assert(table[0].tableRows[0][0].backgroundColor === '#f5f6f7', '表头单元格背景落到 TableCell');
  assert(table[0].tableRows[0][1].backgroundColor === '#ffe58f', '数据单元格背景落到 TableCell');
  assert(table[0].tableRows[1][0].backgroundColor === undefined, '未设背景的单元格保持 undefined（走斑马纹兜底）');
  assert(table[0].tableRows[0][1].groups[0].spans.every((sp: RichSpan) => sp.backgroundColor === undefined),
    '单元格背景不再漏进单元格内 Span');

  // 17f 容器只有块级子元素时，底色下放给子块（扁平模型的降级实现）
  const div = build('<div style="background-color:#EEEEEE;"><p>子段</p></div>');
  assert(div.length === 1 && div[0].backgroundColor === '#eeeeee', 'div 底色下放给块级子块（底色仍可见）');

  // 17g pre：内联优先、config 兜底
  const preOwn = build('<pre style="background-color:#0D1117;">code</pre>');
  assert(preOwn[0].backgroundColor === '#0d1117', 'pre 内联背景优先于 config: ' + String(preOwn[0].backgroundColor));
  const preDefault = build('<pre>code</pre>');
  assert(preDefault[0].backgroundColor === cfg.codeBlockBackground, 'pre 无内联色时 config 兜底');

  // 17h blockquote：内联优先、config 兜底，且内部段落不被引用块底色污染
  const qOwn = build('<blockquote style="background-color:#FFF0F6;"><p>引用</p></blockquote>');
  assert(qOwn[0].backgroundColor === '#fff0f6', 'blockquote 内联背景优先于 config');
  assert(qOwn[0].children[0].backgroundColor === undefined, '引用块内部段落不继承引用块底色');
  const qDefault = build('<blockquote><p>引用</p></blockquote>');
  assert(qDefault[0].backgroundColor === cfg.quoteBackground, 'blockquote 无内联色时 config 兜底');

  // 17i 行内嵌套：行内祖先的底色必须传给行内子元素。
  // 漏掉这一层，<code><strong>x</strong></code> 里内层 strong 重算样式时会把 code 的
  // 灰底丢掉 → 整句只剩玫红字、没有底色（真机文章 178 的实测缺陷）。
  const cStrong = build('<p><code><strong>AG</strong></code></p>');
  assert(cStrong[0].groups[0].spans[0].backgroundColor === cfg.inlineCodeBackground,
    '<code><strong> 内层 strong 继承 code 灰底: ' + String(cStrong[0].groups[0].spans[0].backgroundColor));
  const cEm = build('<p><code><em>AG</em></code></p>');
  assert(cEm[0].groups[0].spans[0].backgroundColor === cfg.inlineCodeBackground, '<code><em> 同样保留 code 灰底');
  const cSpan = build('<p><code><span>AG</span></code></p>');
  assert(cSpan[0].groups[0].spans[0].backgroundColor === cfg.inlineCodeBackground, '<code><span> 同样保留 code 灰底');
  const mStrong = build('<p><mark><strong>AG</strong></mark></p>');
  assert(mStrong[0].groups[0].spans[0].backgroundColor === '#FFE58F', '<mark><strong> 内层继承 mark 高亮底');
  const sCode = build('<p><strong><code>AG</code></strong></p>');
  assert(sCode[0].groups[0].spans[0].backgroundColor === cfg.inlineCodeBackground,
    '<strong><code> 外层加粗不影响内层 code 自带灰底');

  // 17j 关键安全边界：块级底色依旧不进行内内容（否则 17a 会退化成"每条碎色块"）
  const blockVsCode = build('<p style="background-color:#FF0000;">A<code>B</code></p>');
  assert(blockVsCode[0].backgroundColor === '#ff0000', '段落底色仍整段铺满');
  const bvSpans = blockVsCode[0].groups[0].spans;
  const spanA = bvSpans.find((sp: RichSpan) => sp.text === 'A');
  const spanB = bvSpans.find((sp: RichSpan) => sp.text === 'B');
  assert(spanA !== undefined && spanA.backgroundColor === undefined, '普通文字不继承段落底色');
  assert(spanB !== undefined && spanB.backgroundColor === cfg.inlineCodeBackground,
    '同段 code 用的是自己的灰底，不是段落底色: ' + String(spanB?.backgroundColor));
  const sibling = build('<p><code>A</code>B</p>');
  assert(sibling[0].groups[0].spans[1].backgroundColor === undefined, 'code 的底色不漏给同级普通文字');
}

console.log('\n[18] 表格矩阵布局（colspan / rowspan）');
{
  // 真机上错位的那张表：表头跨 3 列 + 行中间 colspan=2 + 首列 rowspan=2
  const html =
    '<table>' +
    '<tr><th colspan="3">表头跨三列</th></tr>' +
    '<tr><td>普通单元格</td><td colspan="2">跨两列，且位于行中间</td></tr>' +
    '<tr><td colspan="2">行首跨两列</td><td>行尾单列</td></tr>' +
    '<tr><td rowspan="2">纵向跨两行</td><td>右侧第一行</td><td>右侧第一行</td></tr>' +
    '<tr><td>右侧第二行</td><td>右侧第二行</td></tr>' +
    '</table>';
  const tb = build(html)[0];
  assert(tb.kind === 'table', '解析出 table 块');
  assert(tb.tableCols === 3, '真实列数 = 3（实际 ' + tb.tableCols + '）');
  assert(countTableCols(tb.tableRows) === 3, 'countTableCols 与构建层写入的列数一致');

  const slots = buildTableSlots(tb.tableRows);
  const shape = slots.map((s) => `${s.rowIndex},${s.colStart}+${s.colSpan}x${s.rowSpan}`).join(' | ');
  assert(slots.length === 10, '槽位数 = 10（实际 ' + slots.length + '）');
  assert(
    shape === '0,0+3x1 | 1,0+1x1 | 1,1+2x1 | 2,0+2x1 | 2,2+1x1 | 3,0+1x2 | 3,1+1x1 | 3,2+1x1 | 4,1+1x1 | 4,2+1x1',
    '矩阵与 HTML 语义一致: ' + shape
  );
  // 回归点：旧实现把"数组下标"当列号，行中间的 colspan=2 会把后面的单元格挤到下一行（截图里的错位）
  assert(slots[4].rowIndex === 2 && slots[4].colStart === 2, '行中间 colspan 之后的单元格仍留在本行第 3 列');
  assert(slots[8].rowIndex === 4 && slots[8].colStart === 1, 'rowspan 让位：第 5 行第一个单元格从第 2 列开始');
  assert(slots.every((s) => !s.isEmpty), '该表每行都填满 3 列，无需补位单元');

  // 行尾补齐：2 列表格某行只有 1 个单元格
  const short = build('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>')[0];
  const shortSlots = buildTableSlots(short.tableRows);
  assert(
    shortSlots.length === 4 && shortSlots[3].isEmpty && shortSlots[3].colStart === 1 && shortSlots[3].colSpan === 1,
    '单元格不足的行补出占位单元（共 ' + shortSlots.length + ' 个槽位）'
  );

  // 整行为空
  const emptyRow = build('<table><tr><td>a</td><td>b</td></tr><tr></tr></table>')[0];
  const erSlots = buildTableSlots(emptyRow.tableRows);
  assert(erSlots.length === 3 && erSlots[2].isEmpty && erSlots[2].colSpan === 2, '空行补出 1 个跨 2 列的占位单元');

  // rowspan 叠加：真实列数大于任何一行的 colspan 之和（旧算法在此低估列数并丢单元格）
  const stack = build(
    '<table><tr><td rowspan="3">A</td></tr><tr><td rowspan="2">B</td><td>C</td></tr><tr><td>D</td><td>E</td></tr></table>'
  )[0];
  assert(stack.tableCols === 4, 'rowspan 叠加的真实列数 = 4（实际 ' + stack.tableCols + '）');
  const stackSlots = buildTableSlots(stack.tableRows);
  assert(
    stackSlots.length === 7 && stackSlots[5].rowIndex === 2 && stackSlots[5].colStart === 2 &&
      stackSlots[6].rowIndex === 2 && stackSlots[6].colStart === 3 && !stackSlots[6].isEmpty,
    'rowspan 叠加后最后两格落在第 3、4 列（不丢格）'
  );

  // colspan 撑宽整表，后续行补位
  const wide = build('<table><tr><td colspan="5">A</td></tr><tr><td>B</td><td>C</td></tr></table>')[0];
  assert(wide.tableCols === 5, 'colspan 把表撑成 5 列');
  const wideSlots = buildTableSlots(wide.tableRows);
  assert(
    wideSlots.length === 4 && wideSlots[3].isEmpty && wideSlots[3].colStart === 2 && wideSlots[3].colSpan === 3,
    '第 2 行只给 2 个单元格，尾部补出跨 3 列的占位单元'
  );

  // colspan 比现有列数大：按浏览器语义把整表撑宽，且单元格完整保留
  const span9 = build('<table><tr><td>a</td><td>b</td></tr><tr><td colspan="9">c</td></tr></table>')[0];
  assert(span9.tableCols === 9, 'colspan=9 把整表撑成 9 列（与浏览器一致）');
  const span9Slot = buildTableSlots(span9.tableRows).filter((s) => s.rowIndex === 1)[0];
  assert(span9Slot !== undefined && span9Slot.colSpan === 9, '跨 9 列的单元格完整保留，不被截断');

  // 不丢格不变式：稠密展开后非空槽位数应等于原始单元格总数
  const noLoss = (rows: TableCell[][]): boolean => {
    const total = rows.reduce((n: number, r: TableCell[]) => n + r.length, 0);
    const nonEmpty = buildTableSlots(rows).filter((s) => !s.isEmpty).length;
    return total === nonEmpty && total > 0;
  };
  assert(
    noLoss(tb.tableRows) && noLoss(short.tableRows) && noLoss(stack.tableRows) &&
      noLoss(wide.tableRows) && noLoss(span9.tableRows),
    '稠密展开不丢格：非空槽位数 = 原始单元格数'
  );

  // 表头行识别（表体独立滚动时表头要单独渲染以保持可见）
  const withHead = build(
    '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'
  )[0];
  assert(withHead.tableRows.length === 2 && countHeaderRows(withHead.tableRows) === 1, 'thead 全 th → 表头行数 = 1');
  const noHead = build('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')[0];
  assert(countHeaderRows(noHead.tableRows) === 0, '无 th 的表格不识别表头（不拆表头）');
  const mixed = build('<table><tr><th>H</th><td>d</td></tr><tr><td>a</td><td>b</td></tr></table>')[0];
  assert(countHeaderRows(mixed.tableRows) === 0, 'th/td 混排的行不算表头行');
}

console.log('\n[19] 解析与图片容错（自定义标签 / 空 src 图片）');
{
  // 19a 含连字符的自定义标签：旧正则 ^[a-zA-Z][a-zA-Z0-9]* 遇 '-' 截断，
  // <my-widget> 被当 <my> 打开、闭合标签永不匹配 → 吞掉后续全部内容（内容丢失级缺陷）
  const w = HtmlParser.parse('<my-widget>内部</my-widget><p>后续段落</p>');
  assert(w.children.length === 2, '连字符标签正常闭合，后续内容不被吞掉: ' + String(w.children.length));
  assert(w.children[0].tag === 'my-widget', '标签名完整保留连字符: ' + w.children[0].tag);
  assert(w.children[0].children[0].text === '内部', '标签内容正确');
  assert(w.children[1].tag === 'p' && w.children[1].children[0].text === '后续段落', '后续段落仍是独立节点');

  const ns = HtmlParser.parse('<o:p>甲</o:p><p>乙</p>');
  assert(ns.children[0].tag === 'o:p', '命名空间标签名完整保留冒号: ' + ns.children[0].tag);
  assert(ns.children.length === 2, '命名空间标签正常闭合');

  const dotted = HtmlParser.parse('<el-table-column>x</el-table-column><p>y</p>');
  assert(dotted.children[0].tag === 'el-table-column' && dotted.children.length === 2,
    '组件库风格标签（多连字符）也正常');

  // 端到端：构建层同样不能丢内容
  const customBlocks = build('<my-widget>内部</my-widget><p>后续段落</p>');
  assert(customBlocks.length === 2, '连字符标签后的段落生成独立块');
  assert(textOf(customBlocks) === '内部后续段落', '两个块文字都完整: ' + textOf(customBlocks));

  // 19b 空 src 的行内图片必须丢弃（协议白名单拦截后 src 为空，不能渲染成空占位框）
  const emptySrc = build('<p>前<img src="">后</p>');
  assert(emptySrc[0].groups.every((g: InlineGroup) => g.kind !== 'image'), '空 src 行内图片被丢弃');
  assert(textOf(emptySrc) === '前后', '丢弃图片不影响前后文字: ' + textOf(emptySrc));

  const noSrc = build('<p><img alt="x">文字</p>');
  assert(noSrc[0].groups.every((g: InlineGroup) => g.kind !== 'image'), '缺 src 属性的图片被丢弃');

  const blocked = build('<p><img src="javascript:alert(1)">文字</p>');
  assert(blocked[0].groups.every((g: InlineGroup) => g.kind !== 'image'), '协议被拦截的图片被丢弃');
  assert(textOf(blocked) === '文字', '被拦截图片不影响后续文字');

  const okImg = build('<p><img src="https://x.com/a.png"></p>');
  assert(okImg[0].groups.some((g: InlineGroup) => g.kind === 'image' && g.src === 'https://x.com/a.png'),
    '正常图片仍然保留');

  // 块级图片的空 src 守卫（既有行为，防回退）
  const blockImg = build('<img src="">');
  assert(blockImg.length === 0, '块级空 src 图片同样丢弃');
}

console.log(`\n========================================`);
console.log(`结果：通过 ${passed}，失败 ${failed}`);
console.log(`========================================\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * verify-fixture.ts - 用逻辑层真实解析器验证 fixtures 是否有效
 *
 * 目的：full-compat-blog.html 是给设备侧用的渲染兼容性测试数据，
 * 但"用例本身写错"（把 </b> 当普通文字写进正文、期望值与解析器语义相反、
 * 或者经后台编辑器往返后结构被改坏）是最容易被忽略的坑。
 * 这里用组件自己的 HtmlParser + RichTextBuilder 跑一遍，把真实产物打印出来，
 * 用来校对文档里的"期望表现"描述。
 *
 * 运行（Node 22+）：
 *   node --experimental-transform-types verify-fixture.ts
 *   node --experimental-transform-types verify-fixture.ts 其它文件.html   # 指定文件
 */
import { readFileSync } from 'node:fs';
import { HtmlParser } from '../../test/HtmlParser.ts';
import { RichTextBuilder } from '../../test/RichTextBuilder.ts';
import { RichTextConfig } from '../../test/RichTextConfig.ts';
import { RenderBlock, InlineGroup, RichSpan } from '../../test/RichTextModels.ts';
import { buildTableSlots, TableSlot } from '../../test/TableLayout.ts';

const target: string = process.argv[2] ?? 'full-compat-blog.html';
const raw: string = readFileSync(new URL('./' + target, import.meta.url), 'utf8');

const BEGIN = '<!-- ==================== DB-PAYLOAD-BEGIN ==================== -->';
const END = '<!-- ==================== DB-PAYLOAD-END ==================== -->';
const bi = raw.indexOf(BEGIN);
const ei = raw.indexOf(END);
// 有 DB-PAYLOAD 标记 => 本地源 fixture（要求干净）；
// 没有标记 => 外部产物（后台编辑器往返 / 接口返回的裸 content），按全文即 payload 处理。
const isSourceFixture: boolean = bi >= 0 && ei > bi;
const payload: string = isSourceFixture ? raw.slice(bi + BEGIN.length, ei) : raw;

let passed = 0;
let failed = 0;
function check(ok: boolean, msg: string): void {
  if (ok) { passed++; console.log('  OK   ' + msg); }
  else { failed++; console.error('  FAIL ' + msg); }
}

console.log('=== 文件 ===');
console.log('  目标          :', target);
console.log('  来源          :', isSourceFixture ? '本地源 fixture（DB-PAYLOAD 区间）' : '外部产物（整份文件即 payload）');
console.log('  全文字节数    :', Buffer.byteLength(raw, 'utf8'));
console.log('  payload 字符数:', payload.length);

console.log('\n=== 1. payload 形态校验（编辑器产出特征）===');
const classCount: number = (payload.match(/\sclass\s*=/g) ?? []).length;
const styleCount: number = (payload.match(/\sstyle\s*=/g) ?? []).length;
const caseMarks: number = (payload.match(/<!--\s*CASE-/g) ?? []).length;
const injected: string[] = [...new Set((payload.match(/\s(data-[a-z][a-z-]*)\s*=/g) ?? []).map((s) => s.trim().replace(/\s*=$/, '')))].sort();
console.log('  class= 出现次数 :', classCount);
console.log('  style= 出现次数 :', styleCount);
console.log('  正文内 CASE 注释:', caseMarks);
console.log('  data-* 属性     :', injected.join(' ') || '(无)');
// 「payload 形态」是源 fixture 的作者约定（见 skill: richtext-compat-fixture）：
// 内联 style、禁用 class。真实接口产物不受此约束 —— 只对源 fixture 判失败。
if (isSourceFixture) {
  check(classCount === 0, 'payload 内不应出现 class 属性');
  check(styleCount > 100, 'payload 应以 style 内联属性为主（>100 处）');
} else {
  console.log('  · payload 形态断言（class=0 / style>100）仅针对源 fixture 的作者约定，外部产物跳过');
}if (isSourceFixture) {
  // 源 fixture 原则上应当是干净的；但把这份文件丢进后台编辑器往返一遍、
  // 再把产物留在原地是常见用法 —— 此时 data-page-node-id 属预期痕迹，
  // 不是错误（实测它们不影响解析结果），只提示、不判失败。
  if (/data-page-node-id/.test(payload)) {
    console.log('  注：本文件已带后台编辑器往返痕迹（data-page-node-id），属预期，不判失败；');
    console.log('      想验证"干净源文件"，请先移除编辑器注入的私有属性。');
  } else {
    check(true, '源 fixture 干净：未被注入编辑器私有属性');
  }
} else {
  // 后台编辑器一定会注入这类属性，不算问题，只报告；真正要确认的是它们不影响解析。
  console.log('  注：外部产物含编辑器注入属性属正常，见第 2 节是否解析异常。');
}
if (caseMarks === 0) {
  console.log('  注：正文内 CASE 编号注释已被后台移除 —— 设备侧对照请改用「附录：用例清单」表的编号列。');
}

console.log('\n=== 2. 解析 + 构建（异常即失败）===');
let blocks: RenderBlock[] = [];
try {
  const root = HtmlParser.parse(payload);
  blocks = new RichTextBuilder(root, new RichTextConfig(), '').build();
  console.log('  OK：未抛异常，顶层块数 =', blocks.length);
  passed++;
} catch (e) {
  console.error('  FAIL：', e);
  process.exit(1);
}

console.log('\n=== 3. 块类型分布（含引用块内部递归）===');
const kinds: Record<string, number> = {};
const imageGroups: Array<{ src: string; w?: number; h?: number }> = [];
const tables: Array<{ rows: number; cols: number; head: string }> = [];
const tableBlocks: RenderBlock[] = [];
let maxListLevel = 0;
let linkGroups = 0;
let spanCount = 0;

function walk(bs: RenderBlock[]): void {
  for (const b of bs) {
    kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    if (b.kind === 'table') {
      tableBlocks.push(b);
      const head = b.tableRows[0]
        .map((c) => (c.groups ?? []).flatMap((g) => (g.spans ?? []).map((s) => s.text)).join(''))
        .join(' | ');
      tables.push({ rows: b.tableRows.length, cols: b.tableCols, head: head.slice(0, 46) });
    }
    if (b.kind === 'list-item') maxListLevel = Math.max(maxListLevel, b.listLevel);
    for (const g of b.groups ?? []) {
      spanCount += g.spans ? g.spans.length : 0;
      if (g.kind === 'link') linkGroups++;
      if (g.kind === 'image') imageGroups.push({ src: g.src ?? '', w: g.width, h: g.height });
    }
    if (b.children && b.children.length > 0) walk(b.children);
  }
}
walk(blocks);
for (const k of Object.keys(kinds).sort()) console.log(`  ${k.padEnd(10)} ${kinds[k]}`);
console.log('  Span 总数 =', spanCount, '/ 可点击链接组 =', linkGroups, '/ 最深列表层级 =', maxListLevel);

console.log('\n=== 4. 图片（' + imageGroups.length + ' 个，全部是行内图片组）===');
imageGroups.forEach((g, i) => {
  const flag = g.src.length === 0 ? '   <== 空 src：协议被拦截后未丢弃，组件层会渲染出空图' : '';
  const dim = g.w === undefined && g.h === undefined ? 'w/h 未解析出' : `w=${g.w ?? '-'} h=${g.h ?? '-'}`;
  console.log(`  [${i}] ${dim.padEnd(16)} ${(g.src || '(empty)').slice(0, 40)}${flag}`);
});
// 通用不变量：任何真实正文里都不该出现 src 为空的图片组
// （协议白名单拦截后必须丢弃，否则真机渲染出空占位框）
check(imageGroups.every((g) => g.src.length > 0), '无空 src 图片组（被协议拦截的图片已丢弃）');

console.log('\n=== 5. 表格（' + tables.length + ' 张）===');
tables.forEach((t, i) => console.log(`  [${i}] rows=${String(t.rows).padStart(3)} cols=${t.cols} 首行: ${t.head}`));

console.log('\n=== 6. 必须"不可见"的内容是否泄漏 ===');
function flatText(bs: RenderBlock[]): string {
  let s = '';
  for (const b of bs) {
    for (const g of b.groups ?? []) for (const sp of g.spans ?? []) s += sp.text;
    for (const line of b.codeLinesTokens ?? []) for (const sp of line) s += sp.text;
    for (const row of b.tableRows ?? []) {
      for (const c of row) for (const g of c.groups ?? []) for (const sp of g.spans ?? []) s += sp.text;
    }
    if (b.children) s += flatText(b.children);
  }
  return s;
}
const whole: string = flatText(blocks);
for (const s of ['脚本内容不应被渲染', '.injected', '模板内文字也不该出现', 'noscript 内容也不该出现', '这整段是注释', 'CASE-']) {
  check(!whole.includes(s), '未泄漏：' + s);
}

console.log('\n=== 7. 必须"存在"的字符/文本是否丢失 ===');
// 这一节校验的是 full-compat-blog.html 里预置的样本字符，属源 fixture 专用。
if (isSourceFixture) {
  const mustExist: Array<[string, string]> = [
    ['𠮷 4 字节生僻字', '𠮷'],
    ['😀 emoji', '😀'],
    ['家庭 emoji(ZWJ)', '👨‍👩‍👧‍👦'],
    ['∑ 数学符号', '∑'],
    ['未收录实体原样输出', '&alpha;'],
    ['缺分号实体原样输出', '&nbsp'],
    ['超长英文单词', 'pneumonoultramicroscopicsilicovolcanoconiosis'],
    ['E5 连字符标签的收尾段', '案例 E5 收尾'],
    ['E6 o:p 复位后文字未丢', '真实场景里不会有这个复位标签'],
  ];
  for (const [label, s] of mustExist) check(whole.includes(s), label);
  check(JSON.stringify(blocks).includes('#aabbcc'), '三位简写色 #abc 已展开为 #aabbcc');
} else {
  console.log('  · 本节的字符样本来自源 fixture，外部产物跳过（完整性请结合第 2/3/6/9 节输出人工核对）');
}

console.log('\n=== 8. 极端容错样本的复位是否生效 ===');
if (isSourceFixture) {
  const tailCases: Array<[string, string]> = [
    ['E1 复位（未闭合 b）', '案例 E1 收尾'],
    ['E2 复位（未闭合 div）', '案例 E2 收尾'],
    ['E3 复位（孤立闭合标签）', '案例 E3 收尾'],
    ['E4 复位（隐式闭合 p）', '案例 E4 收尾'],
    ['E5 复位（连字符标签）', '案例 E5 收尾'],
    ['E7 尾部（吞并到文末仍不丢字）', '只要文字没丢、没闪退'],
    ['附录最后一行用例', '极端容错样本 E1~E7'],
  ];
  for (const [label, needle] of tailCases) check(whole.includes(needle), label);
  check(!hasBold(blocks, '案例 E1 收尾'), 'E1 收尾段未被上一段加粗污染');
} else {
  console.log('  · 本节的复位样本来自源 fixture，外部产物跳过');
}
function hasBold(bs: RenderBlock[], needle: string): boolean {
  for (const b of bs) {
    for (const g of b.groups ?? []) {
      const txt = (g.spans ?? []).map((s: RichSpan) => s.text).join('');
      if (txt.includes(needle)) return (g.spans ?? []).some((s: RichSpan) => (s.fontWeight ?? 0) >= 700);
    }
    if (b.children && hasBold(b.children, needle)) return true;
  }
  return false;
}

console.log('\n=== 9. 正文前 3 个块 ===');
blocks.slice(0, 3).forEach((b, i) => {
  const txt = (b.groups ?? []).flatMap((g) => (g.spans ?? []).map((s: RichSpan) => s.text)).join('');
  console.log(`  [${i}] ${b.kind} :: ${txt.slice(0, 68)}`);
});

console.log('\n=== 10. 背景色专项用例是否就位（CASE-14 组 / v1.0.3）===');
const bgBlocks: string[] = [];
const bgCells: string[] = [];
let bgSpans = 0;
(function walkBg(bs: RenderBlock[]): void {
  for (const b of bs) {
    if (b.backgroundColor !== undefined) bgBlocks.push(b.kind + ':' + b.backgroundColor);
    for (const row of b.tableRows ?? []) {
      for (const c of row) {
        if (c.backgroundColor !== undefined) bgCells.push(c.backgroundColor);
      }
    }
    const all: InlineGroup[] = [...(b.groups ?? [])];
    for (const line of b.groupLines ?? []) all.push(...line);
    for (const g of all) {
      for (const sp of g.spans ?? []) {
        if (sp.backgroundColor !== undefined) bgSpans++;
      }
    }
    if (b.children && b.children.length > 0) walkBg(b.children);
  }
})(blocks);
console.log('  块级背景   :', bgBlocks.length, '→', bgBlocks.slice(0, 6).join('  '));
console.log('  单元格背景 :', bgCells.length, '→', bgCells.slice(0, 6).join('  '));
console.log('  行内 Span  :', bgSpans);
// CASE-14 组是 v1.0.3 为背景色链路预置的「定向样本」，只存在于源 fixture。
// 外部产物（真实接口快照）不一定含这几组写法 —— 上面的统计仍可用于人工比对，
// 但断言只在源 fixture 上生效，避免把"样本不存在"报成失败。
if (isSourceFixture) {
  check(bgBlocks.indexOf('text:#fff3cd') >= 0, '段落底色落到块上（CASE-14a：整段铺满）');
  check(bgCells.length >= 3, '单元格自身背景落到 TableCell（CASE-14c）');
  check(bgSpans >= 5, '行内底色仍落在 Span 上（CASE-14b：mark / span / 加粗）');
  check(bgBlocks.indexOf('quote:#fff0f6') >= 0, '引用块内联背景落到块上（CASE-14e：内联优先）');
  check(bgBlocks.indexOf('code:#0d1117') >= 0, '代码块内联背景落到块上（CASE-14d：内联优先）');
  // CASE-14f：容器包裹后，子块背景与内联样式都不能再丢
  check(bgBlocks.indexOf('text:#eef3ff') >= 0 && bgBlocks.indexOf('text:#d3f9d8') >= 0,
    '容器底色下放 / 子块自带底色保留（CASE-14f）');
} else {
  console.log('  · CASE-14 组为源 fixture 专用样本，外部产物跳过（上方统计供人工比对）');
}
const allSpans: RichSpan[] = [];
(function walkSpans(bs: RenderBlock[]): void {
  for (const b of bs) {
    for (const g of b.groups ?? []) for (const sp of g.spans ?? []) allSpans.push(sp);
    for (const line of b.groupLines ?? []) for (const g of line) for (const sp of g.spans ?? []) allSpans.push(sp);
    if (b.children.length > 0) walkSpans(b.children);
  }
})(blocks);
if (isSourceFixture) {
  check(allSpans.some((sp: RichSpan) => sp.color === '#1e6fff' && sp.fontSize === 17),
    '容器包裹时内联字号 + 颜色照样生效（CASE-14f，v1.0.3 修复）');
}

console.log('\n=== 11. 表格矩阵展开（colspan / rowspan / 补位空单元）===');
tableBlocks.forEach((tb: RenderBlock, i: number) => {
  const slots = buildTableSlots(tb.tableRows);
  const fillers = slots.filter((s: TableSlot) => s.isEmpty).length;
  console.log(
    `  [${i}] ${String(tb.tableRows.length).padStart(3)} 行 x ${tb.tableCols} 列 -> ${slots.length} 个槽位` +
    (fillers > 0 ? `（含 ${fillers} 个补位空单元）` : '（每行都填满，无需补位）')
  );
});

// 逐格核对 9.3 的 colspan/rowspan 用例表（真机上曾整表错位的那张）
const spanTables: RenderBlock[] = tableBlocks.filter((tb: RenderBlock) =>
  tb.tableRows.some((r) => r.some((c) => c.groups.some((g) => g.spans.some((sp) => sp.text.indexOf('表头跨三列') >= 0))))
);
if (isSourceFixture) {
  check(spanTables.length === 1, '找到 colspan/rowspan 用例表（9.3）');
}
if (spanTables.length === 1) {
  const tb: RenderBlock = spanTables[0];
  const slots = buildTableSlots(tb.tableRows);
  const shape = slots.map((s: TableSlot) => `${s.rowIndex},${s.colStart}+${s.colSpan}x${s.rowSpan}`).join(' | ');
  console.log('  9.3 矩阵: ' + shape);
  check(tb.tableCols === 3, '9.3 表真实列数 = 3');
  check(
    shape === '0,0+3x1 | 1,0+1x1 | 1,1+2x1 | 2,0+2x1 | 2,2+1x1 | 3,0+1x2 | 3,1+1x1 | 3,2+1x1 | 4,1+1x1 | 4,2+1x1',
    '9.3 矩阵与 HTML 语义一致（行中间的 colspan 不再把后续单元格挤到下一行）'
  );
  check(
    slots.filter((s: TableSlot) => s.rowIndex === 2).some((s: TableSlot) => s.colStart === 2),
    '9.3「行尾单列」仍留在第 2 行第 3 列（真机错位点）'
  );
  check(
    slots.filter((s: TableSlot) => s.rowIndex === 4).every((s: TableSlot) => s.colStart >= 1),
    '9.3 rowspan 让位：第 5 行不给跨行单元格让出的首列占用'
  );
  const cellTotal = tb.tableRows.reduce((n, r) => n + r.length, 0);
  check(slots.filter((s: TableSlot) => !s.isEmpty).length === cellTotal,
    '稠密展开不丢格（' + cellTotal + ' 个单元格全部就位）');
}

// 无跨行跨列的表：槽位数必须等于 行数 × 列数
const plainTables = tableBlocks.filter((tb: RenderBlock) =>
  tb.tableRows.every((r) => r.every((c) => c.colSpan === 1 && c.rowSpan === 1)));
check(
  plainTables.every((tb: RenderBlock) => buildTableSlots(tb.tableRows).length === tb.tableRows.length * tb.tableCols),
  '无跨行跨列的表：槽位数 = 行数 x 列数（' + plainTables.length + ' 张）'
);

// 宽表 / 长表：横向滚动与固定表头这两项新能力的默认阈值下确有覆盖用例
// （"fixture 是否覆盖到新能力"属源 fixture 的完备性问题，外部产物不判失败）
const minColW = new RichTextConfig().tableMinColumnWidth;
const wideTables = tableBlocks.filter((tb: RenderBlock) => tb.tableCols * minColW > 360);
const longTables = tableBlocks.filter((tb: RenderBlock) => tb.tableRows.length >= 20);
if (isSourceFixture) {
  check(wideTables.length > 0,
    '存在需要横向滚动的宽表（列数 x tableMinColumnWidth(' + minColW + ') > 360vp）：' + wideTables.length + ' 张');
  check(longTables.length > 0, '存在适合固定表头的长表（>= 20 行）：' + longTables.length + ' 张');
} else {
  console.log('  · 宽表/长表覆盖度（' + wideTables.length + ' / ' + longTables.length +
    '）属源 fixture 完备性，外部产物跳过');
}

console.log(`\n结论：通过 ${passed} 项，失败 ${failed} 项。`);
if (failed > 0) process.exit(2);

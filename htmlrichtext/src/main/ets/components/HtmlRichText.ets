/**
 * HtmlRichText.ets
 * 鸿蒙 NEXT 自定义富文本解析组件（资讯/文章详情页场景）
 *
 * 用法：
 *   HtmlRichText({
 *     html: this.htmlContent,
 *     config: new RichTextConfig(),
 *     baseUrl: 'https://cdn.example.com',
 *     onLinkClick: (url: string) => { this.openUrl(url) },
 *     onImageClick: (index: number, url: string) => {}
 *   })
 *
 * 特性：
 *  - 手写 HTML 解析器 + 样式继承，支持 h1-h6/p/strong/em/u/del/a/img/ul/ol/li/
 *    blockquote/pre/code/table/hr/br/span/div 等标签与内联 style
 *  - 文本用 Text+Span 原生渲染，换行连续，样式精细可控
 *  - 图片支持占位背景、加载失败回调、点击全屏预览（Swiper + 双击缩放）
 *  - 代码块支持横向滚动与轻量语法高亮
 *  - 所有样式集中在 RichTextConfig，可整体定制
 */
import { LengthMetrics, display } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
// 注意：onAreaChange 回调的 Area 类型为全局声明类型，无需（也不能）从 @kit.ArkUI 导入
import {
  RenderBlock, InlineGroup, RichSpan, TableCell, AlignStyle, DecorationStyle, FontStyleType
} from '../core/RichTextModels';
import { RichTextConfig } from '../core/RichTextConfig';
import { HtmlParser } from '../core/HtmlParser';
import { RichTextBuilder } from '../core/RichTextBuilder';
import { TableSlot, buildTableSlots, countHeaderRows } from '../core/TableLayout';
import { ImagePreviewDialog } from './ImagePreviewDialog';

function toArkAlign(a: AlignStyle): TextAlign {
  switch (a) {
    case AlignStyle.CENTER:
      return TextAlign.Center;
    case AlignStyle.END:
      return TextAlign.End;
    case AlignStyle.JUSTIFY:
      // ArkUI TextAlign 无 Justify 枚举，退化为左对齐
      return TextAlign.Start;
    default:
      return TextAlign.Start;
  }
}

function toArkDeco(d?: DecorationStyle): TextDecorationType {
  switch (d) {
    case DecorationStyle.UNDERLINE:
      return TextDecorationType.Underline;
    case DecorationStyle.LINE_THROUGH:
      return TextDecorationType.LineThrough;
    case DecorationStyle.OVERLINE:
      return TextDecorationType.Overline;
    default:
      return TextDecorationType.None;
  }
}

function toArkFontStyle(f?: FontStyleType): FontStyle {
  return f === FontStyleType.ITALIC ? FontStyle.Italic : FontStyle.Normal;
}

@Component
export struct HtmlRichText {
  /** 富文本 HTML 字符串（变化时自动重新解析） */
  @Prop @Watch('onHtmlChange') html: string = ''
  /** 样式配置（建议父组件持有单例） */
  config: RichTextConfig = new RichTextConfig()
  /** 图片/链接相对地址前缀 */
  baseUrl: string = ''
  /** 链接点击回调 */
  onLinkClick?: (url: string) => void
  /** 图片点击回调（index 为整篇文章中的图片序号） */
  onImageClick?: (index: number, url: string) => void
  /** 图片加载失败回调 */
  onImageLoadError?: (url: string) => void
  /**
   * 屏幕宽度（vp），可选入参：由使用方传入可避免组件自取；
   * 未传入时组件在 aboutToAppear 中通过 display 获取（兜底 360vp）。
   * TODO(折叠屏/分屏适配)：display.getDefaultDisplaySync() 只取一次，
   * 分屏/折叠态变化时屏幕宽度不会自动刷新，后续需监听窗口尺寸变化更新此值。
   */
  screenWidthVp: number = -1

  @State private blocks: RenderBlock[] = []
  @State private images: string[] = []
  @State private previewIndex: number = 0

  private previewCtrl: CustomDialogController | null = null

  aboutToAppear(): void {
    // 屏幕宽度：优先使用方传入，否则组件自取（物理像素 ÷ 密度 → vp），失败兜底 360
    if (this.screenWidthVp <= 0) {
      try {
        const d = display.getDefaultDisplaySync();
        this.screenWidthVp = d.width / d.densityPixels;
      } catch (e) {
        this.screenWidthVp = 360;
      }
    }
    this.rebuild();
  }

  aboutToDisappear(): void {
    this.previewCtrl?.close();
    this.previewCtrl = null;
  }

  onHtmlChange(propName: string): void {
    this.rebuild();
  }

  /**
   * 重新构建渲染模型：HTML → 解析树 → 渲染块（仅在此处做解析与构建，
   * build() 里零计算，纯渲染；html 变化时由 @Watch 触发）。
   * 同时收集全文图片地址列表（按出现顺序），供预览弹窗 Swiper 使用。
   */
  private rebuild(): void {
    const root = HtmlParser.parse(this.html);
    const builder = new RichTextBuilder(root, this.config, this.baseUrl);
    this.blocks = builder.build();
    this.images = [];
    this.collectImages(this.blocks);
    this.previewIndex = 0;
  }

  /** 递归收集所有图片（含块级 img 与行内 img group），保持出现顺序 */
  private collectImages(blocks: RenderBlock[]): void {
    for (const b of blocks) {
      if (b.kind === 'image' && b.imageSrc.length > 0) {
        this.images.push(b.imageSrc);
      }
      for (const g of b.groups) {
        if (g.kind === 'image' && g.src.length > 0) {
          this.images.push(g.src);
        }
      }
      this.collectImages(b.children);
    }
  }

  /** 打开图片预览：总是先回调 onImageClick；预览开关开启时弹出全屏 Swiper */
  private openImage(index: number, src: string): void {
    this.onImageClick?.(index, src);
    if (this.config.enableImagePreview && this.images.length > 0) {
      this.previewIndex = index;
      this.openPreview();
    }
  }

  /**
   * 用系统浏览器打开链接（linkOpenBrowser 开启且未提供 onLinkClick 时的默认行为）。
   * 只放行 http/https 协议（逻辑层 resolveUrl 已过滤伪协议，这里再兜底防御），
   * 打开失败静默忽略，避免无效链接导致异常。
   */
  private openLinkInBrowser(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      context.openLink(url);
    } catch (e) {
      // 打开失败（如权限限制/无效链接）静默忽略，不影响页面
    }
  }

  /**
   * 打开预览弹窗：每次打开前重建 CustomDialogController。
   * 原因：弹窗的 images/currentIndex 是构造时快照（普通参数，非 @Link），
   * 且 rebuild() 会更换 images 数组引用——重建保证 currentIndex 从点击的图片开始、
   * images 为最新列表（修复"点第 N 张图预览却停在首张"问题）。
   */
  private openPreview(): void {
    this.previewCtrl?.close(); // 先关旧弹窗（若存在），再重建，避免重复弹窗
    this.previewCtrl = new CustomDialogController({
      builder: ImagePreviewDialog({
        images: this.images,
        currentIndex: this.previewIndex
      }),
      customStyle: true,
      autoCancel: true,
      alignment: DialogAlignment.Center,
      backgroundColor: '#00000000',
      width: '100%',
      height: '100%'
    });
    this.previewCtrl.open();
  }

  private onImageTap(src: string): void {
    const idx: number = this.images.indexOf(src);
    this.openImage(idx < 0 ? 0 : idx, src);
  }

  /**
   * 大图判定：图片 HTML 声明的宽度 ≥ 屏幕宽度 × largeImageRatio → 正文大图，
   * 渲染时自适应铺满；未声明宽度一律视为小图（不放大，安全选择）。
   * 判定只依赖图片自身声明宽度，与排版上下文（混排/独占）无关。
   */
  private isLargeImage(g: InlineGroup): boolean {
    const w = g.width;
    if (w === undefined || w <= 0) {
      return false;
    }
    return w >= this.screenWidthVp * this.config.largeImageRatio;
  }

  private blockToGroup(block: RenderBlock): InlineGroup {
    const g: InlineGroup = new InlineGroup();
    g.kind = 'image';
    g.src = block.imageSrc;
    g.alt = block.imageAlt;
    g.width = block.imageWidth;
    g.height = block.imageHeight;
    g.borderRadius = this.config.imageRadius;
    return g;
  }

  /**
   * 生成内容稳定的 ForEach key（替换 index.toString()）：
   * key = 类型前缀 + 内容特征（文本取前 16 字符、图片取 src、链接取 href），
   * 再拼接出现序号保证同级唯一。
   * 优点：内容不变时 key 稳定，ArkUI 组件可正确复用；内容变化时 key 改变，强制重建。
   */
  private stableKey(kind: string, text: string, seq: number): string {
    let content = text;
    if (content.length > 16) {
      content = content.substring(0, 16);
    }
    return kind + '_' + content + '_' + seq.toString();
  }

  /** 取 RenderBlock 的内容特征：文本块取首个 span 文本，图片取 src，其余取 kind */
  private blockKeyText(block: RenderBlock): string {
    if (block.kind === 'text' || block.kind === 'heading') {
      if (block.groups.length > 0 && block.groups[0].spans.length > 0) {
        return block.groups[0].spans[0].text;
      }
      return '';
    }
    if (block.kind === 'image') {
      return block.imageSrc;
    }
    if (block.kind === 'table') {
      return block.tableRows.length.toString();
    }
    return block.kind;
  }

  /** 取 InlineGroup 的内容特征：文本取首个 span 文本，图片取 src，链接取 href */
  private groupKeyText(g: InlineGroup): string {
    if (g.kind === 'text') {
      return g.spans.length > 0 ? g.spans[0].text : '';
    }
    if (g.kind === 'link') {
      return g.href;
    }
    return g.src;
  }

  /** 取一"视觉行"的内容特征：拼接行内各组的 key 文本，用于混排逐行 ForEach 的 key */
  private lineKeyText(line: InlineGroup[]): string {
    let s: string = '';
    for (const g of line) {
      s += this.groupKeyText(g);
    }
    return s;
  }

  /** 混排渲染用的"视觉行"数组：有按 \n 拆分的结果（groupLines）用拆分结果，
   *  否则（如单链接/单图片组）按单行兜底。普通方法，供 @Builder 内 ForEach 调用
   *  （@Builder 方法体内不允许局部变量声明，取行数组的逻辑必须抽成普通方法）。 */
  private renderLinesOf(block: RenderBlock): InlineGroup[][] {
    return block.groupLines.length > 0 ? block.groupLines : [block.groups];
  }

  // ================= 渲染 =================

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        if (this.blocks.length > 0) {
          ForEach(this.blocks, (block: RenderBlock) => {
            this.BlockBuilder(block)
          }, (block: RenderBlock, index: number) => this.stableKey(block.kind, this.blockKeyText(block), index))
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
  }

  @Builder
  private BlockBuilder(block: RenderBlock) {
    Column() {
      if (block.kind === 'text' || block.kind === 'heading') {
        this.TextBlock(block)
      } else if (block.kind === 'image') {
        this.ImageBlock(block)
      } else if (block.kind === 'code') {
        this.CodeBlock(block)
      } else if (block.kind === 'quote') {
        this.QuoteBlock(block)
      } else if (block.kind === 'list-item') {
        this.ListItemBlock(block)
      } else if (block.kind === 'table') {
        this.TableBlock(block)
      } else if (block.kind === 'hr') {
        this.HrBlock()
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    // 块级背景：铺满整个块（含右侧留白与 padding 区），对齐浏览器语义
    .backgroundColor(this.blockContainerBackground(block))
    .margin({ top: block.marginTop, bottom: block.marginBottom })
    .padding({ left: block.paddingLeft })
  }

  /**
   * 块容器（BlockBuilder 外层 Column）的底色。
   * quote / code 由内部容器自带底色与圆角，此处必须保持透明，
   * 否则外层会再铺一层直角色块、把圆角糊掉。
   */
  private blockContainerBackground(block: RenderBlock): string {
    if (block.kind === 'quote' || block.kind === 'code') {
      return '#00000000';
    }
    return block.backgroundColor ?? '#00000000';
  }

  // ---------- 文本段 ----------

  /**
   * 文本段渲染：
   *  - 纯文本（单一 text 组）→ 单个 Text，支持 text-align 居中/右对齐等；
   *  - 混排（文本 + 图片 + 链接）→ Flex wrap 布局：
   *      每个文本组是一个 Text（多 Span 连片），图片是 Image，链接是带 onClick 的 Text；
   *      Flex 自动换行，文本组内部保持自然断行，图片/链接作为独立可交互子项。
   *  - 链接的点击由组件层在此处绑定（Span 不支持点击事件，所以链接单独成组）。
   */
  @Builder
  private TextBlock(block: RenderBlock) {
    if (block.groups.length === 1 && block.groups[0].kind === 'text') {
      // 纯文本段：单个 Text，支持 textAlign
      Text() {
        this.SpanList(block.groups[0].spans)
      }
      .lineHeight(block.lineHeight)
      .textAlign(toArkAlign(block.textAlign))
      .width('100%')
    } else {
      // 混排（文本 + 图片 / 链接）：按"视觉行"逐行渲染。
      // 行内全是单行内容，Flex 顶对齐基线一致；<br> 换行语义由行与行之间保留，
      // 避免"含 \n 的多行文本组"与单行链接/文本组在同一 Flex 中顶对齐错位。
      Column() {
        ForEach(this.renderLinesOf(block), (line: InlineGroup[]) => {
          Flex({ wrap: FlexWrap.Wrap, alignItems: ItemAlign.Start }) {
            ForEach(line, (g: InlineGroup) => {
              if (g.kind === 'text') {
                Text() {
                  this.SpanList(g.spans)
                }
                .lineHeight(block.lineHeight)
                .textAlign(TextAlign.Start)
              } else if (g.kind === 'link') {
                Text() {
                  this.SpanList(g.spans)
                }
                .lineHeight(block.lineHeight)
                .textAlign(TextAlign.Start)
                .onClick(() => {
                  if (this.onLinkClick !== undefined) {
                    // 使用方提供回调：全权交由回调处理，组件不跳转
                    this.onLinkClick(g.href);
                  } else if (this.config.linkOpenBrowser) {
                    // 未提供回调且开关开启：默认用系统浏览器打开
                    this.openLinkInBrowser(g.href);
                  }
                })
              } else if (g.kind === 'image') {
                // 行内图片也按声明宽度判定是否为大图：大图自动升级为自适应渲染
                this.InlineImage(g, this.isLargeImage(g))
              }
            }, (g: InlineGroup, index: number) => this.stableKey(g.kind, this.groupKeyText(g), index))
          }
          .width('100%')
        }, (line: InlineGroup[], index: number) => this.stableKey('line', this.lineKeyText(line), index))
      }
      .width('100%')
    }
  }

  /**
   * 行内 Span 渲染：一个 Text 内的多个 Span 共享同一基线，实现
   * "同一行内多种样式"（加粗/斜体/颜色/上下标混排）。
   * 每个属性都给兜底值，避免某个 Span 缺字段时样式串到别的 Span。
   * 注意：baselineOffset 在 API 12+ 参数类型是 LengthMetrics，需用
   * LengthMetrics.vp() 包装；API 11 工程请改回直接传 number（见 README 环境要求）。
   */
  @Builder
  private SpanList(spans: RichSpan[]) {
    ForEach(spans, (sp: RichSpan) => {
      Span(sp.text)
        .fontSize(sp.fontSize ?? this.config.bodyFontSize)
        .fontWeight(sp.fontWeight ?? 400)
        .fontStyle(toArkFontStyle(sp.fontStyle))
        .decoration({ type: toArkDeco(sp.decoration), color: sp.decorationColor })
        .fontColor(sp.color ?? this.config.bodyColor)
        // Span 只是 Text 的子元素，不支持 backgroundColor（从 CommonMethod 继承来的方法
        // 在 Span 上会被静默忽略，编译通过但真机不渲染）。行内底色必须用
        // textBackgroundStyle（API 11+），它只接受 { color, radius }。
        .textBackgroundStyle({ color: sp.backgroundColor ?? '#00000000' })
        .fontFamily(sp.fontFamily ?? this.config.bodyFontFamily)
        .baselineOffset(LengthMetrics.vp(sp.baselineOffset ?? 0))
        .letterSpacing(sp.letterSpacing ?? 0)
    }, (sp: RichSpan, index: number) => this.stableKey('span', sp.text + (sp.color ?? ''), index))
  }

  // ---------- 图片 ----------

  @Builder
  private ImageBlock(block: RenderBlock) {
    Column() {
      // 块级图片：始终按大图处理（自适应铺满）
      this.InlineImage(this.blockToGroup(block), true)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  /**
   * 行内/块级图片渲染（四档，按优先级判定，不可调换顺序）：
   *  1. isBlock=true（块级图片/判定为大图）：铺满容器宽度，高度按原图比例自适应
   *     （等同 CSS width:100%; height:auto），忽略 PC 编辑器设置的固定宽高。
   *     ⚠️ 必须排最前：正文插图常带 width+height，若 height 分支在前会被短路，
   *     大图自适应永远不生效。
   *  2. 有宽有高（小图）：按固定尺寸渲染（Cover 裁剪避免变形）；
   *  3. 有宽无高：按声明宽度渲染，高度等比，maxWidth 100% 防溢出；
   *  4. 无宽高：按原始像素尺寸显示、不放大，maxWidth 100% 防溢出（避免小图标被拉大变形）。
   *  - backgroundColor 作为加载中的占位底色；onError 抛出加载失败回调；
   *  - onClick 触发全屏预览（config.enableImagePreview 可关闭，仅留回调）。
   */
  @Builder
  private InlineImage(g: InlineGroup, isBlock: boolean = false) {
    if (isBlock) {
      // 档1：块级/大图 → 铺满宽度，等比自适应（忽略 PC 固定宽高）
      Image(g.src)
        .width('100%')
        .objectFit(ImageFit.Contain)
        .borderRadius(g.borderRadius ?? this.config.imageRadius)
        .backgroundColor(this.config.imagePlaceholderColor)
        .constraintSize({ maxWidth: '100%' })
        .margin({ top: this.config.imageMargin, bottom: this.config.imageMargin })
        .onClick(() => {
          this.onImageTap(g.src);
        })
        .onError(() => {
          if (this.onImageLoadError !== undefined) {
            this.onImageLoadError(g.src);
          }
        })
    } else if (g.height !== undefined) {
      // 档2：有宽有高（小图）→ 固定尺寸渲染（Cover 裁剪避免变形）
      Image(g.src)
        .width(g.width ?? '100%')
        .height(g.height)
        .objectFit(ImageFit.Cover)
        .borderRadius(g.borderRadius ?? this.config.imageRadius)
        .backgroundColor(this.config.imagePlaceholderColor)
        .constraintSize({ maxWidth: '100%' })
        .margin({ top: this.config.imageInlineMargin, bottom: this.config.imageInlineMargin })
        .onClick(() => {
          this.onImageTap(g.src);
        })
        .onError(() => {
          if (this.onImageLoadError !== undefined) {
            this.onImageLoadError(g.src);
          }
        })
    } else if (g.width !== undefined) {
      // 档3：有宽无高 → 按声明宽度渲染，高度等比，不拉满
      Image(g.src)
        .width(g.width)
        .objectFit(ImageFit.Contain)
        .borderRadius(g.borderRadius ?? this.config.imageRadius)
        .backgroundColor(this.config.imagePlaceholderColor)
        .constraintSize({ maxWidth: '100%' })
        .margin({ top: this.config.imageInlineMargin, bottom: this.config.imageInlineMargin })
        .onClick(() => {
          this.onImageTap(g.src);
        })
        .onError(() => {
          if (this.onImageLoadError !== undefined) {
            this.onImageLoadError(g.src);
          }
        })
    } else {
      // 档4：无宽高 → 按原始像素尺寸显示、不放大；maxWidth 100% 防溢出
      Image(g.src)
        .objectFit(ImageFit.Contain)
        .borderRadius(g.borderRadius ?? this.config.imageRadius)
        .backgroundColor(this.config.imagePlaceholderColor)
        .constraintSize({ maxWidth: '100%' })
        .margin({ top: this.config.imageInlineMargin, bottom: this.config.imageInlineMargin })
        .onClick(() => {
          this.onImageTap(g.src);
        })
        .onError(() => {
          if (this.onImageLoadError !== undefined) {
            this.onImageLoadError(g.src);
          }
        })
    }
  }

  // ---------- 代码块 ----------

  /**
   * 代码块渲染要点：
   *  - 按"行"拆成多个独立 Text（每行一个），长行不会被 Text 自动换行，
   *    而是撑宽内容 → 外层 Scroll 横向滚动（scrollable(Horizontal)）；
   *  - 空格已在构建阶段替换为不换行空格 \u00A0，保证缩进/对齐精确显示；
   *  - 空行用 \u00A0 占位，避免行高塌陷；
   *  - codeLinesTokens 是构建阶段算好的高亮结果（RichSpan[]，含颜色），
   *    渲染时零计算。
   */
  @Builder
  private CodeBlock(block: RenderBlock) {
    Column() {
      Scroll() {
        Column() {
          ForEach(block.codeLinesTokens, (tokens: RichSpan[], lineIndex: number) => {
            this.CodeLine(tokens, lineIndex)
          }, (tokens: RichSpan[], lineIndex: number) => this.stableKey('codeLine',
            tokens.length > 0 ? tokens[0].text : '', lineIndex))
        }
        // 撑满 Scroll 视口宽度：横向滚动时 Column 默认按内容宽度自适应，
        // 代码行短于屏幕时会被居中；width('100%') 让代码行始终从左开始。
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(this.config.codeBlockPadding)
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .align(Alignment.Start)
    }
    .width('100%')
    // 底色：内联优先（构建层已算进 block.backgroundColor），config 兜底
    .backgroundColor(block.backgroundColor ?? this.config.codeBlockBackground)
    .borderRadius(this.config.codeBlockRadius)
  }

  @Builder
  private CodeLine(tokens: RichSpan[], lineIndex: number) {
    if (tokens.length === 0) {
      Text('\u00A0')
        .fontFamily(this.config.codeFontFamily)
        .fontSize(this.config.codeBlockFontSize)
        .lineHeight(this.config.codeBlockFontSize * this.config.codeBlockLineHeight)
    } else {
      Text() {
        ForEach(tokens, (sp: RichSpan) => {
          Span(sp.text)
            .fontColor(sp.color ?? this.config.codeBlockTextColor)
            .fontSize(this.config.codeBlockFontSize)
        }, (sp: RichSpan, index: number) => this.stableKey('codeToken', sp.text + (sp.color ?? ''), index))
      }
      .fontFamily(this.config.codeFontFamily)
      .fontSize(this.config.codeBlockFontSize)
      .lineHeight(this.config.codeBlockFontSize * this.config.codeBlockLineHeight)
      .fontColor(this.config.codeBlockTextColor)
    }
  }

  // ---------- 引用块 ----------

  @Builder
  private QuoteBlock(block: RenderBlock) {
    Row() {
      Column() {
        ForEach(block.children, (child: RenderBlock) => {
          this.BlockBuilder(child)
        }, (child: RenderBlock, index: number) => this.stableKey(child.kind, this.blockKeyText(child), index))
      }
      .layoutWeight(1)
      .margin({ left: 10 })
    }
    .width('100%')
    // 底色：内联优先（构建层已算进 block.backgroundColor），config 兜底
    .backgroundColor(block.backgroundColor ?? this.config.quoteBackground)
    .borderRadius(6)
    .padding(this.config.quotePadding)
    // 左侧竖线改用边框实现：贴满实际高度、不参与高度计算。
    // 原 height('100%') 竖线在父容器自适应 + 外层 Scroll 无界高度约束下，
    // 会被解析成最大可用高度，把引用块撑到异常大（实测 669vp）
    .border({
      width: { left: 3 },
      color: { left: this.config.quoteBorderColor }
    })
  }

  // ---------- 列表项 ----------

  @Builder
  private ListItemBlock(block: RenderBlock) {
    Row() {
      Text(block.listMarker)
        .fontSize(block.children.length > 0 ? block.children[0].fontSize : this.config.bodyFontSize)
        .fontColor(this.config.listMarkerColor)
        .width(18)
        .margin({ right: 4 })
      Column() {
        ForEach(block.children, (child: RenderBlock) => {
          this.BlockBuilder(child)
        }, (child: RenderBlock, index: number) => this.stableKey(child.kind, this.blockKeyText(child), index))
      }
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  // ---------- 表格 ----------

  /**
   * 表格渲染：委托独立组件 TableBlockView（见文件底部）。
   * 委托原因：行高测量（onAreaChange）需要组件实例持有每行测量状态，
   * @Builder 方法无法持有独立状态；TableBlockView 负责：
   *  - 行内等高：测量每行最高单元格高度，给该行所有 GridItem/内层 Column 加
   *    minHeight，同一行矮单元格被撑满、背景铺满整行（问题 1）；
   *  - 斑马纹 / 表头文字色字重（走 RichTextConfig 新配置项）；
   *  - Grid 底部补 1vp 横线（问题 3：rowsGap 只产生行间缝隙，最后一行无下边框）。
   */
  @Builder
  private TableBlock(block: RenderBlock) {
    TableBlockView({ config: this.config, block: block })
  }

  // ---------- 分割线 ----------

  @Builder
  private HrBlock() {
    Row()
      .width('100%')
      .height(1)
      .backgroundColor(this.config.hrColor)
  }
}

/**
 * TableBlockView - 表格渲染独立组件（HtmlRichText 委托调用）
 *
 * 布局：先用 core/TableLayout 把表格摊平成"稠密网格槽位"（含补位空单元），
 * 再按顺序流式填充 Grid，跨行/跨列槽位通过 GridLayoutOptions 声明 irregularSize，
 * 由 Grid 自行占据多行多列。
 * **不再使用** columnStart/columnEnd/rowStart/rowEnd 绝对定位 ——
 * ArkUI 只在同时设置 columnsTemplate 与 rowsTemplate 时才支持它们；
 * 只设 columnsTemplate 时 rowStart/rowEnd 完全无效、列号冲突会"直接换行"，
 * 真机表现为整表错位（行尾单元格被挤到下一行、跨行失效、列宽忽宽忽窄）。
 *
 * 行高：rowSpan===1 的槽位通过 onAreaChange 上报高度，每行取最大值写入 rowMinHeights，
 * 给该行所有 GridItem 与内层 Column 同时加 constraintSize({ minHeight })，
 * 让矮单元格被撑满、背景铺满整行。
 *  - minHeight 必须同时作用到 GridItem 上（仅内层 Column 不足以让 Grid 采纳行高）；
 *  - rowSpan>1 的跨行槽位不参与测量，其 minHeight 取所跨各行之和；
 *  - 值无变化时不重新赋值 @State，避免 onAreaChange→重渲染→再 onAreaChange 循环。
 *
 * 表头与表体拆成两个 Grid（表头行 = 从第 0 行起、单元格全为 th 的连续行）：
 * 这样 tableMaxHeight > 0 时表体可在表格内部独立纵向滚动，而表头保持可见；
 * 两个 Grid 共用同一 columnsTemplate 与同一容器宽度，列宽天然对齐。
 *
 * 横向滚动：tableMinColumnWidth > 0 时内容最小宽度 = 列数 × 该值，
 * 超出可用宽度即由外层横向 Scroll 承接（表头与表体一起横向滚动）。
 *
 * 注意事项：
 *  - 独立 @Component 才能持有每行测量状态（@Builder 方法无法持有实例状态）；
 *  - 未测出行高时 rowMinHeights 保持 0 = 自然行高，安全降级为原始行为，不会丢行。
 */
@Component
struct TableBlockView {
  config: RichTextConfig = new RichTextConfig()
  block: RenderBlock = new RenderBlock()

  /** 每行已测高度（普通成员，非响应式，避免每次 onAreaChange 触发渲染） */
  private measured: number[] = []
  /** 该行是否存在可测量槽位（rowSpan===1）；全部可测行都测出后才应用行高 */
  private measurable: boolean[] = []
  private measurableCount: number = 0
  private reportedCount: number = 0
  /** 每行最小行高（@State 驱动渲染） */
  @State private rowMinHeights: number[] = []

  /** 稠密网格槽位（行优先），按表头/表体切分 */
  private headerSlots: TableSlot[] = []
  private bodySlots: TableSlot[] = []
  private headerOptions: GridLayoutOptions = { regularSize: [1, 1] }
  private bodyOptions: GridLayoutOptions = { regularSize: [1, 1] }
  private columnsTemplate: string = '1fr'
  /** 内容最小宽度(vp)：列多时撑开横向滚动；0 = 不限 */
  private contentMinWidth: number = 0
  /** 表体是否在表格内部独立纵向滚动（表头固定） */
  private bodyScrollable: boolean = false
  /** 表格可用宽度（由外层 onAreaChange 量出；0 = 尚未测量） */
  @State private availableWidth: number = 0
  /** 内容最小宽度是否超出可用宽度 —— 超出才套一层横向滚动容器 */
  @State private hScroll: boolean = false

  aboutToAppear(): void {
    const cols: number = this.block.tableCols
    const slots: TableSlot[] = buildTableSlots(this.block.tableRows)
    this.columnsTemplate = this.gridTemplate(cols)
    this.contentMinWidth = this.config.tableMinColumnWidth > 0 ? cols * this.config.tableMinColumnWidth : 0

    const rowCount: number = this.block.tableRows.length
    for (let i = 0; i < rowCount; i++) {
      this.measured.push(0)
      this.measurable.push(false)
    }
    for (const s of slots) {
      if (s.rowSpan === 1 && !this.measurable[s.rowIndex]) {
        this.measurable[s.rowIndex] = true
        this.measurableCount++
      }
    }

    // 表头固定只在表体独立滚动时才有意义；表头覆盖全表则退回单表渲染
    const sticky: boolean = this.config.tableStickyHeader && this.config.tableMaxHeight > 0
    let headerEnd: number = sticky ? countHeaderRows(this.block.tableRows) : 0
    if (headerEnd >= rowCount) {
      headerEnd = 0
    }
    this.headerSlots = headerEnd > 0 ? slots.filter((s: TableSlot): boolean => s.rowIndex < headerEnd) : []
    this.bodySlots = slots.filter((s: TableSlot): boolean => s.rowIndex >= headerEnd)
    this.headerOptions = this.makeOptions(this.headerSlots)
    this.bodyOptions = this.makeOptions(this.bodySlots)
    this.bodyScrollable = this.config.tableMaxHeight > 0 && this.bodySlots.length > 0
  }

  private gridTemplate(cols: number): string {
    let t: string = ''
    for (let i = 0; i < cols; i++) {
      t += (i === 0 ? '1fr' : ' 1fr')
    }
    return t.length > 0 ? t : '1fr'
  }

  /**
   * 跨行/跨列声明：regularSize 固定 [1,1]，
   * irregularIndexes + onGetIrregularSizeByIndex 给出占用的行数与列数。
   * 索引是该槽位在**所属 Grid 内**的顺序号（表头、表体各算各的）。
   */
  private makeOptions(slots: TableSlot[]): GridLayoutOptions {
    const irregular: number[] = []
    for (let i = 0; i < slots.length; i++) {
      const s: TableSlot = slots[i]
      if (s.colSpan > 1 || s.rowSpan > 1) {
        irregular.push(i)
      }
    }
    const options: GridLayoutOptions = {
      regularSize: [1, 1],
      irregularIndexes: irregular,
      onGetIrregularSizeByIndex: (index: number): [number, number] => {
        const s: TableSlot | undefined = slots[index]
        return s !== undefined ? [s.rowSpan, s.colSpan] : [1, 1]
      }
    }
    return options
  }

  private hasContent(slot: TableSlot): boolean {
    return !slot.isEmpty && slot.cell !== undefined
  }

  /** 单元格内容 → Span 列表（图片在单元格内降级为 alt/[图片] 文本） */
  private cellSpans(cell: TableCell): RichSpan[] {
    const out: RichSpan[] = []
    for (const g of cell.groups) {
      if (g.kind === 'text' || g.kind === 'link') {
        for (const sp of g.spans) {
          out.push(sp)
        }
      } else if (g.kind === 'image') {
        const sp: RichSpan = new RichSpan()
        sp.text = g.alt.length > 0 ? g.alt : '[图片]'
        out.push(sp)
      }
    }
    return out
  }

  private slotSpans(slot: TableSlot): RichSpan[] {
    return slot.cell !== undefined ? this.cellSpans(slot.cell) : []
  }

  /** 单元格内文字对齐（td/th 的 align 属性） */
  private slotTextAlign(slot: TableSlot): TextAlign {
    return slot.cell !== undefined ? toArkAlign(slot.cell.align) : TextAlign.Start
  }

  private slotIsHeader(slot: TableSlot): boolean {
    return slot.cell !== undefined && slot.cell.isHeader
  }

  /** 槽位最小高度：跨行槽位取所跨各行最小行高之和 */
  private slotMinHeight(slot: TableSlot): number {
    if (slot.rowSpan <= 1) {
      return this.rowMinHeights[slot.rowIndex] ?? 0
    }
    let sum: number = 0
    for (let r = slot.rowIndex; r < slot.rowIndex + slot.rowSpan; r++) {
      sum += this.rowMinHeights[r] ?? 0
    }
    return sum
  }

  /**
   * 槽位背景（优先级从高到低）：
   *  1. 单元格自身的 background-color（td/th 内联样式）
   *  2. 表头底色
   *  3. 数据行斑马纹（tableEvenRowBackground / tableOddRowBackground）
   *  补位空单元没有 cell，直接走斑马纹规则。
   */
  private slotBackground(slot: TableSlot): string {
    const cell: TableCell | undefined = slot.cell
    if (cell !== undefined && cell.backgroundColor !== undefined) {
      return cell.backgroundColor
    }
    if (cell !== undefined && cell.isHeader) {
      return this.config.tableHeaderBackground
    }
    return slot.rowIndex % 2 === 0 ? this.config.tableEvenRowBackground : this.config.tableOddRowBackground
  }

  /**
   * 行高测量上报：rowSpan===1 的槽位上报自身高度，每行取最大值；
   * 全部可测行都上报后才写入 rowMinHeights（提前应用会得到偏小的行高）。
   */
  private onRowMeasured(rowIndex: number, height: number): void {
    if (height <= 0 || !this.measurable[rowIndex]) {
      return
    }
    const prev: number = this.measured[rowIndex]
    if (height <= prev) {
      return
    }
    this.measured[rowIndex] = height
    if (prev <= 0) {
      this.reportedCount++
    }
    // 全部可测行都测出才应用；未测出保持 0 = 自然行高（安全降级）
    if (this.reportedCount < this.measurableCount) {
      return
    }
    const mins: number[] = []
    let changed: boolean = false
    for (let i = 0; i < this.measured.length; i++) {
      const v: number = Math.max(this.measured[i], this.config.tableMinRowHeight)
      if (v !== this.rowMinHeights[i]) {
        changed = true
      }
      mins.push(v)
    }
    if (changed) {
      this.rowMinHeights = mins // 值无变化不赋值，防循环渲染
    }
  }

  /** 单个网格单元（含补位空单元） */
  @Builder
  private CellView(slot: TableSlot) {
    GridItem() {
      Column() {
        if (this.hasContent(slot)) {
          Text() {
            ForEach(this.slotSpans(slot), (sp: RichSpan) => {
              Span(sp.text)
                .fontSize(sp.fontSize ?? this.config.bodyFontSize)
                .fontWeight(this.slotIsHeader(slot) ? this.config.tableHeaderTextWeight : (sp.fontWeight ?? 400))
                .fontStyle(toArkFontStyle(sp.fontStyle))
                .decoration({ type: toArkDeco(sp.decoration), color: sp.decorationColor })
                .fontColor(this.slotIsHeader(slot) ? this.config.tableHeaderTextColor : (sp.color ?? this.config.tableTextColor))
                // 同上：Span 的行内底色只能用 textBackgroundStyle
                .textBackgroundStyle({ color: sp.backgroundColor ?? '#00000000' })
            }, (sp: RichSpan, index: number) => 's' + index.toString())
          }
          .lineHeight(this.config.bodyFontSize * 1.5)
          .width('100%')
          .textAlign(this.slotTextAlign(slot))
        }
      }
      // 内层 Column 同值 minHeight：背景铺满整行、内容顶对齐（未测出时 ??0 = 自然行高）
      .constraintSize({ minHeight: this.slotMinHeight(slot) })
      .justifyContent(FlexAlign.Start)
      .padding(this.config.tableCellPadding)
      .backgroundColor(this.slotBackground(slot))
      .alignItems(HorizontalAlign.Start)
    }
    // 关键：GridItem 也加 minHeight，Grid 才采纳该行行高，行内矮单元格被撑满
    .constraintSize({ minHeight: this.slotMinHeight(slot) })
    .onAreaChange((_oldV: Area, newV: Area) => {
      if (slot.rowSpan === 1) {
        const h: number = Number(newV.height)
        if (!Number.isNaN(h) && h > 0) {
          this.onRowMeasured(slot.rowIndex, h)
        }
      }
    })
  }

  /** 一组槽位 = 一个 Grid（表头、表体各一个） */
  @Builder
  private SlotGrid(slots: TableSlot[], options: GridLayoutOptions) {
    Grid(undefined, options) {
      ForEach(slots, (slot: TableSlot) => {
        this.CellView(slot)
      }, (slot: TableSlot) => slot.index.toString())
    }
    .columnsTemplate(this.columnsTemplate)
    .rowsGap(1)
    .columnsGap(1)
    .backgroundColor(this.config.tableBorderColor)
    .width('100%')
  }

  @Builder
  private TableContent() {
    Column() {
      if (this.headerSlots.length > 0) {
        this.SlotGrid(this.headerSlots, this.headerOptions)
        // 表头与表体之间的 1vp 分隔线（与 Grid 的 rowsGap 同色，视觉连续）
        Row()
          .width('100%')
          .height(1)
          .backgroundColor(this.config.tableBorderColor)
      }
      if (this.bodyScrollable) {
        Scroll() {
          Column() {
            this.SlotGrid(this.bodySlots, this.bodyOptions)
          }
          .width('100%')
        }
        .scrollable(ScrollDirection.Vertical)
        // 内层先滚，滚到边界再把手势交给页面，否则长表格会"卡住"页面滚动
        .nestedScroll({
          scrollForward: NestedScrollMode.SELF_FIRST,
          scrollBackward: NestedScrollMode.SELF_FIRST
        })
        .constraintSize({ maxHeight: this.config.tableMaxHeight })
        .scrollBar(BarState.Auto)
        .width('100%')
      } else {
        this.SlotGrid(this.bodySlots, this.bodyOptions)
      }
      // 最后一行下边框：rowsGap 只产生行间缝隙，最底部补 1vp 同色横线
      Row()
        .width('100%')
        .height(1)
        .backgroundColor(this.config.tableBorderColor)
    }
    .width('100%')
    // 列多时用最小宽度把内容撑开、交给外层横向滚动；窄表不加约束，宽度就是可用宽度
    .constraintSize({ minWidth: this.hScroll ? this.contentMinWidth : 0 })
  }

  build() {
    Column() {
      if (this.hScroll) {
        Scroll() {
          this.TableContent()
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
      } else {
        this.TableContent()
      }
    }
    .width('100%')
    .clip(true)
    .borderRadius(4)
    // 横向滚动只在"内容最小宽度确实超出可用宽度"时启用：先按原样渲染一帧，
    // 量到可用宽度后再决定是否套横向滚动容器 ——
    // 避免给每一张窄表都平白套一层滚动层（那会引入不必要的测量风险）。
    .onAreaChange((_oldV: Area, newV: Area) => {
      const w: number = Number(newV.width)
      if (!Number.isNaN(w) && w > 0 && Math.abs(w - this.availableWidth) > 0.5) {
        this.availableWidth = w
        this.hScroll = this.contentMinWidth > w
      }
    })
  }
}

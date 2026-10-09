/**
 * RichTextModels.ets
 * 富文本组件的数据模型（纯逻辑层，不依赖 ArkUI 类型，便于单测）
 * 颜色统一使用 string（#RRGGBB / #RRGGBBAA），组件层再映射为 ResourceColor
 */

/** 节点类型 */
export enum NodeType {
  ELEMENT = 0,
  TEXT = 1
}

/** 布局方式 */
export enum DisplayType {
  BLOCK = 0,
  INLINE = 1
}

/** 文本装饰 */
export enum DecorationStyle {
  NONE = 0,
  UNDERLINE = 1,
  LINE_THROUGH = 2,
  OVERLINE = 3
}

/** 对齐方式 */
export enum AlignStyle {
  START = 0,
  CENTER = 1,
  END = 2,
  JUSTIFY = 3
}

/** 字体样式 */
export enum FontStyleType {
  NORMAL = 0,
  ITALIC = 1
}

/** 计算后的样式（含继承），颜色均为 string */
export class RichStyle {
  color?: string
  fontSize?: number           // vp
  fontWeight?: number          // 100-900
  fontStyle?: FontStyleType
  decoration?: DecorationStyle
  decorationColor?: string
  lineHeight?: number          // 倍数
  letterSpacing?: number
  backgroundColor?: string
  fontFamily?: string
  textAlign?: AlignStyle
  marginTop?: number
  marginBottom?: number
  paddingLeft?: number
  paddingRight?: number
  verticalAlign?: string       // 'baseline' | 'sub' | 'super'
  width?: string
  height?: string
  borderRadius?: number

  constructor() {
    this.color = undefined
    this.fontSize = undefined
    this.fontWeight = undefined
    this.fontStyle = undefined
    this.decoration = undefined
    this.decorationColor = undefined
    this.lineHeight = undefined
    this.letterSpacing = undefined
    this.backgroundColor = undefined
    this.fontFamily = undefined
    this.textAlign = undefined
    this.marginTop = undefined
    this.marginBottom = undefined
    this.paddingLeft = undefined
    this.paddingRight = undefined
    this.verticalAlign = undefined
    this.width = undefined
    this.height = undefined
    this.borderRadius = undefined
  }
}

/** 解析树节点 */
export class RichNode {
  type: NodeType = NodeType.TEXT
  tag: string = ''
  attrs: Map<string, string> = new Map<string, string>()
  children: RichNode[] = []
  text: string = ''
  style: RichStyle = new RichStyle()
  display: DisplayType = DisplayType.INLINE
}

/** 行内文本片段（对应 ArkUI 的 Span） */
export class RichSpan {
  text: string = ''
  fontSize?: number
  color?: string
  fontWeight?: number
  fontStyle?: FontStyleType
  decoration?: DecorationStyle
  decorationColor?: string
  backgroundColor?: string
  fontFamily?: string
  baselineOffset?: number
  letterSpacing?: number

  constructor() {
    this.fontSize = undefined
    this.color = undefined
    this.fontWeight = undefined
    this.fontStyle = undefined
    this.decoration = undefined
    this.decorationColor = undefined
    this.backgroundColor = undefined
    this.fontFamily = undefined
    this.baselineOffset = undefined
    this.letterSpacing = undefined
  }
}

/** 行内分组：一段文本（可含多种 Span）或一张图片或一个链接 */
export class InlineGroup {
  kind: string = 'text'         // 'text' | 'image' | 'link'
  spans: RichSpan[] = []
  // image 相关
  src: string = ''
  alt: string = ''
  width?: number
  height?: number
  borderRadius?: number
  // link 相关
  href: string = ''
  marginTop: number = 0
  marginBottom: number = 0

  constructor() {
    this.width = undefined
    this.height = undefined
    this.borderRadius = undefined
  }
}

/** 表格单元格 */
export class TableCell {
  groups: InlineGroup[] = []
  isHeader: boolean = false
  colSpan: number = 1
  rowSpan: number = 1
  align: AlignStyle = AlignStyle.START
  /**
   * 单元格自身背景（td/th 内联 background-color）。
   * 组件层优先取它，取不到才回落到表头底色 / 斑马纹规则（见 cellBackground）。
   */
  backgroundColor?: string

  constructor() {
    this.backgroundColor = undefined
  }
}

/** 渲染块：由 RichTextBuilder 把解析树转换为扁平渲染模型 */
export class RenderBlock {
  kind: string = 'text'         // 'text' | 'heading' | 'image' | 'code' | 'quote' | 'list-item' | 'table' | 'hr'
  groups: InlineGroup[] = []
  /**
   * 混排文本按换行符拆分的"视觉行"（每行是一组 InlineGroup）。
   * 仅混排（多组或含 link/image）时由 RichTextBuilder 填充；纯文本单组为空数组。
   * 组件层逐行用独立 Flex 渲染：行内全是单行内容，顶对齐不会错位，
   * 避免"含 \n 的多行文本组"与单行链接/文本组在同一 Flex 中顶对齐错位。
   */
  groupLines: InlineGroup[][] = []
  children: RenderBlock[] = []  // quote / list-item 内部块
  marginTop: number = 0
  marginBottom: number = 0
  paddingLeft: number = 0
  lineHeight: number = 16       // vp，已乘字号
  textAlign: AlignStyle = AlignStyle.START
  fontSize: number = 16
  /**
   * 块级背景色（#RRGGBB / #RRGGBBAA）。
   * 来源：该块自身的内联 background-color；pre/blockquote 无内联色时由 Config 兜底。
   * 语义对齐浏览器：背景铺满整个块（含右侧留白），不继承给子行内内容。
   */
  backgroundColor?: string
  // heading
  headingLevel: number = 0
  // list
  listMarker: string = ''
  listLevel: number = 0
  // code
  codeLinesTokens: RichSpan[][] = []
  codeLang: string = ''
  // image
  imageSrc: string = ''
  imageAlt: string = ''
  imageWidth?: number
  imageHeight?: number
  imageIndex: number = 0
  // table
  tableRows: TableCell[][] = []
  tableCols: number = 0

  constructor() {
    this.imageWidth = undefined
    this.imageHeight = undefined
    this.backgroundColor = undefined
  }
}

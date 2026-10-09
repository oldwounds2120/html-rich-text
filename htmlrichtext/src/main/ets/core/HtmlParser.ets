/**
 * HtmlParser.ets
 * 手写递归下降 HTML 解析器（纯逻辑层，可单测）
 * 特性：
 *  - 支持嵌套标签、属性（含引号/无引号）、自闭合标签
 *  - HTML 实体解码（&amp; &lt; &gt; &nbsp; &#39; &#x27; 等）
 *  - 跳过注释、script、style 内容
 *  - 容错：未闭合标签自动补全，多余闭合标签忽略
 */
import { RichNode, NodeType, DisplayType } from './RichTextModels';

export class HtmlParser {
  private static readonly VOID_TAGS: Set<string> = new Set<string>([
    'br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track'
  ]);
  private static readonly SKIP_TAGS: Set<string> = new Set<string>(['script', 'style', 'template', 'noscript']);

  private static readonly ENTITIES: Map<string, string> = new Map<string, string>([
    ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', '\u00A0'],
    ['copy', '\u00A9'], ['reg', '\u00AE'], ['trade', '\u2122'], ['hellip', '\u2026'],
    ['mdash', '\u2014'], ['ndash', '\u2013'], ['laquo', '\u00AB'], ['raquo', '\u00BB'],
    ['middot', '\u00B7'], ['bull', '\u2022'], ['times', '\u00D7'], ['divide', '\u00F7'],
    ['cent', '\u00A2'], ['pound', '\u00A3'], ['yen', '\u00A5'], ['euro', '\u20AC'],
    ['sect', '\u00A7'], ['para', '\u00B6'], ['deg', '\u00B0'], ['plusmn', '\u00B1'],
    ['micro', '\u00B5'], ['sup2', '\u00B2'], ['sup3', '\u00B3'], ['frac12', '\u00BD'],
    ['frac14', '\u00BC'], ['frac34', '\u00BE'], ['lsquo', '\u2018'], ['rsquo', '\u2019'],
    ['ldquo', '\u201C'], ['rdquo', '\u201D'], ['prime', '\u2032'], ['Prime', '\u2033'],
    ['pi', '\u03C0'], ['sum', '\u2211'], ['radic', '\u221A'], ['infin', '\u221E'],
    ['le', '\u2264'], ['ge', '\u2265'], ['ne', '\u2260'], ['asymp', '\u2248']
  ]);

  private html: string
  private pos: number = 0

  private constructor(html: string) {
    this.html = html;
  }

  /** 解析 HTML 字符串，返回根节点（tag 为 #root，display 为 BLOCK） */
  static parse(html: string): RichNode {
    const root: RichNode = new RichNode();
    root.type = NodeType.ELEMENT;
    root.tag = '#root';
    root.display = DisplayType.BLOCK;
    const parser = new HtmlParser(html);
    parser.parseChildren(root, null);
    return root;
  }

  /**
   * 递归下降解析：解析 parent 的子节点，直到遇到 </untilTag> 或字符串结束。
   *
   * 逐字符扫描（this.pos 为当前游标），按 `<` 切分文本与标签：
   *  - 文本段（含实体解码）→ appendText 追加为 TEXT 节点（相邻文本自动合并）
   *  - <!-- --> 注释 → 整段跳过
   *  - <!DOCTYPE / <? ...> → 整段跳过
   *  - </tag> 闭合标签 → 若与 untilTag 匹配则 return（结束本次递归），
   *    否则视为多余闭合标签直接忽略（容错）
   *  - <tag> 开始标签 → 解析属性；命中 SKIP_TAGS（script/style 等）则跳到对应
   *    闭合标签处整体跳过；void 元素（br/img/hr 等）或自闭合 <tag/> 不入栈；
   *    其余标签 push 后递归解析其子节点（未闭合时递归到字符串末尾自动补全）
   *  - 非法的 `<`（如文本里的 <3）按普通字符处理
   *
   * 递归栈天然保证嵌套正确；错误写法（漏闭合/多闭合）通过"自动补全/忽略"容错，
   * 不会抛异常也不会中断解析。
   */
  private parseChildren(parent: RichNode, untilTag: string | null): void {
    const len: number = this.html.length;
    while (this.pos < len) {
      const lt: number = this.html.indexOf('<', this.pos);
      if (lt === -1) {
        this.appendText(parent, this.html.substring(this.pos));
        this.pos = len;
        break;
      }
      if (lt > this.pos) {
        this.appendText(parent, this.html.substring(this.pos, lt));
        this.pos = lt;
      }
      // 注释
      if (this.html.startsWith('<!--', this.pos)) {
        const end = this.html.indexOf('-->', this.pos + 4);
        this.pos = end === -1 ? len : end + 3;
        continue;
      }
      // DOCTYPE / 处理指令
      if (this.html.startsWith('<!', this.pos) || this.html.startsWith('<?', this.pos)) {
        const end = this.html.indexOf('>', this.pos);
        this.pos = end === -1 ? len : end + 1;
        continue;
      }
      const tagEnd: number = this.html.indexOf('>', this.pos);
      if (tagEnd === -1) {
        this.appendText(parent, this.html.substring(this.pos));
        this.pos = len;
        break;
      }
      const tagContent: string = this.html.substring(this.pos + 1, tagEnd).trim();
      // 闭合标签
      if (tagContent.startsWith('/')) {
        const name: string = tagContent.substring(1).trim().split(/\s+/)[0].toLowerCase();
        this.pos = tagEnd + 1;
        if (untilTag !== null && name === untilTag) {
          return;
        }
        continue;
      }
      // 自闭合
      const isSelfClose: boolean = tagContent.endsWith('/');
      const content: string = isSelfClose ? tagContent.substring(0, tagContent.length - 1) : tagContent;
      // 标签名允许连字符/下划线/点/冒号（Web Components 的 <my-widget>、
      // 命名空间标签 <o:p>、模板引擎残留的 <el-table-column> 等）。
      // 旧写法 ^[a-zA-Z][a-zA-Z0-9]* 遇 '-' 即截断 → <my-widget> 被当成 <my> 打开，
      // 闭合标签 </my-widget> 与栈中的 'my' 不匹配 → 永不闭合、吞掉后续全部内容。
      const nameMatch: RegExpMatchArray | null = content.match(/^[a-zA-Z][a-zA-Z0-9_.:-]*/);
      if (nameMatch === null) {
        // 非合法标签，按文本处理
        this.appendText(parent, '<');
        this.pos += 1;
        continue;
      }
      const name: string = nameMatch[0].toLowerCase();
      this.pos = tagEnd + 1;
      const attrs: Map<string, string> = this.parseAttrs(content.substring(nameMatch[0].length));
      const node: RichNode = new RichNode();
      node.type = NodeType.ELEMENT;
      node.tag = name;
      node.attrs = attrs;
      if (HtmlParser.SKIP_TAGS.has(name)) {
        const closeTag: string = '</' + name + '>';
        const closeIdx: number = this.html.toLowerCase().indexOf(closeTag, this.pos);
        this.pos = closeIdx === -1 ? len : closeIdx + closeTag.length;
        continue;
      }
      if (isSelfClose || HtmlParser.VOID_TAGS.has(name)) {
        parent.children.push(node);
        continue;
      }
      parent.children.push(node);
      this.parseChildren(node, name);
    }
  }

  /**
   * 解析标签属性字符串（name="v" / name='v' / name=v / 裸属性 name）。
   * 属性名统一小写，值支持双引号/单引号/无引号三种写法，键存入 Map 供后续取用。
   */
  private parseAttrs(attrStr: string): Map<string, string> {
    const attrs: Map<string, string> = new Map<string, string>();
    const re: RegExp = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrStr)) !== null) {
      const value: string = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
      attrs.set(m[1].toLowerCase(), value);
    }
    return attrs;
  }

  /**
   * 追加文本节点：实体解码后，若父节点最后一个子节点是 TEXT 则直接拼接
   * （避免 <p>a<b>x</b>c</p> 的 "a" "c" 产生零散节点），否则新建 TEXT 节点。
   */
  private appendText(parent: RichNode, raw: string): void {
    if (raw.length === 0) {
      return;
    }
    const text: string = HtmlParser.decodeEntities(raw);
    if (text.length === 0) {
      return;
    }
    const last: RichNode | undefined = parent.children.length > 0 ? parent.children[parent.children.length - 1] : undefined;
    if (last !== undefined && last.type === NodeType.TEXT) {
      last.text += text;
      return;
    }
    const node: RichNode = new RichNode();
    node.type = NodeType.TEXT;
    node.text = text;
    parent.children.push(node);
  }

  /**
   * HTML 实体解码：支持
   *  - 数字实体 &#39; / &#x27;（十进制 / 十六进制，转 Unicode 码点）
   *  - 命名实体 &amp; &lt; &gt; &nbsp; 等（查 ENTITIES 表，未收录的原样保留）
   */
  static decodeEntities(input: string): string {
    return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match: string, entity: string): string => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code: number = parseInt(entity.substring(2), 16);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      if (entity.startsWith('#')) {
        const code: number = parseInt(entity.substring(1), 10);
        return Number.isNaN(code) ? match : String.fromCodePoint(code);
      }
      const v: string | undefined = HtmlParser.ENTITIES.get(entity.toLowerCase());
      return v !== undefined ? v : match;
    });
  }
}

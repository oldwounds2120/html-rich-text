/**
 * RichTextDemoPage.ets - 使用示例（Demo）
 *
 * 使用方法（源码方式，推荐）：
 *  1. 把整个仓库复制到你的工程，或仅复制 src/main/ets/htmlrichtext 目录
 *  2. 复制本文件到 entry/src/main/ets/pages/RichTextDemoPage.ets
 *  3. 在 main_pages.json 中注册：{ "src": "pages/RichTextDemoPage" }
 *  4. 编译运行即可看到所有标签的渲染效果
 *
 * 若已通过 ohpm 安装三方库（后续发布后）：
 *  import { HtmlRichText, RichTextConfig } from 'htmlrichtext';
 */
import { HtmlRichText, RichTextConfig } from '../htmlrichtext/Index';
import { promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

const DEMO_HTML: string = `
<h2>鸿蒙 NEXT 富文本组件 Demo</h2>
<p>这是一个<strong>自定义富文本组件</strong>，支持<em>斜体</em>、<u>下划线</u>、<del>删除线</del>、
<mark>高亮</mark>、行内<code>code</code>、上标 x<sup>2</sup>、下标 H<sub>2</sub>O，
以及<a href="https://www.harmonyos.com" style="color:#1E6FFF">超链接</a>。</p>
<p style="color:#FF6B00;font-size:18px;font-weight:bold;">这一行演示了内联 style：橙色、18号、加粗。</p>

<h3>图片（点击可全屏预览）</h3>
<figure>
  <img src="https://picsum.photos/seed/harmony/800/450" alt="示例图片 1" />
  <figcaption style="text-align:center;color:#888;font-size:13px;">图 1：picsum 占位图（可替换成你的图片地址）</figcaption>
</figure>

<h3>无序列表</h3>
<ul>
  <li>纯 ArkUI 原生渲染（Text + Span），不依赖 WebView</li>
  <li>样式通过 RichTextConfig 集中配置，灵活可控</li>
  <li>支持嵌套列表：
    <ul>
      <li>二级列表项 A</li>
      <li>二级列表项 B</li>
    </ul>
  </li>
</ul>

<h3>有序列表</h3>
<ol>
  <li>第一步：复制组件目录到工程</li>
  <li>第二步：在页面中引用 RichText</li>
  <li>第三步：传入 HTML 字符串</li>
</ol>

<h3>引用块</h3>
<blockquote>
  <p>路漫漫其修远兮，吾将上下而求索。</p>
  <p>—— 屈原《离骚》</p>
</blockquote>

<h3>代码块（支持轻量语法高亮、横向滚动）</h3>
<pre><code class="language-typescript">// 示例：ArkTS 代码
interface User {
  name: string;
  age: number;
}

function greet(user: User): string {
  const msg = \`Hello, \${user.name}!\`;
  console.log(msg); // 输出问候语
  return msg;
}
</code></pre>

<h3>表格</h3>
<table>
  <tr><th>框架</th><th>类型</th><th>性能</th></tr>
  <tr><td>Web</td><td>WebView 渲染</td><td>一般</td></tr>
  <tr><td>RichText</td><td>系统富文本</td><td>好但样式受限</td></tr>
  <tr><td><strong>本组件</strong></td><td>ArkUI 原生</td><td>好且完全可控</td></tr>
</table>

<h3>表格（支持 colspan / rowspan 合并）</h3>
<table>
  <tr><th colspan="3">2026 上半年各平台渲染能力对比</th></tr>
  <tr><th>平台</th><th>样式可控性</th><th>备注</th></tr>
  <tr>
    <td rowspan="2">WebView</td>
    <td>完全可控</td>
    <td>依赖前端实现</td>
  </tr>
  <tr>
    <td>受 WebView 版本影响</td>
    <td>首屏较慢</td>
  </tr>
  <tr>
    <td>系统 RichText</td>
    <td>受限</td>
    <td>自定义样式难落地</td>
  </tr>
  <tr>
    <td><strong>本组件</strong></td>
    <td colspan="2">ArkUI 原生渲染，样式与解析层完全开放</td>
  </tr>
</table>

<h3>表格（宽表：列多时在本区域内独立横向滚动）</h3>
<table>
  <tr><th>编号</th><th>标签</th><th>类型</th><th>是否支持</th><th>实现方式</th><th>备注</th></tr>
  <tr><td>1</td><td>p</td><td>块级</td><td>是</td><td>Text + Span</td><td>段落间距可配</td></tr>
  <tr><td>2</td><td>blockquote</td><td>块级</td><td>是</td><td>Row 左边框</td><td>背景色内联优先</td></tr>
  <tr><td>3</td><td>pre</td><td>块级</td><td>是</td><td>Scroll 横向滚动</td><td>带轻量高亮</td></tr>
  <tr><td>4</td><td>table</td><td>块级</td><td>是</td><td>Grid + 槽位矩阵</td><td>支持合并单元格</td></tr>
</table>

<h3>表格（长表：滚动时表头固定）</h3>
<table>
  <tr><th>序号</th><th>检查项</th><th>结果</th></tr>
  <tr><td>1</td><td>解析器容错</td><td>通过</td></tr>
  <tr><td>2</td><td>内联样式优先级</td><td>通过</td></tr>
  <tr><td>3</td><td>背景色落点</td><td>通过</td></tr>
  <tr><td>4</td><td>跨列合并定位</td><td>通过</td></tr>
  <tr><td>5</td><td>跨行合并占位</td><td>通过</td></tr>
  <tr><td>6</td><td>行尾补位空单元</td><td>通过</td></tr>
  <tr><td>7</td><td>列数统计（含 rowspan 堆叠）</td><td>通过</td></tr>
  <tr><td>8</td><td>表头行识别</td><td>通过</td></tr>
  <tr><td>9</td><td>斑马纹</td><td>通过</td></tr>
  <tr><td>10</td><td>单元格内联样式</td><td>通过</td></tr>
  <tr><td>11</td><td>宽表横向滚动</td><td>通过</td></tr>
  <tr><td>12</td><td>表头固定</td><td>通过</td></tr>
  <tr><td>13</td><td>嵌套列表</td><td>通过</td></tr>
  <tr><td>14</td><td>代码块高亮</td><td>通过</td></tr>
  <tr><td>15</td><td>图片自适应</td><td>通过</td></tr>
  <tr><td>16</td><td>链接点击</td><td>通过</td></tr>
  <tr><td>17</td><td>实体解码</td><td>通过</td></tr>
  <tr><td>18</td><td>未闭合标签补全</td><td>通过</td></tr>
  <tr><td>19</td><td>script/style 跳过</td><td>通过</td></tr>
  <tr><td>20</td><td>空标签兜底</td><td>通过</td></tr>
  <tr><td>21</td><td>长表滚动性能</td><td>通过</td></tr>
  <tr><td>22</td><td>表头常驻可见</td><td>通过</td></tr>
</table>

<hr />
<p style="text-align:center;color:#999;font-size:13px;">— 全文完 —</p>
`;

@Entry
@Component
struct RichTextDemoPage {
  @State html: string = DEMO_HTML
  private config: RichTextConfig = new RichTextConfig()
  private context = getContext(this) as common.UIAbilityContext

  aboutToAppear(): void {
    // 表格：列多时表格区域独立横向滚动；长表限高 + 表头固定
    this.config.tableMinColumnWidth = 80   // 列数 × 80vp 超出可用宽度 → 表格内横向滚动
    this.config.tableMaxHeight = 400       // 表格最高 400vp，超出由表体内部纵向滚动
    this.config.tableStickyHeader = true   // 滚动时表头常驻可见
  }

  private onLinkClick(url: string): void {
    console.info(`[RichTextDemo] 链接点击: ${url}`);
    // 方式一：用系统浏览器打开（推荐）
    try {
      this.context.openLink(url);
    } catch (e) {
      console.error(`[RichTextDemo] 打开链接失败: ${JSON.stringify(e)}`);
      promptAction.showToast({ message: `链接：${url}` });
    }
  }

  private onImageClick(index: number, url: string): void {
    console.info(`[RichTextDemo] 图片点击 第${index}张: ${url}`);
  }

  private onImageLoadError(url: string): void {
    console.error(`[RichTextDemo] 图片加载失败: ${url}`);
  }

  build() {
    Column() {
      // 顶部标题栏
      Row() {
        Text('富文本 Demo')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
      }
      .width('100%')
      .height(48)
      .justifyContent(FlexAlign.Center)
      .backgroundColor(Color.White)

      // 正文区
      Scroll() {
        Column() {
          HtmlRichText({
            html: this.html,
            config: this.config,
            baseUrl: '',
            onLinkClick: (url: string) => this.onLinkClick(url),
            onImageClick: (index: number, url: string) => this.onImageClick(index, url),
            onImageLoadError: (url: string) => this.onImageLoadError(url)
          })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 24 })
        .alignItems(HorizontalAlign.Start)
      }
      .scrollBar(BarState.Auto)
      .width('100%')
      .layoutWeight(1)
      .backgroundColor('#F7F8FA')
    }
    .width('100%')
    .height('100%')
  }
}

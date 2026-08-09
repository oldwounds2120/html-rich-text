# 项目交接文档（HANDOFF）

> 生成时间：2026-08-04 21:30
> 用途：换电脑继续开发本项目的完整上下文备份
> 项目：鸿蒙 NEXT 自定义 HTML 富文本解析组件（开源）

---

## 一、项目概况

| 项目 | 内容 |
| ---- | ---- |
| 项目名称 | harmony-rich-text（包名 `htmlrichtext`） |
| 仓库地址 | https://github.com/oldwounds2120/harmony-rich-text |
| 官方网站 | https://www.htmlrichtext.com/（文档 / API / 更新日志） |
| 开源协议 | Apache-2.0（含 NOTICE 版权声明） |
| 作者 | Chen Wen（陈文 <oldwounds2120@163.com>） |
| 定位 | 不依赖 WebView 和系统 RichText 的自研 HTML 富文本组件，专为资讯/文章详情页设计 |
| 技术栈 | HarmonyOS NEXT（API 12+）、ArkTS、ArkUI、手写 HTML 解析器 |
| 本地路径 | `C:/Users/Administrator/WorkBuddy/2026-08-04-11-17-05/RichTextComponent` |

**为什么自研**：用户试过 `Web` 组件（重、加载慢、交互不原生）和系统 `RichText`（样式控制弱、图片无法自定义加载/点击预览、pre/code 标签支持不全），均不满足需求。

---

## 二、当前 Git 状态（重要）

### 提交历史（13 个，全部已推送 origin/main）

```
ae3bad0 refactor: split htmlrichtext source into components/ and core/   ← HEAD
4a12214 chore: update repo URL after GitHub rename
7b2cbb9 feat: adopt ohpm third-party library (HAR) standard structure
60924d1 docs: add comments to remaining helpers; fix string index in parseColor
82b7a31 docs: add detailed comments to core logic
45c89cd docs: clarify API 12+ requirement and LengthMetrics compatibility
59ed036 fix: wrap Span.baselineOffset with LengthMetrics for API 12+
0db2d4f docs: fix README title to HtmlRichText
978c0b5 refactor: rename richtext dir to htmlrichtext for consistency
4bb9c23 refactor: rename RichText.ets to HtmlRichText.ets for consistency
c89328a fix: ArkTS compiler compatibility
c2ad9b5 chore: switch license from MIT to Apache-2.0
81e9da2 feat: HarmonyOS NEXT custom HTML rich text component
```

### ⚠️ 待办事项（换电脑后第一件事）

1. **推送 tag `v1.0.0` 到远程**（已本地创建，远程还没有）：
   ```bash
   git push origin v1.0.0
   ```
2. 工作区有一个**未跟踪文件** `src/main/ets/htmlrichtext.zip`（用户自己打的组件压缩包，用于复制到工程）。保留即可，但注意不要 `git add -A` 把它提交上去（如需提交请先确认意图）。
3. 网络不稳定时 GitHub 443 端口常超时，推送失败后本地提交不会丢，等网络恢复重试即可。

---

## 三、目录结构（当前最终形态）

```
RichTextComponent/                  # 仓库根
├── Index.ets                       # 包级统一入口（oh-package.json5 的 main 指向）
├── oh-package.json5                # ohpm 包元数据：name=htmlrichtext, v1.0.0, Apache-2.0
├── README.md                       # 完整集成文档（目录结构/快速开始/API/FAQ）
├── CHANGELOG.md                    # 版本变更记录（v1.0.0）
├── LICENSE                         # Apache-2.0 官方全文
├── NOTICE                          # 版权归属声明（Apache 规范）
├── .gitignore                      # 忽略 DevEco/.hvigor/build/oh_modules 等
├── src/main/ets/htmlrichtext/      # 组件源码（HAR 标准）
│   ├── Index.ets                   # 源码层统一导出
│   ├── components/                 # UI 组件层（依赖 ArkUI）
│   │   ├── HtmlRichText.ets        # 主组件（渲染 + 图片预览 + 回调）
│   │   └── ImagePreviewDialog.ets  # 全屏图片预览弹窗（Swiper + 双击缩放）
│   └── core/                       # 纯逻辑层（零 ArkUI 依赖，可 Node 单测）
│       ├── HtmlParser.ets          # 手写递归下降 HTML 解析器
│       ├── RichTextBuilder.ets     # 渲染树构建器：样式继承/inline 分组
│       ├── RichTextModels.ets      # 数据模型
│       ├── RichTextConfig.ets      # 集中样式配置
│       └── SimpleCodeHighlighter.ets # 轻量语法高亮
├── demo/
│   └── RichTextDemoPage.ets        # 完整示例页面
└── test/
    └── run.ts                      # 逻辑层单测（53 条断言）
```

---

## 四、功能特性

- **标签支持**：`h1-h6` / `p` / `strong/b` / `em/i` / `u/ins` / `del/s/strike` / `mark` / `small` / `big` / `sub` / `sup` / `a` / `img` / `figure` / `figcaption` / `ul` / `ol` / `li`（嵌套）/ `blockquote` / `pre` / `code` / `kbd` / `samp` / `tt` / `table`（含 colspan/rowspan）/ `hr` / `br` / `center` / `section` / `article` 等
- **样式控制**：三层级联（父级继承 → 标签默认 → 内联 style）；支持内联 CSS：`color` `font-size` `font-weight` `font-style` `text-decoration` `line-height` `letter-spacing` `text-align` `margin` `padding` `border-radius` `background-color` `vertical-align` `width` `height`
- **图片**：占位背景、等比缩放、加载失败回调、点击全屏预览（Swiper 滑动 + 双击缩放）
- **代码块**：横向滚动 + 轻量语法高亮（注释/字符串/关键字/数字/函数）
- **HTML 实体**：`&amp;` `&lt;` `&gt;` `&nbsp;` `&#39;` `&#x27;` 等
- **容错**：未闭合标签自动补全、多余闭合标签忽略、`script/style` 内容跳过
- **性能**：解析和渲染模型构建只在 `html` 变化时执行一次，渲染用 ForEach 递归生成原生组件

---

## 五、快速开始

### 方式 A：ohpm 安装（三方库发布后）

```json5
// 工程根目录 oh-package.json5
"dependencies": { "htmlrichtext": "^1.0.0" }
```
```ts
import { HtmlRichText, RichTextConfig } from 'htmlrichtext';
```

### 方式 B：源码复制（现在就能用）

把 `src/main/ets/htmlrichtext` 整个目录（含 components/ 和 core/ 子目录）复制到工程 `entry/src/main/ets/htmlrichtext`：
```ts
import { HtmlRichText, RichTextConfig } from '../htmlrichtext/Index';
```

### 页面使用示例

```ts
@Entry
@Component
struct ArticlePage {
  @State html: string = '<h2>标题</h2><p>正文内容<strong>加粗</strong></p>'
  private config: RichTextConfig = new RichTextConfig()

  build() {
    Scroll() {
      Column() {
        HtmlRichText({
          html: this.html,                     // HTML 变化自动重新解析
          config: this.config,                 // 样式配置（可空）
          baseUrl: 'https://cdn.example.com',  // 相对图片/链接前缀（可选）
          onLinkClick: (url: string) => {},
          onImageClick: (index: number, url: string) => {},
          onImageLoadError: (url: string) => {}
        })
      }.width('100%').padding(16)
    }
  }
}
```

### 常用配置

```ts
const config = new RichTextConfig();
config.bodyFontSize = 17;             // 正文字号
config.bodyLineHeight = 1.8;          // 行高倍数
config.paragraphSpacing = 14;         // 段间距
config.headingSizes = [22,20,18,17,16,15];
config.linkColor = '#1E6FFF';         // 链接色
config.codeBlockBackground = '#F6F8FA';
config.enableCodeHighlight = true;    // 代码高亮开关
config.enableImagePreview = true;     // 图片全屏预览开关
config.imageRadius = 8;
```

---

## 六、环境要求

- 仅支持 **HarmonyOS NEXT（API 12+）**，`compileSdkVersion >= 12`
- `Span.baselineOffset` 参数类型 API 12 起为 `LengthMetrics`（组件已适配：`LengthMetrics.vp(...)`）
- 如需兼容 API 11：把 `HtmlRichText.ets` 中 `.baselineOffset(LengthMetrics.vp(sp.baselineOffset ?? 0))` 改回 `.baselineOffset(sp.baselineOffset ?? 0)`（ArkTS 无条件编译，二选一）

---

## 七、逻辑层单测

```bash
# 将 src/main/ets/htmlrichtext/core 下 5 个逻辑层 .ets 复制为 .ts（并给相对 import 补 .ts 扩展名），
# 连同 test/run.ts 一起用 Node 22+ 运行
cd test
node --experimental-transform-types run.ts
# 结果：通过 53，失败 0
```

---

## 八、发布进度（待办）

已决策：**先发 GitHub Release，再发 ohpm**（Release 零成本可逆作版本锚点；ohpm 发布不可逆，版本只能升不能撤）。

### 进行到：GitHub Release 前一步
- [x] tag `v1.0.0` 本地已创建
- [ ] **推送 tag 到远程**：`git push origin v1.0.0`
- [ ] GitHub 网页：Releases → Create a new release → 选 v1.0.0 → 标题「v1.0.0 - 首个稳定版」→ 说明复制 CHANGELOG.md 的 [1.0.0] 内容 → Publish

### 后续：ohpm 发布
- [ ] 注册 https://ohpm.openharmony.cn 账号
- [ ] 生成 RSA 公钥：`ssh-keygen -m PEM -t RSA -b 4096 -f ~/.ssh_ohpm/mykey`，上传 `mykey.pub` 到「个人中心 → 认证管理」
- [ ] 在 ohpm 中心仓搜索确认 `htmlrichtext` 包名未被占用；被占用则改名（`@用户名/htmlrichtext` 或 `htmlrichtext-harmony`，同步改 oh-package.json5 的 name）
- [ ] DevEco 中作为 HAR 模块 Build 验证
- [ ] 包根目录执行 `ohpm publish`

### ⚠️ 竞品提醒
ohpm 市场已有同类知名库 `@ohasasugar/hp-richtext`。建议在 README 加差异化对比表（代码高亮/表格 colspan+rowspan/图片全屏预览/53 条单测）。

---

## 九、关键技术决策（为什么这么写）

1. **逻辑层与 UI 层分离**：解析/构建/高亮是纯 TS（零 ArkUI 依赖），颜色用 string，组件层映射 ResourceColor → 逻辑层可在 Node 直接单测
2. **连续行内内容合并成一个 Text**：`<p>一段<b>加粗</b>文字</p>` 必须合并，否则段落断裂、英文单词被截断（processContainer 方案）
3. **图片/链接独立成 Flex 子项**：Span 不能放图片、不能响应点击
4. **代码块按行渲染 + 空格转 `\u00A0`**：保证横向滚动不换行
5. **样式三层级联**：继承 → 标签默认 → 内联 style；strong 取 `max(600, 父级)` 防嵌套回退
6. **嵌套列表**：栈结构 + 有序序号计数器；`<p>` 内的块级子标签分段递归

---

## 十、踩坑记录（改代码前必读）

1. **ArkTS 比 TS 严格得多**，以下写法全部禁止：
   - 静态方法内用 `this` 调同类静态方法 → 用类名 `SimpleCodeHighlighter.xxx()`
   - 字符串下标 `str[i]` → 用 `str.charAt(i)`
   - struct 名与内置组件重名（如 `RichText`）→ 改名
   - `@State scale` 与基类内置属性冲突 → 改名（本项目用 `zoomScale`）
2. **JS/TS 注释里不能出现 `/*` 序列**（嵌套注释导致语法错乱）——写注释描述代码块时用 `/* ... */` 要小心，本项目曾因 `font-*/` 提前结束块注释
3. **API 12 起 `Span.baselineOffset` 参数类型从 number 变成 LengthMetrics**——写组件时直接包 `LengthMetrics.vp()` 最稳
4. `HtmlParser` SKIP 逻辑的 closeTag 必须拼完整 `'</' + name + '>'`
5. 块容器内连续 inline 内容不合并会导致段落断裂（见第九节第 2 条）
6. 测试脚本复制到 Node 跑时，相对 import 必须补 `.ts` 扩展名（ESM 模式），且注意别把已有 `.ts` 重复替换成 `.ts.ts`

---

## 十一、用户环境与习惯

- Git 账号：陈文 <oldwounds2120@163.com>（git 2.47.1，gh CLI 未装）
- 网络：访问 GitHub 不稳定（443 端口频繁超时/重置），推送失败重试即可，提交不会丢
- 用户偏好：要求代码注释完整（所有方法都要有注释）、结构规范专业（已按 ohpm HAR 规范 + components/core 分层）、喜欢「先问方案再动手」的协作方式
- 用户工程：E:/DevEcoStudioProjects/luweipaiBlog（同事也在用此组件，报错会反馈 ArkTS 兼容问题）

---

## 十二、换电脑后恢复步骤

1. `git clone https://github.com/oldwounds2120/harmony-rich-text.git`
2. 读本 HANDOFF.md（README.md 有完整用户文档）
3. 检查待办（第八节）：推送 tag、发 Release、发 ohpm
4. 本地跑单测验证环境：`cd test && node --experimental-transform-types run.ts`（需先按第七节处理 .ets→.ts 和扩展名）

---
title: v1.0.2 发布说明
date: 2026-08-09
---

# v1.0.2 发布说明

> **发布于 2026-08-09 · 已推送 ohpm 中心仓（审核中）**
> 升级方式：`ohpm i htmlrichtext@1.0.2`（或更新依赖中的版本号）
> 🌐 官方网站：<https://www.htmlrichtext.com/>（完整文档 / API 参考 / 历史版本）

v1.0.2 是一次**功能 + 稳定性的集中升级**：新增链接点击行为开关，并一次性修复表格渲染、
引用块高度、混排链接换行三组问题（其中两组来自使用方的实测反馈）。

---

## ✨ 新增功能

### 链接打开浏览器开关 `linkOpenBrowser`

此前点击 `<a>` 链接是否打开浏览器，完全取决于使用方是否写 `onLinkClick` 回调（样板代码较多）。
v1.0.2 起组件**默认用系统浏览器打开链接**，并可通过配置项统一控制：

```ts
const config = new RichTextConfig();
config.linkOpenBrowser = true;   // 默认值：true。未传 onLinkClick 时点击链接打开系统浏览器
config.linkOpenBrowser = false;  // 置 false 关闭默认跳转，点击链接无反应
```

点击行为优先级：

| 场景 | 行为 |
| ---- | ---- |
| 传了 `onLinkClick` | 以回调为准，组件不跳转（可在回调里做弹窗 / 复制 / 站内跳转等自定义行为） |
| 未传回调 + `linkOpenBrowser = true`（默认） | 组件用系统浏览器打开链接 |
| 未传回调 + `linkOpenBrowser = false` | 点击无反应 |

> 链接地址仅放行 `http/https` 协议，伪协议在解析层与渲染层双重拦截。

---

## 🔧 问题修复

### 表格（严重：整表不渲染 / 行高与边框）

- **表格不渲染**：后端常见的 `<table><tbody><tr>` 结构与 `<div class="entry-content">`
  包裹正文时表格整体丢失、内容被压成纯文本。
  - 递归穿透 `thead / tbody / tfoot` 等容器收集 `tr`；
  - 新增 `processBlock` 统一分发块级标签，容器内标题 / 代码块 / 列表等不再退化；
  - `isBlockTag` 补充 `h1~h6`，div 内标题不再退化为正文；
  - 列数按 `colspan` 展开统计，支持跨列单元格。
- **单元格行高不撑满**：某格换行变高时同行的矮格背景铺不满整行。表格改由独立组件
  `TableBlockView` 渲染，通过 `onAreaChange` 测量每行最高单元格，行内全部撑满。
- **最后一行缺失下边框**：Grid 底部补 1vp 同色横线。

### 引用块（高度异常，实测 669vp）

- **引用块被撑到异常高**：左侧竖线原用 `height('100%')` 的子组件实现，在 Scroll 无界
  高度约束下被解析成最大可用高度。改为 `Row` 边框绘制竖线（贴满实际高度、不参与测量），
  高度恢复由内容驱动。
- **背景内部多余空白**：内部首段 `marginTop`、末段 `marginBottom` 清零，段间距不再
  落在背景内部。

### 混排链接换行顶对齐错位

`文本 + <br> + 链接/图片` 混排时（如 `安装Vagrant<br>官网：https://www.vagrantup.com/`），
含换行的文本组与单行链接在同一 Flex 顶对齐会把链接顶到上一行。v1.0.2 起按"视觉行"拆分
渲染：构建层按 `\n` 拆行，组件层逐行独立 Flex，行内顶对齐基线一致；链接内嵌 `<br>`
拆段后每段保留 `href` 仍可点击。

---

## ⚙️ 配置项变化

**新增 6 个 `RichTextConfig` 配置项：**

| 配置项 | 默认值 | 说明 |
| ---- | ---- | ---- |
| `linkOpenBrowser` | `true` | 链接点击默认打开系统浏览器（未传 `onLinkClick` 时生效） |
| `tableHeaderTextColor` | `#1A1A1A` | 表头文字色 |
| `tableHeaderTextWeight` | `600` | 表头字重 |
| `tableEvenRowBackground` | `#FFFFFF` | 偶数行背景（斑马纹） |
| `tableOddRowBackground` | `#FFFFFF` | 奇数行背景（斑马纹） |
| `tableMinRowHeight` | `0` | 表格最小行高（0 = 不设下限） |

> 原有配置项与 API 全部向后兼容，无破坏性变更。

---

## 📊 质量数据

- 逻辑层单元测试：**91 条断言全部通过**（新增混排换行拆分、引用块边距、链接开关等 24 条）
- 修复均由使用方实测反馈驱动，覆盖真实博客正文场景

---

## 🧭 官网信息同步提醒

- 首页统计"逻辑层单测断言"由 **53 → 91**；
- 首页当前版本徽标 **1.0+ → 1.0.2**；
- 快速开始示例中的 `onLinkClick` 注释可补充：不传回调时组件默认打开系统浏览器。

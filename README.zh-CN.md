# BurnGuard

**开源的 Claude Design 替代方案，直接使用你已经在付费的 Claude Code 或 Codex。**

![一句提示词生成 BurnGuard 落地页，再在画布上改写标题](doc/images/burnguard-demo.gif)

*录制于 v0.5.25，使用 Claude Code（Sonnet,LOW 推理强度），未使用设计系统。耗时五分钟的生成过程已加速，其余均为实时。*

[![Latest release](https://img.shields.io/github/v/release/ashmoonori-afk/BurnGuard)](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) [![Downloads](https://img.shields.io/github/downloads/ashmoonori-afk/BurnGuard/total)](https://github.com/ashmoonori-afk/BurnGuard/releases) [![License](https://img.shields.io/github/license/ashmoonori-afk/BurnGuard)](LICENSE) [![GitHub stars](https://img.shields.io/github/stars/ashmoonori-afk/BurnGuard?style=social)](https://github.com/ashmoonori-afk/BurnGuard/stargazers)

⭐ 如果 BurnGuard 帮你节省了时间，欢迎点一个 Star，让更多人发现它。

用 AI 制作网站、幻灯片和图形，在画布上继续打磨，并保留所有文件。BurnGuard 是适用于 Windows 和 macOS 的本地设计工作区。接入你的 Claude Code 或 Codex，选择设计系统，在实时预览旁边工作。项目和可复用的设计系统保存在你的电脑上；AI 请求会发送给你所选的服务提供商。

[下载应用](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) · [文档](doc/README.md) · [English](README.md) · [韩语](README.ko.md)

## 对比

*截至 2026-09-28，依据各产品的公开页面或 README（[来源](#对比来源)）。*

| | BurnGuard | Claude Design | OpenDesign |
|---|---|---|---|
| 费用模式 | 免费，Apache-2.0。生成通过你自己的 Claude Code 或 Codex CLI 及对应服务商账号运行 | 包含在付费 Claude 套餐中，使用套餐的用量额度，可选额外用量 | 免费，Apache-2.0。自带编码代理 CLI 或 API 密钥；可选付费 OpenDesign Cloud 模型 |
| 文件位置 | 在你的电脑上（`~/.burnguard`） | Claude 的托管工作区；可导出或保存为文件夹 | 本地优先的桌面应用；支持 Docker 自托管 |
| 设计系统规则 | 内置 41 个主题，每个都带导航、首屏（hero）和页脚的布局规则；可从文件、网站、代码仓库或 Figma 添加自己的 | 基于你的代码库和设计文件构建；管理员可锁定一个已批准的系统 | `DESIGN.md` 设计系统、技能和插件 |
| 画布编辑 | 在画布上选择、缩放、旋转，调整字体排印、间距和颜色；固定位置的批注 | 行内批注、直接编辑文字、生成式滑块；拖动、缩放和对齐 | 在沙盒预览旁与代理迭代；批注模式编辑部分已上线（据其路线图） |
| 导出格式 | HTML ZIP、PDF、PPTX、PNG、PNG 打包、SVG（Logo）、交接包、Cafe24 与 Imweb 包 | PDF、PPTX、独立 HTML、文件夹；Canva 等连接器；Claude Code 交接 | HTML、PDF、PPTX、ZIP、Markdown、MP4 |
| 发布 | 使用你自己的令牌发布到你自己的 Vercel 账号（在设置中保存令牌并验证导出后，一键即可） | 组织范围内的链接；包括 Vercel 在内的连接器 | 其 README 中未说明 |
| 操作系统 | Windows 10/11 x64；搭载 Apple 芯片的 macOS 14 及以上 | 网页和 Claude 应用、Claude Code | macOS（Apple 芯片和 Intel）、Windows x64；Linux 需从源码运行 |

![BurnGuard 网站工作区，含对话面板、模型控件和画布中的 SONNEL 示例](doc/images/readme-website-workspace.png)

*真实编辑器中显示的内置 SONNEL 网站。在左侧选择模型，在右侧查看结果，并在预览、编辑和批注之间切换。*

## 从设计方向开始

在引导流程中选择格式、描述项目，并选择一个已注册的设计系统。可以搜索目录，也可以刷新以获取新注册的系统。你也可以不使用设计系统直接开始。

内置目录包含 **41 个主题**，其中 **31 个为原创主题**。每个主题都有独特的导航、首屏和页脚组合，除了字体排印和颜色外，还有各自的位置、比例和响应式规则。这些布局改编自 Supahero、Navbar Gallery 和 Footer Design 的参考设计，每个主题都记录了来源。原创示例系统和提示词预设同样带有布局规则。你可以从受支持的文件、网站、代码仓库或 Figma 来源添加自己的系统，审阅并发布后用于项目。[浏览 41 个参考布局](<design system themes/>)

![项目引导流程，含设计系统搜索、刷新和选择控件](doc/images/readme-design-system-picker.png)

*真实应用中的设计系统选择界面。没有预览的系统仍可按名称选择。*

打开某个系统的概览，可以查看它的导航、首屏和页脚规则。**方向设置与生成使用同一套规则**，包括精简提示词：三个方向预览会在所选系统的结构内，改变信息、依据和行动号召的侧重。这些是结构摘要，实际渲染结果可能包含更丰富的细节。在选择系统之前、或系统规则变更之前保存的方向，可以根据当前系统重新生成。

![设计系统概览，显示简明的导航、首屏和页脚规则、网格示意图和布局尺寸](doc/images/readme-layout-overview.png)

*真实的 Cobalt Atelier 概览。导航、首屏和页脚摘要始终可见；展开某个区域即可阅读完整规则。缺失的内置规则会被补全，已有的自定义规则会保留。*

![方向设置界面，使用同样的 Cobalt Atelier 布局规则，并选择了 LOW 推理强度](doc/images/readme-layout-direction.png)

*生成之前，真实项目方向界面中使用的同一套布局规则。此截图展示的是已配置的指引，并非实测的模型质量结果。*

桌面安装包内置 **41 个网站示例**、**41 张生成的 WebP 插图**和 **41 张在 Chrome 中截取的网站缩略图**。设计系统库和项目引导流程会显示这些缩略图；每个主题的概览都有专用的、可滚动的网站预览。可在[网站预览图库](design%20system%20themes/previews/index.html)中浏览资讯类网站、商店、工作区、文化类页面等。[主题令牌目录](design%20system%20themes/catalogue.html)

![BurnGuard 中显示真实网站缩略图的设计系统库](doc/images/readme-design-system-library.png)

*带有内置网站缩略图的真实设计系统库。*

这些示例展示内置主题的默认设计。已有的系统预览文件优先；缺失时，BurnGuard 会显示内置参考，且不会覆盖已编辑的系统文件或发布记录。在应用中，示例使用共享的本地字体库。

内置 **72 个字体家族**，并附带许可证声明。内置字体使用同一个共享的本地字体库，画布加载的字体在应用窗口内跨项目复用。新项目引用该字体库；独立导出会包含所需的字体文件。[字体目录](assets/fonts/README.md) · [设计系统格式](<design system sample/README.md>)

## 一个工作区，多种产出

| 制作 | 处理 | 带走 |
|---|---|---|
| 网站 | 相互链接的页面、共享样式、图片和可复用组件 | HTML/CSS/JS/资源 ZIP，或发布到你的 Vercel 账号 |
| 幻灯片 | 幻灯片预览、字体排印、演示模式和批注 | HTML、PDF 或 PPTX |
| 图形 | 自定义画板尺寸、海报和多画框组合 | PNG、PNG 打包或 PDF |
| Logo | 多轮设计探索，选定一个作为母版 | SVG 母版¹、品牌指南 PDF 或 HTML 归档 |
| 商品详情页 | 带分区图片的长页面 | 按分区切分的 PNG/JPEG 切片 |
| 平台页面 | Cafe24 Smart Design 或 Imweb 代码组件产出 | 附手动安装指南的包 |

¹ SVG 母版导出仅适用于 Logo 项目。

![BurnGuard 幻灯片编辑器，显示带演示和导出控件的 SONNEL 幻灯片](doc/images/readme-slide-workspace.png)

*同一个工作区也能处理幻灯片，演示和导出控件位于画布上方。*

PPTX 导出包含每页幻灯片的高分辨率图片，文字放在演讲者备注中。单个元素仍可在 BurnGuard 的 HTML 工作区中编辑，不会导出为可编辑的 PowerPoint 对象。

## 在眼前直接打磨结果

- **在画布上编辑**。选择元素，调整大小和旋转，修改字体排印和间距，或处理颜色。已保存的修订版本和撤销功能可帮你回到之前的结果。
- **留下定位明确的批注**。把反馈固定在内容上，并发送 AI 修改请求。滚动时批注点保持原位；点击已保存的批注点即可重新打开批注。将鼠标悬停在画布上，在 Windows/Linux 上按 **Alt+C**，在 macOS 上按 **Option+C**，即可快速添加批注。
- **添加素材**。附加受支持的 PDF、幻灯片、文档、图片或文本，或导入导出的 HTML 项目 ZIP。原始附件与发布的网站资源分开保存。
- **分享前先检查**。质量和 UX 面板会找出问题并提供修复操作。其结论仅供参考；导出或发布之前，请自行检查渲染结果。

### 图片、图表与 3D

让图片在设计中担当角色：产品主视觉、活动场景、说明性插图或背景。BurnGuard 提供涵盖 13 个领域的 **21 种图片处理风格**和 **38 个用途配方**。生成的图片**默认为写实摄影风格**：除非你要求，否则不会生成抽象图像；图片提示词按摄影师的拍摄要求来写；塑料感皮肤、发光背景和乱码文字等典型的 AI 生成痕迹会在检查阶段被剔除。非摄影风格仅在你选择或要求时才会使用。生成指引会在设计需要图片时要求制作图片；所配置的服务提供商必须支持所请求的生成。图形生成需要已登录的 Codex 连接。[图片制作指南](doc/image-production.md)

<p align="center">
  <img src="doc/images/readme-graphic-output.png" width="420" alt="渲染后的 ODDWARD 示例海报，含青柠色字体、粉色便签和铬质雕塑作品">
</p>

*来自本地 QA 证据的 ODDWARD 示例图形渲染。该虚构示例中的创意作品为生成图像；这是产出预览，不是应用截图。*

在**图表**面板中可添加面积图、折线图、柱状图、组合图、雷达图、饼图、径向图或桑基图。粘贴电子表格行、编辑颜色，即可在 HTML 中保留带源数据的可移植 SVG。**3D** 面板支持内置的 Three.js 对象和 AI 场景编辑。[图表指南](doc/charts.md)

欢迎体验 **SONNEL**、**FOLIOVER**、**ODDWARD**、**VELUNE** 和 **HALIDE**。每个原创合集都包含一个网站、一套六页幻灯片、一个图形和一个设计系统。[示例合集](samples/original/README.md) · [图片配方图库](doc/images/image-recipes/README.md)

## 开始使用

1. **安装**。从 [GitHub Releases](https://github.com/ashmoonori-afk/BurnGuard/releases/latest) 下载 Windows 或 macOS 安装包。在 Windows 上，使用安装程序，或解压完整的便携版 ZIP 后打开 `BurnGuard.exe`。在 macOS 上，使用安装程序，或把便携版应用移到“应用程序”文件夹。安装包目前未签名。
   - **macOS**：首次启动会被 Gatekeeper 拦截。先尝试打开一次应用，然后前往**系统设置 > 隐私与安全性 > 仍要打开**。也可以在终端运行：`xattr -dr com.apple.quarantine "/Applications/BurnGuard.app"`。注意：在 macOS 15 及以上版本，按住 Control 点按打开已不再能绕过拦截，请使用系统设置中的方式。
   - **Windows**：对于未签名的 Setup.exe 或便携版 .exe，SmartScreen 可能显示“Windows 已保护你的电脑”。点击**更多信息**，然后点击**仍要运行**。
2. **体验示例**。在连接 AI 服务提供商之前，先打开内置项目试试画布。
3. **连接你的 CLI**。安装并登录 Claude Code 或 Codex CLI，然后在设置中选择连接和模型。**默认推理强度为 medium（中等），默认使用 vanilla 模式**。Vanilla 模式会排除个人插件和指令，同时保留 BurnGuard 的项目上下文。
   - **Codex 进度信号（默认开启）：** Codex 使用指标会发送到这台电脑上的 BurnGuard，这样长时间无输出的 Codex 步骤（例如编写大型页面）不会被当作卡住而中止。你可以在设置中关闭 **检测 Codex 是否仍在工作**。如果你已为 Codex 配置了自己的 OpenTelemetry 目标，此项会保持关闭，直到你手动开启，因为开启期间你的目标收不到 Codex 指标。
4. **创建项目**。选择格式和设计系统，添加需求说明和参考素材，然后生成并打磨。
5. **导出或分享**。下载项目文件，或使用**分享 → 准备当前产出 → 公开发布**，把网站发布到你的 Vercel 账号。

| 要求 | 详情 |
|---|---|
| Windows 桌面端 | Windows 10/11 x64、.NET Framework 4.8 和 Microsoft Edge WebView2 Runtime |
| AI 生成 | 已安装并登录的 `claude` 或 `codex` CLI，以及对应的服务商账号 |
| 渲染与导出 | 受支持的 Chrome/Edge 或 Chromium；可用情况会在设置中显示 |
| 更新 | Windows 和 macOS 发布源；替换安装包时请保留本地配置文件夹 |

发布到 Vercel 需要你的令牌和可选的团队 ID。粘贴的令牌仅在该次发布期间保留在内存中；保存在设置中的令牌只存放在这台电脑的本地配置文件里。托管套餐和访客访问权限遵循你的 Vercel 设置。Cafe24 和 Imweb 包需要手动安装，尚未在真实的客户店铺中验证。

## 你的项目留在本地

BurnGuard 把数据库、项目、设置、系统和导出缓存保存在 `~/.burnguard`（Windows 上为 `%USERPROFILE%\.burnguard`）。升级应用时请保留该配置文件夹。

生成时，所选上下文会发送给你配置的服务提供商。导入和发布也可能使用网络。本地服务器只绑定回环地址，会校验启动授权，并在沙盒中隔离生成的页面。[安全模型](doc/01-architecture.md#7-security-and-safety-model)

## 从源码运行

请使用 CI 中固定的 **Bun 1.3.14**。

```sh
git clone https://github.com/ashmoonori-afk/BurnGuard.git
cd BurnGuard
bun install --frozen-lockfile
bun run scripts/dev-launcher.ts
```

启动器会在 `http://127.0.0.1:5173` 打开前端；后端使用 `127.0.0.1:14070`。按 Ctrl+C 停止。在 Windows 上，`Start-BurnGuard.bat` 是面向开发的源码构建启动器（需要 Bun 和 .NET 8 SDK）；普通用户请从 GitHub Releases 下载发布版安装程序。修改源码后请使用 `--rebuild`。

要查看仓库中的主题示例，请在浏览器中打开 `design system themes/previews/index.html`。这些页面使用内置的本地字体和图片。编辑主题令牌之后，请重新生成令牌目录和网站预览：

```sh
bun run catalogue
bun run previews
```

`previews` 会重新生成 HTML 并复用已有插图，不会调用图片服务商。之后如需刷新已提交的网站缩略图，可在已安装 Node.js 和 Chrome 的环境中运行 `bun run previews:thumbnails`，它会在 Chrome 中截取实际页面。

```sh
bun run typecheck
bun run check:whitespace
bun run build:frontend
bun test
```

请在仓库根目录运行测试，这样 preload 才会提供隔离的临时配置文件夹。浏览器 QA 需要 Node.js 和 Chrome/Edge；Windows 运行器可能需要 Bun 可执行文件的绝对路径。[贡献与原生构建](doc/CONTRIBUTING.md)

<details>
<summary>关于截图</summary>

界面截图选自仓库本地 `.omo/evidence` 的 QA 记录，未经修饰直接复制。它们展示的是预置示例和测试输入，不是私人客户项目，也不能证明曾用真实服务商运行。较早的截图可能与当前工具栏略有差异。

| README 图片 | 原始证据截图 |
|---|---|
| 网站工作区 | `fonts-2026-09-09/app-created-prototype.png` |
| 设计系统选择 | `reference-layout-app/selected/onboarding.png` |
| 设计系统库 | `reference-layout-app/selected/list.png` |
| 布局概览 | `reference-layout-app/selected/overview-desktop.png` |
| 布局方向 | `reference-layout-app/selected/direction-desktop.png` |
| 幻灯片工作区 | `updates-samples-2026-09-09/app-created-slide_deck.png` |
| 图形产出 | `fonts-2026-09-09/oddward-graphic-quality.png` |

</details>

## 更新日志

### 0.5.28

- 基于提取的设计系统新建网站项目时，现在从基于 class 的页面骨架开始，保留提取的首屏图片，并为按钮、副标题和页脚文字使用易读的颜色。已编辑过的页面不会被起始模板替换。
- 质量检查会把每个分区与参考截图对比，并裁出最薄弱的分区，因此一次修复只处理一个分区。每张参考截图旁都会保存一张区块轮廓图。
- 网站提取更准确：副标题、品牌名、颜色令牌和首屏图片的测量更可靠，抓取的 SVG 图片会被清理，样式表重定向必须停留在同一站点内，无法测量布局时会记录原因。
- 未安装任何 AI 工具时，发送按钮会被禁用，并显示原因和设置链接。被停止或失败的轮次现在总会显示为已停止或失败；在另一条消息运行时发送的消息会被干净地拒绝，不再留下只记录了一半的轮次。
- BurnGuard 在后台重启时，已打开的窗口会提示并提供重新加载。在手机宽度下，工作区、画布工具和导出仍可使用。
- 在模型支持的情况下，推理强度默认为 medium；Claude、Gemini 和预设的模型列表使用当前官方模型 ID。
- 画布只加载页面用到的字体，并在页面绘制完成前显示渲染状态。样式侧边编辑器会保留你输入的值。
- 导出处理超大或特殊的项目文件时更快更安全，保留 macOS 带重音符号的文件名，并正确编码下载文件名。
- 错误信息不再显示私有文件路径或原始系统错误文本，设置中的错误会说明如何恢复，韩语和中文文案也已补全。
- macOS 应用遵循与 Windows 应用相同的桌面规则，更新检查会正确排序预发布版本。

### 0.5.27

- 项目可以导出为可移植的 `.burnguard-project` 包，并在另一台电脑上恢复。已保存的服务商和访问令牌以及本地配置不会包含在内，恢复时总是创建一个新项目。
- 交接导出新增机器可读的清单、`HANDOFF.md` 和给编码 CLI 的提示词，并附带可复制的命令，用于在 Claude Code 或 Codex 中继续工作。
- 设置 > 运行时诊断会列出每个 CLI 连接的版本和能力，以及最近的生成在哪个阶段停止；失败或中断的项目可以从已保存的文件继续。
- 视觉质量指引现在覆盖网站、幻灯片、图形、Logo 和图示。质量面板新增了仅供参考的检查：分隔破折号、占位文案、眉标（eyebrow）标签、重复或换行的主要行动号召、强调色和圆角数量、重复的相邻分区；并为网站新增渲染后的用户路径检查：无处可去的链接、横向滚动的移动端导航、不可见的键盘焦点，以及加载时的布局偏移。
- 支持 GIF 附件，元数据中嵌入 SVG 文本的图片现在也能解码。WebP 文件在解码前先验证，不可信图片的颜色采样在单独的进程中运行。
- 可为一个设计生成两到四个视觉备选方案，并排比较，选定一个并删除其余的。
- PDF、PNG、PNG ZIP 和 PPTX 导出会显示与画布的逐页相似度分数。该检查只会警告，不会阻止下载。
- 可以导入 Figma JSON 导出（可附带画框图片），作为与你的设计系统令牌匹配的不可变参考。无需 Figma 账号令牌。
- 网站设计系统按页面提取（导航、页脚和站点地图，遵守 robots.txt），包含测量的布局、页面颜色、字体角色、资源使用规则和资源提示词。有 Chromium 时，最多四个源页面会离线渲染并在桌面和移动宽度下测量，这些页面的参考截图会随系统一并保存。
- 使用提取系统生成网站时，测量值会作为硬性约束，连同起始样式表和页面骨架、作为视觉目标的参考截图以及一条明确的优先级规则一起提供；检查会对照测量的布局审查页面，并修复一次。
- 生成指引按模型家族的能力档案（claude-frontier、gpt-image、standard）执行。使用 Claude Opus 或 Sonnet 时，若未提供 Logo，BurnGuard 会依据你的令牌按七条构造规则设计 CSS 与 SVG Logo，并从 Openverse 和 Iconify（无需密钥）查找开放授权的照片、插图和图标来代替生成图片，保存每个文件时附上来源和许可证。Codex 上的 GPT 模型仍然自行生成图片。网页搜索可在设置中关闭，模型选择器会推荐 medium 或更高的推理强度。
- 生成和修复提示词带有证据规则：视觉方面的结论只能来自渲染证据，没有运行的检查要报告为未验证，不得使用未经测量的数字。
- 首次运行时，应用会跟随系统语言（韩语、简体中文，其他情况为英语）；在设置中选择的语言始终优先。首次成功导出或发布后，应用会询问一次是否给 GitHub 点 Star；不会向任何地方发送任何内容。

### 0.5.26

- 把网页项目发布到 Vercel 时，仅在已发布的网站上添加一个小小的“Made with BurnGuard”徽标；下载的 ZIP 导出不受影响。该徽标可在设置中或每次发布时关闭。
- Vercel 令牌可保存在这台电脑上，发布只需一次点击。设置中只显示令牌是否已保存，从不显示令牌本身。
- README 以一段录制的演示开头：一句提示词变成落地页。
- 不可信设计系统来源中隐藏的 `<template>` 和 `<noscript>` 标记，现在每个容器只验证一次，嵌套超过八层即被拒绝，因此精心构造的标记无法再卡住后端。
- macOS 发布冒烟测试改为通过图标而不是工具栏位置找到画布的“编辑”控件，与 0.5.25 中去掉“选择”模式的工具栏保持一致。

### 0.5.25

- 即使渲染后的设计检查无法运行（缺少 Chromium，或大型网站超时），生成轮次也会提交；聊天中会显示“检查未完成”徽标，而不是拒绝该轮次。必须修复的问题只会在该轮次改动过的页面中阻止提交；修改了共享 CSS、脚本或图片的轮次会检查所有页面。
- 质量面板把不适用于幻灯片和固定尺寸图形的检查报告为不适用，可测量纯渐变上的对比度，把等宽文字视为独立的字体角色，扫描链接的样式表中硬编码的颜色，并标出导出无法获取的远程字体、图片和框架。
- 设计需求说明会带上应用语言；UX 检查结果、质量与平台修复请求、方向预览以及应用构造的每个 AI 请求，都以韩语、英语或中文显示；每个服务器错误码都有对应的错误信息。
- 提示词框架理顺了相互矛盾的规则（图表、配色、断点、社会认同、地图嵌入、仅限 Windows 的 PowerShell），新增了韩文字体排印规则，在每个项目内放入 Lucide 图标参考，按请求控制 3D 与图表约定，提供完整的设计系统令牌块，并在精简模式下削减固定规则。
- 画布：编辑面板可编辑图片来源和链接目标，已解决的批注可以重新打开，新批注会打开其编辑器，Ctrl/⌘+Z 可撤销样式调整，色板来自页面自身的令牌，列出所有内置字体，并移除了重复的“选择”模式。
- 首页与设置：深色模式在所有界面生效，语言点击即保存，后端检测失败时显示重试，创建成功后清空创建草稿，搜索覆盖所有项目。
- 网站导入会剥离脚本和表单，而不是拒绝该页面；在提取的令牌上记录媒体查询上下文，并输出规范的令牌约定；起始模板声明 `--page-background`。

### 0.5.24

- 新项目和预置示例重新可以在画布、实时预览和演示中加载；此前内置字体数量超出了画布的字体上限。
- PDF 和 PNG ZIP 导出会保留作者编写的 grid/flex 布局和页面背景，等待懒加载图片，并把预置示例图形导出为画板 PDF。过大而无法导出 PDF 的幻灯片会在渲染前被拒绝，并给出明确原因。
- Cafe24 和 Imweb 包接受普通链接，包含每个页面以及仅子页面使用的资源，页脚脚本保持可用，附带字体许可证，并且不再需要 Chromium。
- 导出只包含文档用到的内置字体，ZIP 文件带本地时间戳，已删除的项目不再留下缓存的导出。
- 聊天会报告该轮次的工作是否真正进入了项目，包括失败的幻灯片检查和修复；按要求可让附加的源页面与幻灯片一一对应。
- macOS 应用：能找到通过 Homebrew 或在 `~/.local/bin` 中安装的 CLI 和 Python，在浏览器中打开外部链接，支持标准的 ⌘C/⌘V/⌘Q 快捷键，替换已有的下载，并在退出前等待本地服务器停止。
- Windows 应用：遇到可恢复的 WebView2 进程故障时保持打开，并列出已安装的字体。Linux 源码运行也会列出已安装的字体，在 macOS 和 Linux 上每个配置文件现在只由一个后端拥有。
- 设置拆分为共享配置文件，以及设备本地的凭据和策略。

### 0.5.23

- Logo 项目会在 Codex 图像输出到达时显示它们，原样保留候选字节，按画板审核文字，并报告更清晰的失败阶段。
- Windows 通过 job 对象管理后端的进程树，安全地为批处理提供商参数加引号，并按文件名路由原生下载。
- 发布打包会在准备草稿之前，于 Windows 和 macOS 上验证原生画布、持久化和导出。

### 0.5.22

- 新增 Logo 设计项目，包含探索轮次、选定的 SVG 母版和品牌指南交付物。
- macOS：沙盒画布可用，支持原生导出下载、已安装字体列表，以及为 PDF 依赖准备的应用专属 Python 环境。
- 安全修复：解压前检查 PNG 解码后的尺寸，设计系统升级前重新验证 SVG，并收紧 POSIX 安装包权限。
- 0.5.20 和 0.5.21 未公开发布。

### 0.5.19

- 启动时恢复已验证的旧版仅附件产出物修订，不替换项目文件或上传的原件。
- 读取设计系统界面规则时规范化 Windows 换行符。
- 修复 Windows 浏览器测试启动问题，并隔离服务商/渲染测试夹具；Windows 发布打包中加入旧版恢复检查。

### 0.5.18

- 在内容和图片加载过程中，把过大的幻灯片内容适配到画板内。
- 在标记生成完成之前，验证实际的幻灯片内容、页数、运行时和本地图片；不接受占位内容，而是继续完成未完成的产出。
- 生成图片默认采用写实主体，避免抽象的装饰性图片。
- 历史规格 04–23 和参考笔记仅保留在本地，并简化公开文档索引。

### 0.5.17

- 为所选项目格式显示幻灯片或网站缩略图。
- 停止生成时保留已生成的 HTML 和资源，若写入过程中入口文件被移除，则恢复之前的入口文件。
- 固定项目设计规则，审核渲染产出，并在交接导出中包含检查证据。

[全部版本](https://github.com/ashmoonori-afk/BurnGuard/releases)

## 文档与许可证

[文档索引](doc/README.md) · [架构](doc/01-architecture.md) · [设计指引](doc/design-craft.md) · [安装与更新](https://github.com/ashmoonori-afk/BurnGuard/releases/latest)

BurnGuard 采用 **Apache-2.0** 许可证。参见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和[图片来源说明](doc/images/README.md)。

### 对比来源

核对于 2026-09-28。Claude Design：[产品页面](https://claude.com/product/design)和[发布公告](https://www.anthropic.com/news/claude-design-anthropic-labs)。OpenDesign：[nexu-io/open-design README](https://github.com/nexu-io/open-design)。BurnGuard：本 README 和 [`scripts/build-mac.ts`](scripts/build-mac.ts)（macOS 目标）。产品细节会变化；如有过时的行，请提交 issue。

---

*Synced with README.md at v0.5.28.*

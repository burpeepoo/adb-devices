# ADB Manager 产品设计优化审计

日期：2026-06-18

受众：Cozyla 工程师、QA/支持用户、ADB Manager 维护者。

## 1. 执行摘要

ADB Manager 已经从一个常用 ADB 命令的可视化包装器，成长为多场景设备操作控制台：本地设备控制台、无线恢复、Workbench 命令库、APK 安装/导出、截图/录屏、scrcpy 本机投屏、浏览器远程控制、图片投屏、剪贴板、Logcat、包管理、设置，以及更新/发布可信链路。

当前最重要的产品机会不是继续增加更多原始 ADB 覆盖面。现有产品已经覆盖大多数 Cozyla 日常设备工作流。下一步设计重点应该是让工具更围绕场景组织，在多设备环境下更安全，并让恢复流程和远程控制权限更容易理解。

优先建议：

1. **P0：让所有工具中的目标设备更显式。** 避免未选择设备或 ADB 回退到默认目标时，对错误 Android 设备执行操作。
2. **P0：把无线恢复改成引导式决策树。** 保留现有安全修复边界，同时让“扫描失败”“端口可达”“配对会话过期”“修复”“重置本机身份”读起来像一个连贯恢复流程。
3. **P0：围绕角色、信任和停止条件重设计 Remote Control。** 后端权限模型已经很强，桌面 UI 应该把这个模型解释到足以让支持/QA 用户放心使用。
4. **P1：把左侧工具栏从 11 个平铺工具改成工作流分组。** 保留专家入口，但优先呈现用户任务：连接、检查、安装、采集证据、控制、诊断、管理应用。
5. **P1：把 Workbench 改造成“场景包 + 专家模式”。** Workbench 命令库很强，但高频 QA/支持任务应该成为带验收输出的策划型工作流。
6. **P1：增加证据采集会话。** 截图、录屏、Logcat、包信息和设备摘要应该可以打包成一个诊断工件。
7. **P1：围绕保存视图和 incident mode 改进 Logcat 与诊断。** ADB Manager 可以借鉴 Android Studio Logcat 的结构化过滤习惯，但不需要变成 IDE。
8. **P1：强化应用/包管理工作流。** 现在已有包导出，下一步有价值的是比较、批量操作和更安全的破坏性操作流程。
9. **P1：增加远程协助就绪检查。** 远程支持应该显示 gateway、访问地址、角色链接、目标设备和画面流路径是否真的可用。
10. **P1：让设备备注更具操作性。** 在现有本地备注模型上扩展轻量 lab 上下文，不要把它变成完整设备资产系统。
11. **P2：在应用内暴露发布/更新可信健康状态。** 这个项目的发布契约比普通应用下载复杂，需要给维护者和支持用户更多可解释性。
12. **P2：把 fastboot 保持为受控 roadmap 方向。** 不要因为 bundled platform-tools 就暗示已经支持 fastboot。只有产品需求明确时，才从窄范围、可审计的刷机能力开始。

## 2. 编排与证据

### 编排决策

- 分类：中等复杂度产品设计审计。
- 工作区模式：按计划交付单份可沉淀到知识库的 Markdown 文档。
- 执行模式：顺序执行。运行时具备 subagent 能力，但用户没有明确要求委派工作，而且这次审计更需要统一证据链和最终排序，所以未使用 subagent。
- 选用角色视角：
  - CEO / Manager：优先级、排序和最终综合。
  - Product Designer：导航、信息架构、状态设计和交互清晰度。
  - Tech Lead：结合当前 React/Tauri 架构和命令边界判断可行性。
  - QA / Acceptance：失败模式、回归风险和验证场景。
  - Market lens：轻量类别校准，不做完整竞品报告。

### 成功标准

- 每条建议都映射到 Cozyla 用户任务，而不是只因为竞品有某功能。
- 每条建议都有仓库证据、来源证据，或明确标记为假设。
- 覆盖所有当前主要工具区，包括 Remote Control。
- 无线恢复建议保留安全默认值：除非用户明确选择 fallback，否则修复不重置本机 ADB 身份。
- 输出可以作为后续 PRD 或 issue 拆分输入。

### 使用的证据

仓库证据：

- `README.md` 把应用定义为 PM、QA 和工程师使用的桌面工具，覆盖无线配对、mDNS、设备备注、APK 安装、投屏、截图、录屏、Logcat 和包管理。
- `docs/functional-model/product-overview.md` 说明主要用户、11 个左侧工具栏 tab、设备控制台角色、Remote tab 角色、设备身份规则、风险处理、持久化、本地化和更新模型。
- `docs/functional-model/feature-spec.md` 细化所有主要功能区，包括无线恢复、Workbench、远程控制、媒体采集、图片投屏、剪贴板、Logcat、包管理、设置、OS 集成和全局快捷键。
- `docs/functional-model/domain-model.md` 记录设备身份、最近端点、store keys、选择模型、运行时锁、应用抽屉缓存、Workbench 模型和错误约定。
- `docs/functional-model/known-risks-and-open-questions.md` 已经识别无线边界、启动修复取舍、mDNS 可见性、Workbench 安全、录屏生命周期、scrcpy 早退窗口、包解析限制、Logcat 限制和 release feed 新鲜度。
- 当前 UI 代码：`src/App.tsx`、`DeviceConsole.tsx`、`DeviceConsoleShortcuts.tsx`、`PairConnect.tsx`、`RemoteControl.tsx`、`AdbWorkbench.tsx`、`ToolRail.tsx`、`src/locales/zh-CN.json`。
- 当前工作区存在未提交改动，涉及 functional model 文档、App/导航、Remote Control、Tauri 命令/状态文件、locales、tab state 和测试。本审计把这些视为当前本地工作，不等同于已发布版本状态。

外部类别参考：

- Android Debug Bridge 官方文档：ADB 是用于 Android 设备操作的 client-server 命令行程序。来源：https://developer.android.com/tools/adb
- Android Studio Device Explorer：IDE 级设备文件浏览和设备交互被做成任务型工具。来源：https://developer.android.com/studio/debug/device-file-explorer
- Android Studio Logcat：现代 Android Logcat 强调结构化过滤和类似保存查询的工作流。来源：https://developer.android.com/studio/debug/logcat
- scrcpy：本地 Android 显示/控制的成熟开源模式。来源：https://github.com/Genymobile/scrcpy
- Vysor：浏览器/桌面端 Android 查看和控制的类别信号。来源：https://www.vysor.io/
- ADB AppControl：GUI 化应用/包管理和 ADB Android 维护的类别信号。来源：https://adbappcontrol.com/en/

证据缺口：

- 没有 tab 使用、失败操作、修复成功率、更新失败或远程控制会话使用的分析数据。
- 没有用户访谈、支持工单或真实设备 QA 会话观察记录。
- 本次审计没有重新截取新截图。
- 外部研究有意保持轻量，不应视为完整竞品分析。

## 3. 按用户任务映射当前产品

| 用户任务 | 当前界面 | 证据 | 产品设计含义 |
| --- | --- | --- | --- |
| 连接或恢复设备 | Device Console + PairConnect + device panel | Device Console 在未选择设备时嵌入 PairConnect，选择设备后又在 accordion 中嵌入一次。PairConnect 管理 mDNS、最近端点、TCP probe、repair 和 reset 状态。 | 这应该读起来像一个恢复助手，而不是多个分散面板。 |
| 检查设备 | Device Console + device panel | 设备摘要包含 Android、签名、电量、显示、存储、前台应用、安全状态、boot state、build fingerprint。 | 这是设备首页的强基础，但目前作为诊断入口的价值还没有完全释放。 |
| 安装/测试构建 | APK Install + Workbench | APK install 支持拖放、文件夹、剪贴板路径、force mode；Workbench 也包含 install 命令。 | 常见 install-test loop 可以场景化。 |
| 采集证据 | Screenshot + ScreenRecord + Logcat + PackageList + DeviceConsole | 各独立工具分别采集图片、视频、日志、包详情和设备状态。 | 用户很可能需要 bug report 证据包，而不是一堆孤立文件。 |
| 本机投屏/控制 | ScreenMirror | scrcpy 集成、应用抽屉、导航键、渐进式应用图标。 | 这是很强的控制面，可以和证据采集、应用启动更直接地联动。 |
| 远程协助 | RemoteControl | 角色 QR 链接、PIN fallback、可信浏览器、会话、审计、HLS/MJPEG/snapshot fallback、输入控制权。 | 后端已经成熟，桌面 UX 需要更清楚地呈现权限和安全。 |
| 诊断日志 | Logcat + Workbench | Logcat 支持 snapshot/stream/filter/export；Workbench 包含诊断命令。 | 应增加 incident-oriented preset 和保存视图。 |
| 管理应用/包 | PackageList + APK Install + Workbench + app drawer | 包信息/导出和应用启动已存在；Workbench 有包相关命令。 | 应整合成更清晰的应用/包工作流。 |
| 信任发布/更新 | Settings/updater + README/release docs | 更新器使用 GitHub `latest.json`；发布契约包含 DMG/PKG/updater/Windows 签名。 | 维护链路很强，但用户可见的可信状态较薄。 |

## 4. 按优先级排序的建议

### P0-1. 让所有工具中的目标设备更显式

问题：

多个工具接受可为空的 `deviceSerial`。Workbench 明确提示未选择设备时 ADB 会使用默认设备选择逻辑；截图文案也提示未选择设备时会使用默认设备。在多设备 QA lab 中，默认 ADB 目标很危险，因为安装、命令、截图或日志操作可能作用到错误设备上。

仓库证据：

- 产品角色包含对物理设备的重复工程/支持工作流。
- 设备选择是核心状态：device panel 和 App state 会把 `selectedDevice` 传给 install、screenshot、record、mirror、imageCast、clipboard、Logcat 和 packages。
- `DeviceConsole` 有选中设备摘要，但部分工具仍允许 default-device 路径。
- Workbench preview 在没有选择设备时会提示风险，这说明风险已被识别，但还没有统一提升为全局规则。

类别信号：

ADB 是 client/server 命令行工具；多设备存在时，设备目标通常要通过 serial 显式指定。GUI 应该降低误操作目标设备的风险。

用户影响：

高。错误设备操作会破坏 QA 证据、把构建安装到错误设备、清除错误目标的数据，或采集误导性的日志。

建议改动：

- 在每个工具区内部增加持久“目标设备”条，而不仅依赖全局 header。
- 当没有目标设备且可见设备超过一台时，阻止 mutating actions，直到用户选择目标。
- 对只读低风险操作，可以保留“一次性使用 ADB 默认设备”的显式入口。
- 在操作按钮附近显示物理身份：`device_sn || serial`、连接类型和备注。
- 在输出中记录目标身份：截图 metadata、录屏结果、Logcat 导出 header、Workbench history、包导出结果。

预估工作量：

中。主要是前端共享组件和各工具操作 gating；后端 API 已经接受 serial。

风险：

可能降低依赖 ADB 默认选择的专家用户效率。可为单设备或只读场景保留专家 override。

验证场景：

- 连接两台在线设备，打开每个工具，确认 mutating actions 需要可见目标设备。
- 只连接一台在线设备，确认应用自动选择且不增加不必要摩擦。
- 运行 Workbench、截图、Logcat 导出和 APK 安装，确认结果文本命名同一目标设备。

优先级理由：

P0，因为这是正确性和信任问题，不是视觉打磨。

### P0-2. 把无线恢复改成引导式决策树

问题：

无线恢复已有很好的底层分层：mDNS discovery、recent endpoints、TCP probes、手动 pair/connect、restart/repair 和显式 host identity reset。当前 UI 把这些能力暴露为多个 panel、结果消息、fallback hint，以及失败阈值后的隐藏控制。用户在失败状态下仍需要自己推断下一步该做什么。

仓库证据：

- PairConnect 保存 pair/connect 字段、recent endpoints、probe state、本地 IP、repair 可见性和 host identity reset 可见性。
- feature spec 区分普通 reconnect、保留 host identity 的 repair，以及 destructive reset。
- known risks 记录了 mDNS 可见性、多网卡、stale sessions，以及必须让 repair controls 可发现。
- 历史上下文确认用户曾要求分层恢复、更安全默认值和独立 destructive fallback。

类别信号：

Android wireless debugging 区分 pair port 和 connect port。ADB 命令行工作流会直接暴露这种复杂性。GUI 可以把它翻译成状态相关的下一步指引。

用户影响：

高。配对失败会消耗支持/工程时间，错误 fallback 还可能让多台设备上的 host trust 失效。

建议改动：

- 把被动的“局域网设备 / 手动输入 / 使用指引”布局改成恢复阶梯：
  1. 检测本地网络和当前 ADB server 状态。
  2. 扫描 mDNS 服务。
  3. 探测最近端点。
  4. 要求用户输入 Android wireless-debugging 当前 connect port。
  5. 修复无线配对缓存，并保留 host identity。
  6. 把 reset host identity 作为最后 fallback。
- 在每一步旁边显示“为什么建议这一步”的文案，例如：“端口可达但配对失败；请先刷新 Android 配对弹窗，再考虑重置本机身份。”
- 将 destructive reset 在视觉上分离，并要求用户明确确认现有设备授权可能失效。
- 始终保留手动 IP/端口输入，不隐藏专家逃生口。

预估工作量：

中。主要是 PairConnect 状态呈现和文案；后端恢复 primitives 已经存在。

风险：

过度引导会让专家用户觉得沉重。可用 collapsible “高级详情”，同时保留一键 scan/connect。

验证场景：

- 模拟无 mDNS 设备但有 recent endpoint，确认 recent probe 成为推荐下一步。
- 模拟重复 pair failures，确认 repair 先于 reset 出现。
- 模拟多个本地 IP，确认显示同网段指导。
- 确认 reset host identity 在更安全恢复路径呈现之前不可用。

优先级理由：

P0，因为它能降低支持困惑，同时保留一个已经被有意设计过的安全边界。

### P0-3. 围绕角色、信任和停止条件重设计 Remote Control

问题：

Remote Control 功能强且安全敏感。后端和 functional docs 已经定义 viewer/operator/admin 角色、一次性角色 QR 链接、可信浏览器、会话、控制权、白名单动作、审计日志、HLS/MJPEG fallback 和 stop 行为。桌面 UI 展示了这些部件，但心智模型仍像密集状态面板。中文 UI 中角色名仍是英文，stop/trust 的含义也不够突出。

仓库证据：

- feature spec 记录 viewer/operator/admin 权限、trusted devices、session ownership、audit、whitelisted actions，以及不暴露 arbitrary shell。
- `RemoteControl.tsx` 展示 role invite cards、trusted devices、sessions、control owner、stream defaults 和 audit。
- `zh-CN.json` 本地化了角色描述，但角色标签仍是 `Viewer`、`Operator`、`Admin`。
- Remote Control 默认关闭且需要 opt-in，这是好的安全默认值。

类别信号：

Vysor 和其他远程控制工具会把连接状态和查看/控制模式作为核心。ADB Manager 有更细的本地 gateway 安全模型，桌面 UI 应该清楚解释这个优势。

用户影响：

高。支持用户误分享 admin QR、长时间保留 trusted device、或误解谁持有输入控制权，都可能造成真实操作风险。

建议改动：

- 增加顶层“远程会话安全摘要”：
  - 服务：off/on。
  - 网络暴露：localhost / LAN / Tailscale。
  - 当前活跃 viewers/operators/admins。
  - 当前控制者。
  - 即将过期的 trusted devices。
  - 画面流模式：HLS / MJPEG / snapshot。
- 中文 UI 中将角色本地化为“查看者”“操作者”“管理员”，必要时在 tooltip 中保留英文。
- 把 invite links 改为 3 张角色卡，明确列出“能做 / 不能做”。
- 增加“关闭远程支持会话”操作，停止服务并解释哪些 trust 仍会保留。
- 启动后显示 checklist：“分享查看者 QR 用于观察；分享操作者 QR 用于触控；只有修复/安装时才分享管理员。”

预估工作量：

中。主要是前端 layout/copy。后端已暴露所需状态。

风险：

安全文案太多会拖慢快速支持会话。默认卡片要简洁，细节可展开。

验证场景：

- 启动 Remote Control，确认每张角色卡无需读文档就能理解权限。
- claim viewer 和 operator session，确认桌面端用自然语言显示活跃会话和 controller。
- trust 一个浏览器，停止 Remote Control，再重启，确认 UI 解释哪些 trust 会保留。
- 确认 admin-only 能力和 viewer/operator 流程在视觉上分离。

优先级理由：

P0，因为这是权限和信任界面。

### P1-1. 把左侧工具栏从平铺工具改成工作流分组

问题：

左侧工具栏当前展示 11 个同级 tab。它能工作，但会让成熟功能互相争夺注意力，并隐藏用户任务结构。Pair tab 已经演变成“设备控制台”，而连接入口既作为主入口存在，又作为控制台内部 accordion 存在。

仓库证据：

- product overview 列出 11 个 tab：pair、workbench、install、screenshot、record、mirror、remote、imageCast、clipboard、logcat、packages。
- `App.tsx` 直接从 `TAB_KEYS` 构建工具，并将每个 key 映射到一个 tab component。
- `ToolRail.tsx` 把每个工具渲染为平铺按钮。
- `DeviceConsoleShortcuts.tsx` 又在选中设备页面内重复展示 9 个工具快捷入口。

类别信号：

Android Studio 把 Device Explorer、Logcat 等任务拆成工具窗口。ADB AppControl 把应用/包管理作为主工作流。ADB Manager 应保留专家广度，但优先呈现连贯工作流。

用户影响：

中高。新用户或支持用户需要更少的顶层决策；专家用户需要快速访问且不丢状态。

建议改动：

- 如果产品语言允许，将第一个 tab 重命名为 “Device Home” 或“设备首页”。
- 将左侧工具栏分为可见分组：
  - Connect：Device Home / Pair & Recover。
  - Operate：Mirror / Remote / Clipboard / Image Cast。
  - Evidence：Screenshot / Recording / Logcat。
  - Apps：Install / Packages。
  - Expert：Workbench。
- 后续可以保留键盘/工具搜索或 command palette 作为专家加速器。
- 将 Device Console 快捷按钮从静态 9 宫格改成基于设备状态的“next best actions”。

预估工作量：

中。需要 tab metadata 和 layout 文案调整；组件边界清晰。

风险：

改变导航可能让老用户困惑。可先推出 grouped rail，同时保留图标和标签，而不是彻底重设计。

验证场景：

- 首次用户不读 README，也能连接设备并截图。
- 专家用户仍能一键到达 Workbench。
- 未选择设备时，主可见操作是 connect/recover。
- 选择设备后，主可见操作切换到 inspect、install、capture、control。

优先级理由：

P1，因为它提升理解和重复工作效率，但不改也不会立刻造成正确性问题。

### P1-2. 把 Workbench 改造成场景包加专家模式

问题：

Workbench 很强：library、templates、custom commands、command rewrite、risk classification、preview、execution、history、export。它当前按命令类别和风险组织。很多 PM/QA/支持任务不是单条命令，而是可重复的诊断或设置 recipe。

仓库证据：

- feature spec 列出 Workbench 类别：device properties、display、media、files、network、apps/packages、permissions、settings、diagnostics、power、input 和 Logcat。
- Workbench UI 有 library/templates/custom modes、search、category filter、preview、high-risk confirmation、saved templates 和 history。
- known risks 指出 Workbench risk classification 是 heuristic，已知操作应尽量加入 typed catalog。

类别信号：

ADB 原生命令模型灵活但难记。GUI 工具的价值在于把常见操作打包为命名任务。

用户影响：

中高。场景包降低命令记忆负担，并标准化 QA 证据。

建议改动：

- 在当前 library 之上增加 “Scenarios” 层：
  - “Pre-test device snapshot”：设备摘要、build fingerprint、电量、存储、前台应用。
  - “Install build and launch”：安装 APK、可选清数据、启动应用、采集 foreground Activity。
  - “Collect support evidence”：截图、短录屏、Logcat tail、包信息。
  - “Network diagnostics”：设备 IP、route、Wi-Fi 状态。
  - “Permission check”：列出包权限和选定授权状态。
- 保留当前 Workbench 作为 “Expert commands”。
- 场景输出应可导出，并包含 timestamp、target device、command results 和 failures。

预估工作量：

中高。需要多步骤编排和输出聚合，但可复用现有 Workbench command execution 和 export primitives。

风险：

多步骤工作流会产生 partial success。UX 必须展示每一步状态，并允许 retry/resume。

验证场景：

- 在在线设备上运行 “Pre-test device snapshot”，导出可读报告。
- 使用错误 APK 路径运行 “Install build and launch”，确认安装失败会阻止后续 launch steps 并解释原因。
- 确认 high-risk steps 仍需要显式确认。

优先级理由：

P1，因为它能复用现有命令覆盖并放大价值，不需要先扩大量新后端类别。

### P1-3. 增加证据采集会话

问题：

ADB Manager 可以采集截图、录屏、Logcat、包详情和设备摘要，但这些输出是分散的。QA/支持工作流通常需要一个 incident packet，回答：哪台设备、哪个构建、发生了什么、有哪些日志、有哪些视觉证据。

仓库证据：

- Screenshot 保存 PNG 并 reveal。
- Recording 保存 MP4，并在接近 Android 3 分钟限制时提醒。
- Logcat 支持 snapshot、streaming、filters 和 export。
- Package list 导出已安装 APK 和包详情。
- Device Console 加载 summary 和 diagnostics。

类别信号：

Android Studio 提供专门面板，但 bug report 仍需要人工收集。ADB Manager 可以针对 Cozyla 工作流做得更具体。

用户影响：

中高。减少手动复制粘贴，提高 bug report 可复现性。

建议改动：

- 在 Device Home 增加 “Start evidence session”。
- Session 可采集：
  - 设备身份和摘要。
  - 截图或录屏。
  - Logcat tail 或 stream window。
  - 选定 package 的包信息。
  - 可选备注：scenario、expected、actual。
- 保存到一个带 timestamp 的文件夹和一份 Markdown/HTML summary。
- 在 summary 中包含目标设备身份和 ADB serial。

预估工作量：

完整自动化版本工作量高；如果 v1 只组合现有工具输出，工作量中等。

风险：

长时间采集会话可能和已有单进程锁冲突，例如 recording/logcat。v1 应限定为单设备，并显式 start/stop。

验证场景：

- 启动 session，截图，录屏 10 秒，导出 Logcat，确认文件夹包含全部资产和 summary。
- 会话中设备断开，确认 partial evidence 被保留并带失败说明。

优先级理由：

P1，因为它直接服务 QA/支持结果。

### P1-4. 围绕保存视图和 incident mode 改进 Logcat 与诊断

问题：

Logcat 支持 snapshot、streaming、filters 和 export，但当前产品模型没有提到保存过滤器 preset、incident-specific capture，或与设备/包上下文集成。用户可能反复重建同样的过滤条件。

仓库证据：

- feature spec 说明 Logcat 读取 bounded tail、stream 一个进程、解析 timestamp/PID/level/tag/message，支持 filters、export 和周期刷新。
- known risks 指出 snapshot mode 可能漏掉更早的日志，长诊断应使用 streaming/export。

类别信号：

Android Studio Logcat 强调结构化过滤。ADB Manager 不需要追平 IDE，但保存视图和 preset 属于类别标准。

用户影响：

中。日志工作流对 QA 和支持很核心，尤其是复现固件/应用问题时。

建议改动：

- 增加 saved Logcat views：
  - Tag/query。
  - Level。
  - PID/package，如果可检测。
  - Tail size 或 streaming mode。
- 在有证据时增加常见 Cozyla presets，例如 launcher、updater、WebAuthn/passkey、install、connectivity。没有证据前先作为可配置项。
- 如果可行，增加 “capture from now” 和 “capture last N minutes”；否则清楚暴露限制。
- 导出中包含目标设备和 active package 上下文。

预估工作量：

中。持久化 presets 可复用 store patterns；更深的 package/PID correlation 可能更大。

风险：

没有真实支持证据就加太多 preset，会变成噪音。先从通用 saved views 开始，并允许团队添加验证过的 preset。

验证场景：

- 创建保存过滤器，切换 tab 再回来，确认仍存在。
- 启动 streaming，执行设备动作，停止并导出，确认带 metadata。
- 确认 snapshot mode 提示可能缺失更早日志。

优先级理由：

P1，因为它能提升重复诊断效率，同时不改变核心 ADB 行为。

### P1-5. 强化应用/包管理工作流

问题：

包管理能力分散在 APK Install、PackageList、ScreenMirror app drawer 和 Workbench 中。当前工具可以安装、列出、检查、导出和启动应用。支持/QA 用户很可能按 app-centric 方式思考：安装这个构建，找到当前应用，清除/重启，导出 APK，采集包信息。

仓库证据：

- APK Install 处理文件/文件夹、剪贴板路径、包解析、force uninstall 和 install lock。
- Package List 检查包详情并导出 APK 文件。
- ScreenMirror 有带应用标签/图标的 app drawer，并能启动 activity。
- Workbench 包含 app/package 命令，包括 install、force-stop、clear data、uninstall、enable/disable、package dump、permissions 和 launch。

类别信号：

ADB AppControl 聚焦 GUI 应用/包管理。ADB Manager 可以吸收这种 app-centric 工作流，但保持更窄、更贴合 Cozyla。

用户影响：

中。减少 install、packages、mirror、Workbench 之间来回跳转。

建议改动：

- 增加 “App Workspace” 视图，或增强 PackageList：
  - 搜索 package/app。
  - 显示已安装 version/build。
  - 启动应用。
  - Force stop。
  - Clear data，需要显式确认。
  - Export APK。
  - Install/replace selected APK。
  - 打开 package-specific Logcat filter。
- 将破坏性动作放入 “Advanced”，并提供清楚风险文案。

预估工作量：

中高。后端命令分散存在，产品工作主要是编排和安全 UI。

风险：

破坏性 app 操作可能造成数据丢失。必须确认 target package 和 target device。

验证场景：

- 搜索 package，启动应用，采集 foreground app，导出 APK，打开 package-filtered Logcat。
- 尝试 clear data，确认确认文案包含 package name 和目标设备。

优先级理由：

P1，因为它能流畅化一个明显的重复工作流。

### P1-6. 增加远程协助就绪检查

问题：

Remote Control 依赖多个条件：服务已启用、地址可达、可信浏览器/session、角色 invite、设备在线、控制权、HLS/MJPEG/snapshot，以及 experimental HLS 所需的 host `ffmpeg`。UI 在启动后展示很多状态片段，但没有 preflight 告诉支持用户远程协助是否真的 ready。

仓库证据：

- feature spec 说明 Remote Control 优先排序 Tailscale，支持 role QR sessions、trusted browsers、依赖 `ffmpeg` 的 HLS、MJPEG fallback、snapshot fallback 和 action audit。
- `RemoteControl.tsx` 展示 addresses、invite links、trusted devices、sessions、control owner、stream defaults 和 audit。

类别信号：

远程查看/控制工具会把连接状态作为一等公民。ADB Manager 的 Tailscale/LAN/localhost 区分尤其重要。

用户影响：

中。减少“我分享了链接但手机打不开”的支持循环。

建议改动：

- 启动前或启动后立即显示 readiness checks：
  - Desktop gateway 已启动。
  - 至少有一个非 localhost 地址可用。
  - 检测到 Tailscale 地址或 LAN 地址。
  - 选中设备在线。
  - 画面路径可用：HLS ready / MJPEG fallback / snapshot only。
  - 角色链接已生成。
- 增加“复制最佳地址”和“复制支持说明”操作。
- 如果只有 localhost 可用，提示另一台设备无法使用它。

预估工作量：

中。大多数 status data 已存在；如果尚未暴露 `ffmpeg` 可用性，可能需要后端补充。

风险：

网络状态不稳定。状态应显示“last checked”并可刷新。

验证场景：

- 只有 localhost 时启动，确认提示。
- 有 Tailscale/LAN 时启动，确认高亮最佳地址。
- 没有选中设备时启动，确认 remote service 可以开启，但设备控制尚未 ready。

优先级理由：

P1，因为它提升可靠性感知和支持配置效率。

### P1-7. 让设备备注更具操作性

问题：

设备备注是 local-only，并在可用时按稳定身份 key 保存。这很有用，但当前备注仍是自由文本标签。对重复 QA/支持工作流，用户可能需要状态、owner、test lane、firmware branch 或物理位置，而不一定需要完整 inventory system。

仓库证据：

- 设备备注是 local-only，并以 `device_sn || serial` 为 key。
- Device list 和 console 都支持编辑备注。
- Device history 会让断开的设备继续可见。

类别信号：

Device farm 和 QA bench 通常需要轻量 inventory 上下文。ADB Manager 可以提供足够上下文，而不变成设备管理平台。

用户影响：

中。帮助团队区分多台外观相同的 Cozyla 设备。

建议改动：

- 保留自由文本备注，但增加可选轻量字段：
  - Alias。
  - Test lane/status。
  - Owner。
  - 如果能从 summary 采集，则记录 last known firmware/build。
- 增加 “copy device identity” 和 “copy diagnostic summary” 操作。
- 为 remembered devices 显示 stale/disconnected age。

预估工作量：

中。需要扩展 store schema 和 UI；v1 不需要重后端工作。

风险：

字段太多会拖慢简单使用。保持可选并默认折叠。

验证场景：

- 添加 alias/status/owner，通过不同无线端口重连，确认同一物理设备保留 metadata。
- 导出 diagnostic summary，确认包含备注/alias。

优先级理由：

P1，因为它支持重复 lab 工作流，并补强现有身份模型。

### P2-1. 在应用内暴露发布/更新可信健康状态

问题：

发布管线很复杂：签名/公证 DMG、PKG、updater tarballs/signatures、Windows assets、GitHub `latest.json`。应用 UI 当前展示更新状态和网络错误，但除了更新提示之外，并没有暴露 feed health 或渠道可信状态。

仓库证据：

- README 和 release model 规定正式 Developer ID releases、PKG、updater artifacts、Windows signatures、release notes 和 `latest.json`。
- product overview 说明自动更新检查和 GitHub Release `latest.json` feed。
- known risks 指出 stale/missing/malformed `latest.json`，以及网络/proxy 问题容易和 feed 错误混淆。
- 历史上下文说明 updater/client 修复默认应走真实 release closure，而不是 local-only patch。

类别信号：

不通过 app store 分发的桌面工具，通常需要更透明的更新可信解释。

用户影响：

对维护者和支持用户是中等；对日常 QA 用户较低。

建议改动：

- 在 Settings 中增加 “Update health” 详情面板：
  - 当前 app version。
  - 上次检查时间。
  - Feed URL。
  - 如果已获取，显示 latest feed version。
  - 网络/feed/download 失败类别。
  - 官方 release page 链接。
- 保留高级 release completeness checks 在 docs/scripts 中，不要把 notarization 细节暴露到日常 UI。

预估工作量：

如果 updater hook 已经保存状态，则 Settings UI 低到中；如果 feed diagnostics 需要新的后端细节，则更高。

风险：

过多 release 细节会让非维护者困惑。放入 “Advanced update details”。

验证场景：

- 网络可用时，手动检查显示 latest version 或 no update，并带 timestamp。
- 网络被阻断时，UI 区分 network/proxy problem 和 “no update”。
- 官方 release link 打开 allowlisted GitHub URL。

优先级理由：

P2，因为它支持信任和可维护性，但没有设备操作安全那么紧急。

### P2-2. 把 fastboot 保持为受控 roadmap 方向

问题：

platform-tools 包含 ADB 和 fastboot 概念，但本应用当前验证的是 ADB 工作流。加入 fastboot 会从设备操作进入 firmware flashing 风险区。不应通过现有 platform-tools 支持暗示 fastboot 已经存在。

仓库证据：

- 当前 functional model 聚焦 ADB 工作流。
- 历史上下文说明本 repo 已有 ADB path resolution、platform-tools download/install、resource bundling 和 Tauri command surface，但还没有 dedicated fastboot resolver 或 flashing command path。
- 历史上下文还记录最安全的第一步范围是“把一个 `.img` 刷到用户选择的 partition”，而不是 full firmware package automation。

类别信号：

Fastboot flashing 比 ADB 设备操作风险更高，需要更强确认、兼容性检查和恢复文档。

用户影响：

战略性。如果 Cozyla firmware 工作流需要会很有用；如果作为 casual extension 加入则风险很高。

建议改动：

- 在产品需求确认前，不增加可见 fastboot tab。
- 如果推进，从受控 “Firmware Lab” 概念开始：
  - 将 fastboot binary availability 和 ADB 分开检测。
  - 检测设备 fastboot mode。
  - 选择一个 `.img` 和一个显式 partition。
  - 要求兼容性 checklist 和确认。
  - 产出 operation log。
- 将 `.pac`/Spreadtrum package automation 排除在 v1 范围外，除非单独研究。

预估工作量：

高。需要后端 resolver、command surface、安全 UX 和真实设备测试。

风险：

非常高。错误 partition/image 可能让设备变砖。

验证场景：

- 仅在实现后验证：fastboot binary detection、一个已知安全设备、一个已知安全 partition/image、可行时的 dry-run logging，以及恢复指引。

优先级理由：

P2，因为这是 roadmap 决策，不是近期产品设计修复。

## 5. 跨角色评审与 CEO 裁决

Product Designer 评审：

- 最强 concern：应用功能已经很丰富，但顶层 IA 仍读起来像工具列表，而不是设备操作工作流。
- 接受：分组导航，并让 Device Home 成为锚点。

Tech Lead 评审：

- 最强 concern：大多数建议应该复用现有命令边界和 store patterns。避免把本审计变成完整架构重构。
- 接受：先做前端编排、文案和共享目标设备控制，再扩展后端。

QA / Acceptance 评审：

- 最强 concern：目标设备不明确、破坏性 Workbench/app actions、remote-control permissions 和 wireless reset flow 都需要显式验收测试。
- 接受：P0 项被定义为安全/正确性改进，并包含验证场景。

Market lens 评审：

- 最强 concern：竞品/类别工具只应校准，不应决定。ADB Manager 的优势是 Cozyla-specific workflows，不是复制 Android Studio 或通用 ADB GUI。
- 接受：外部参考只用于类别模式：任务窗口、结构化 Logcat filters、镜像/控制、应用/包 GUI 管理。

CEO 裁决：

- 接受的变化：
  - 将目标设备清晰度、无线恢复指引和 Remote Control 权限 UX 作为第一波实现。
  - 保留 Workbench 专家能力，但增加场景包，而不是替换它。
  - 将 fastboot 保持为 gated roadmap scope。
- 拒绝或延后：
  - 完整竞品矩阵：延后，因为用户要求的是优化审计，不是市场报告。
  - 完整 UI redesign：延后，先完成 P0 安全和 IA 变更定义。
  - fastboot 实现：延后，等待明确产品需求和设备测试计划。

## 6. 建议实现顺序

Wave 1：安全和信任

1. 为 mutating tools 增加共享目标设备组件和 action gating。
2. 在 PairConnect 中加入无线恢复阶梯。
3. 增加 Remote Control 角色/信任/安全摘要和本地化角色标签。

Wave 2：工作流效率

1. 分组左侧工具栏和 Device Home next-best-actions。
2. Workbench 场景包。
3. 证据采集会话。

Wave 3：更深的运维能力

1. Saved Logcat views 和 incident mode。
2. App Workspace / 包工作流整合。
3. Update health details。

Wave 4：只作为 roadmap

1. Fastboot 可行性 PRD，并明确硬件/测试前置条件。

## 7. 后续实现的验证计划

Wave 1 最小验收集：

- 多设备目标：
  - 连接两台在线设备。
  - 没有可见目标设备选择时，mutating tools 不能执行。
  - 结果输出包含 target identity。
- 无线恢复：
  - 无 mDNS + recent endpoint。
  - mDNS connectable device。
  - reachable port 后 pair failure。
  - 多个本地网络。
  - reset host identity 只作为最终 fallback 出现。
- Remote Control：
  - 默认服务关闭。
  - 启动服务，分别分享每种角色，验证权限描述。
  - claim viewer/operator/admin，验证桌面 session state。
  - revoke 单个 trusted device 和全部 trusted devices。
  - 停止服务，并确认 UI 解释 sessions/control/audit 清理行为。

建议增加或手动收集的指标：

- 从 app 启动到首次成功设备操作的时间。
- Pair/connect 失败后的恢复完成率。
- 未显式目标设备时运行的操作数量。
- Remote session 启动成功率和首帧成功率。
- Log/evidence export 使用情况。
- Workbench 高风险命令确认率。

## 8. 已知风险和未验证项

已知风险：

- 当前工作区包含本地未提交功能改动，尤其是 Remote Control。已发布用户不一定能看到本文描述的所有界面。
- UI 建议来自代码/文档，没有来自 live screenshots。
- 部分建议需要仔细处理中英文文案。
- Workbench 和 app-management 场景包可能引入 partial-success 复杂度。

未验证项：

- 真实用户最常见的 tab sequence。
- 用户最容易误解哪些恢复消息。
- Remote Control 在 LAN 与 Tailscale 上的成功率。
- 支持/QA 期望 evidence packet 是 Markdown、HTML、ZIP 还是 issue attachment。
- Fastboot 应归入 ADB Manager，还是独立 firmware tool。

## 9. 工件验证

本次审计已执行的验证：

- 检查当前 repo status，并记录 dirty working tree。
- 在查看 raw files 前阅读 graph report。
- 审阅计划中列出的 functional model docs 和当前 UI/source files。
- 确认建议覆盖所有当前主要工具区，包括 Remote Control。
- 保留无线恢复边界：repair 保留 host identity，reset 仍是显式 fallback。
- 仅将外部来源作为轻量类别校准。

未执行的验证：

- 没有运行 live Tauri app。
- 没有截取截图。
- 没有审阅用户研究、analytics 或真实设备 session replay。
- 没有改功能代码或运行测试，因为本任务只产出产品设计 Markdown 工件。


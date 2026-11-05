# agent.md · 阑珊时刻

> 给后续编码 Agent 的项目约束与操作手册。先读本文件，再读 `README.md`、`docs/` 和当前源码。
> 本项目是公开仓库，任何提交都会进入 `sinsine/lanshan-moments`。

## 1. 项目是什么

「阑珊时刻」把一段话、截图或文章整理成统一日程 JSON，落在时间轴上，并通过 GitHub 私有仓库跨设备同步。

- 主仓库：<https://github.com/sinsine/lanshan-moments>
- 当前版本：`0.5.0`
- 目标平台：Windows（优先）+ Android（ColorOS 16 / 一加 Ace 6T 测试机）
- 设计语言：墨辰 / DarkCube 同款黑白液态玻璃，日间 + 夜间双主题
- 当前默认主题：**日间**
- 界面语言：简体中文；`src/i18n.ts` 只是预留，新增模块仍使用局部 `COPY` 对象

## 2. 技术栈与目录

| 路径 | 用途 |
|---|---|
| `src/` | React 19 + TypeScript + Vite 前端 |
| `src/components/DockWorkspace.tsx` | 递归停靠工作区、标签组、拖拽停靠、浮动窗口、右键菜单 |
| `src/lib/layout.ts` | v3 布局模型、分割/合并/浮动、版本迁移与 localStorage |
| `src/dock.css` | v0.4.3 停靠工作区 / 标签组 / 浮动窗口样式 |
| `src/v044.css` | v0.4.4–v0.5.0 液态玻璃、横向时间轴、移动页面、提供商选择 |
| `src/lib/changelog.ts` | 应用内更新日志数据 |
| `src/lib/native.ts` | Wails v2 / Wails v3 / Capacitor 三套原生桥接 |
| `src/lib/storage.ts` | localStorage 数据、主题迁移、旧 sessionStorage 凭据迁移 |
| `src/lib/providers.ts` | AI 提供商预设与 `/models` 拉取 |
| `src/v03.css` | v0.3+ 桌面窗口 / 平铺 / 独立窗口样式 |
| `v4shell/` | **当前 Windows 桌面壳：Wails v3**，多原生窗口与 HTTP 桥接 |
| `main.go` / `app.go` / `wails.json` | 旧 Wails v2 壳，仅作兼容保留 |
| `android/` | Capacitor 8 Android 工程 |
| `public/fonts/` | HarmonyOS Sans SC woff2（Light/Regular/Medium/Bold）与许可证 |
| `scripts/` | Windows / Android 构建脚本 |
| `docs/releases/` | 每个版本的发布说明 |
| `docs/assets/` | README 与设计文档截图 |

### 重要：两个 Windows 壳不要混用

- `v4shell/` 是 **Wails v3**，有原生多窗口、平铺、独立窗口、顶部窗口控制。
- 根目录 `main.go` 是 **Wails v2** 旧壳，仅保留兼容。
- 新功能优先改 `src/` + `v4shell/`；不要误把 v4 功能只加到 v2 壳。
- 发布 Windows 包时必须构建 `v4shell`，不是根目录 Wails v2。

## 3. 当前窗口系统约定

`DockWorkspace` + `src/lib/layout.ts` 是桌面主窗口的核心：

- 默认四组：添加日程 / 整理箱 / 周概览 / 时间轴，递归分割成四栏；停靠状态**无圆角**。
- 只有面板标题栏能发起拖拽；内容区点击、输入、滚动不触发窗口移动。
- 拖动期间布局不实时交换；目标标题栏合并标签，内容四边切半，正中心交换两个窗口的位置。
- 拖到工作区边缘/角落/顶部：半屏 / 四分之一 / 最大化停靠预览；双击标题栏最大化/还原。
- 标签组可切换、单个关闭/独立；拖动某个标签只移动该标签，拖动标题栏左侧握柄或单标签标题移动整组。
- 只有把窗口拖出应用视口才独立；在标题栏/应用内空白处松手不改变布局。
- 独立窗口收回到主窗口的判定为中心区域（约中央 64%）且至少一半重叠；主窗口与独立窗口都显示收回预览。
- 右键菜单支持浮动、最大化、全屏、关闭标签组、保存/恢复/重置布局。
- 拖出主窗口：`onDetach` → `/api/detach`；成功才从布局移除面板，失败保留面板。网页环境退化为工作区浮动窗口。
- Wails v3 独立窗口：`/?panel=capture|week|timeline|inbox`，只渲染对应面板；标题栏自定义收回/最小化/最大化/关闭。
- 独立窗口移回主窗口上方并松手：Go 侧检测重叠并收回面板；关闭独立窗口也会恢复面板。
- 主窗口关闭时先关闭所有独立窗口；子窗口不得让应用留下僵尸进程。
- 布局 JSON（`version: 3`）自动保存到 `localStorage`；快捷键 `Ctrl+Shift+L` 保存快照、`Ctrl+Alt+R` 重置、`Ctrl+Shift+1~4` 切换面板、`Ctrl+Shift+M` 最大化。
- 独立窗口位置按多显示器工作区限制；完全移出屏幕后自动拉回。
- 平铺状态无圆角；浮动窗口/独立窗口有圆角。
- 每个窗口关闭/独立按钮只操作当前标签，不得误删整个组。

## 4. 常用命令

```powershell
cd "D:\Data\Documents\软件工程\阑珊时刻"

npm install
npm run dev          # http://127.0.0.1:4173
npm run build        # tsc -b + vite build
npm run lint         # oxlint
npx tsc -b
```

### Windows v4（Wails v3）

```powershell
.\scripts\build-v4.ps1
```

或手动：

```powershell
npm run build
Remove-Item -Recurse -Force v4shell/dist -ErrorAction SilentlyContinue
Copy-Item dist v4shell/dist -Recurse
$env:PATH="$env:USERPROFILE\sdk\go\bin;$env:USERPROFILE\go\bin;$env:PATH"
$env:GOPROXY='https://goproxy.cn,direct'
Push-Location v4shell
go build -ldflags "-H windowsgui" -o lanshan-moments-0.5.0-windows-amd64.exe .
Pop-Location
```

必须使用 `-ldflags "-H windowsgui"`，否则启动时会先出现终端窗口。

### Android

```powershell
.\scripts\build-android.ps1
```

Android 工具链：

- JDK：`C:\Users\Fre5h\sdk\jdk21`
- SDK：`C:\Users\Fre5h\AppData\Local\Android\Sdk`
- 构建目录：因为项目路径含中文，实际复制到 ASCII 路径 `C:\Users\Fre5h\dev\lanshan-android` 后构建
- 修改 `android/` 后要同步到 ASCII 目录，再跑 `gradlew assembleDebug`
- APK 目前是 **v2 签名**，没有 v1 JAR 签名；Android 7+ 正常，但部分第三方安装器会误报“没有签名文件”
- `versionName`/`versionCode` 在 `android/app/build.gradle`

## 5. 发布规范

文件名必须遵循：

```text
<项目名>-<版本>-<操作系统>-<架构>[-<变体>].<扩展名>
```

当前项目名固定为 **`lanshan-moments`**。

示例 v0.5.0：

- `lanshan-moments-0.5.0-windows-amd64.exe`
- `lanshan-moments-0.5.0-android-universal.apk`
- `lanshan-moments-0.5.0-source.zip`

发布步骤：

1. 修改 `package.json`、`app.go`、`src/lib/config.ts`、`android/app/build.gradle` 版本号；
2. `npm install --package-lock-only`；
3. 跑 `npx tsc -b`、`npm run lint`、`npm run build`；
4. 构建 Windows 与 Android；
5. 更新 `README.md`、`docs/releases/vX.Y.Z.md`；
6. `git commit`、打 tag、`gh release create` 上传三个文件；
7. 检查 `gh api repos/sinsine/lanshan-moments/releases/tags/vX.Y.Z --jq '.assets[].name'`。

如果 GitHub HTTPS 推送持续 `Recv failure: Connection was reset`，可使用 GitHub API 上传 blob/tree/commit 并把 tag/ref 指向新 commit；Release 的 source zip 必须与最终源码一致。

## 6. 不能破坏的规则

- **不要恢复默认演示日程**：首次安装为空；旧 `evt_seed_*` 会被清理。
- **DeepSeek 默认地址**：`https://api.deepseek.com`，不是 `https://api.deepseek.com/v1`；旧配置会自动迁移。
- **API Key / GitHub Token**：存 `localStorage`；不要写进仓库、日志、截图。Wails 的 WebView2 数据目录固定为 `%APPDATA%\LanshanMoments`，并迁移旧 exe 名目录，更新版本后登录保持。
- **默认主题**：日间；旧用户会迁移一次，之后保留用户选择。
- **字体**：全站 HarmonyOS Sans SC；不要重新引入系统字体作为首选。字体文件约 17 MB，`HarmonyOS-Sans.zip` 不得提交（已 gitignore）。
- **窗口控制**：顶部导航集成最小化/最大化/关闭；Windows 无原生标题栏。
- **独立窗口**：必须来自 `v4shell`，不能只做主窗口内浮动冒充。
- **平铺/标签页**：平铺无圆角；标签合并/切换不能丢面板或打乱其他组。
- **主题**：所有新增颜色必须使用 `var(--...)` token，同时检查日间/夜间。
- **移动端**：点击不能出现蓝框；Android 启动隐藏状态栏；周表 / 时间轴 / 添加 / 我的四栏等权重，添加与我的为内联页而非抽屉/弹窗。
- **时间轴**：电脑端横向、手机端纵向；横向按小时与泳道排布。
- **设置**：桌面端从标题栏「设置」展开菜单进入，隐藏提醒；手机端在「我的」栏目内嵌设置。

## 7. 已知问题 / 容易踩的坑

- **Wails v2 vs v3**：根目录 `main.go` 不会产生独立窗口；修改 `v4shell/main.go`。
- **路径含中文**：Wails/Gradle 可能失败；使用 `C:\Users\Fre5h\dev\...` ASCII 暂存路径。
- **v4shell/dist 是生成物**：已 gitignore；构建前必须从根 `dist` 复制。
- **字体路径**：CSS 使用 `/fonts/...`；构建后确认 `dist/fonts` 存在。
- **Android APK 签名**：v2 only；不要声称有 v1 签名。
- **DeepSeek 401**：
  - 空 Key 已在 UI 拦截；
  - 旧 `sessionStorage` 凭据会迁移；
  - 若填了有效 Key 仍 401，需要用户提供完整报错和接口地址，不能靠猜。
- **无滚动布局**：采集面板已紧凑化；时间轴/周概览/整理箱在数据多时仍可能滚动，尚未完全解决。
- **不要用超长内联 PowerShell here-string**：容易生成非法 tool JSON；优先写小文件或用 `write`/`edit`。
- **不要凭截图假设功能正常**：独立窗口、拖出、拖回、标签合并都要实际运行/自动化验证。

## 8. 验证清单

桌面：

- [ ] `npm run build`、`npx tsc -b`、`npm run lint` 通过
- [ ] 日间/夜间都检查
- [ ] 四窗口铺满、无圆角
- [ ] 只有标题栏能拖动；内容区输入/选择文字不移动窗口
- [ ] 拖动标签页只移动该标签，拖动标题栏移动整组
- [ ] 拖到另一个标题栏合并；四边切半；正中心交换；只有拖出应用窗口才独立
- [ ] 拖到面板四边形成分割；拖到边缘/角落/顶部显示半屏/四分之一/最大化预览
- [ ] 拖动分隔条改变比例
- [ ] 电脑端时间轴为横向泳道，手机端为纵向
- [ ] 标题栏「窗口」右侧有「设置」菜单，桌面无提醒 tab
- [ ] 更新 exe 名后仍沿用 `%APPDATA%\LanshanMoments`，登录不丢
- [ ] 独立窗口移回主窗口恢复面板；关闭/收回独立窗口也恢复面板
- [ ] 布局保存、刷新恢复、重置默认布局
- [ ] 顶部最小化/最大化/关闭可用；关闭主窗口不残留独立窗口
- [ ] 无终端窗口

移动端：

- [ ] 手机周表/时间轴/添加/我的四栏可切换；添加与我的为内联页
- [ ] 手机时间轴选中日期为深底浅字
- [ ] 手机模型提供商选择弹层跟随应用主题
- [ ] 状态栏隐藏
- [ ] 点击无蓝框
- [ ] APK 可安装（ColorOS 16）

## 9. 代码风格

- TypeScript 严格模式；不要用 `any` 绕过。
- 组件使用函数组件 + hooks；避免在 effect 里做不必要的同步 `setState`。
- 中文 UI 文案集中在组件顶部 `COPY` 或 `src/i18n.ts`，为未来多语言预留。
- CSS 优先使用 `src/index.css` 的设计 token；窗口系统样式在 `src/v03.css`。
- 新增持久化字段时，在 `loadSettings` / `loadEvents` 里做向后兼容迁移。
- 不提交 `node_modules`、`dist`、`v4shell/dist`、`release/`、`HarmonyOS-Sans.zip`、`.tmp`、截图临时文件。

## 10. 交付原则

- 不要用“已实现”替代“已验证”；明确区分编译通过、浏览器验证、Wails 原生验证、真机验证。
- 未完成的条目写入 `docs/releases/vX.Y.Z.md` 的「未包含」。
- 每个版本都要更新 README、发布说明、tag 和 GitHub Release。
- 用户明确提出的视觉/交互约束优先于“通用最佳实践”；不确定时先问，而不是自行简化。

# agent.md · 阑珊时刻

> 给后续编码 Agent 的项目约束与操作手册。先读本文件，再读 `README.md`、`docs/` 和当前源码。
> 本项目是公开仓库，任何提交都会进入 `sinsine/lanshan-moments`。

## 1. 项目是什么

「阑珊时刻」把一段话、截图或文章整理成统一日程 JSON，落在时间轴上，并通过 GitHub 私有仓库跨设备同步。

- 主仓库：<https://github.com/sinsine/lanshan-moments>
- 当前版本：`0.4.2`
- 目标平台：Windows（优先）+ Android（ColorOS 16 / 一加 Ace 6T 测试机）
- 设计语言：墨辰 / DarkCube 同款黑白液态玻璃，日间 + 夜间双主题
- 当前默认主题：**日间**
- 界面语言：简体中文；`src/i18n.ts` 只是预留，新增模块仍使用局部 `COPY` 对象

## 2. 技术栈与目录

| 路径 | 用途 |
|---|---|
| `src/` | React 19 + TypeScript + Vite 前端 |
| `src/components/TiledWorkspace.tsx` | 桌面平铺窗口、拖拽回流、分隔条、标签页组、拖出独立窗口 |
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

`TiledWorkspace` 是桌面主窗口的核心：

- 默认四组：添加日程 / 整理箱 / 周概览 / 时间轴，自动铺满，平铺状态**无圆角**。
- 拖动标题栏：ghost + 目标虚线预览 + 其他组实时回流；松手 CSS transition 落位。
- 拖动分隔条：可改左右列宽、左列上下比例、右列上下比例。
- 拖到另一个窗口标题栏：合并成标签页组；点击标签切换；关闭/独立按钮作用于当前标签。
- 拖出工作区：`onDetach` → `/api/detach?panel=...` → Wails v3 创建独立原生窗口。
- 独立窗口 URL：`/?panel=capture|week|timeline|inbox`，只渲染对应面板。
- 独立窗口移回主窗口上方：Go 侧 `WindowDidMove` 检测重叠，关闭独立窗口并通知主窗口恢复。
- 主窗口与独立窗口通过 localStorage 的 `storage` 事件同步日程和设置。
- 平铺状态无圆角；独立窗口/浮动窗口有圆角。
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
go build -ldflags "-H windowsgui" -o lanshan-moments-0.4.2-windows-amd64.exe .
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

示例 v0.4.2：

- `lanshan-moments-0.4.2-windows-amd64.exe`
- `lanshan-moments-0.4.2-android-universal.apk`
- `lanshan-moments-0.4.2-source.zip`

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
- **API Key / GitHub Token**：存 `localStorage`；不要写进仓库、日志、截图。
- **默认主题**：日间；旧用户会迁移一次，之后保留用户选择。
- **字体**：全站 HarmonyOS Sans SC；不要重新引入系统字体作为首选。字体文件约 17 MB，`HarmonyOS-Sans.zip` 不得提交（已 gitignore）。
- **窗口控制**：顶部导航集成最小化/最大化/关闭；Windows 无原生标题栏。
- **独立窗口**：必须来自 `v4shell`，不能只做主窗口内浮动冒充。
- **平铺/标签页**：平铺无圆角；标签合并/切换不能丢面板或打乱其他组。
- **主题**：所有新增颜色必须使用 `var(--...)` token，同时检查日间/夜间。
- **移动端**：点击不能出现蓝框；Android 启动隐藏状态栏。

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
- [ ] 拖动标题栏有 ghost/预览/实时回流/动画
- [ ] 拖动分隔条改变比例
- [ ] 拖到另一个标题栏合并为标签页
- [ ] 拖出工作区创建独立原生窗口
- [ ] 独立窗口移回主窗口恢复面板
- [ ] 顶部最小化/最大化/关闭可用
- [ ] 无终端窗口

移动端：

- [ ] 手机周表/时间轴/设置可切换
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

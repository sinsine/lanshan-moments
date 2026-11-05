# 阑珊时刻

> 把散落的时间，收拢成一条看得见的光带。  
> 一段话、一张截图、一篇备忘 → AI 整理成统一日程 JSON → 落在时间轴上。

![桌面端：横向时间轴与六区停靠](./docs/assets/v0.5.0/desktop.png)

**v0.5.0 · 登录、横轴与六区拖拽。** 桌面端更新后保留登录与本地数据；时间轴改为横向泳道；小窗口拖拽细分为标题合并、四边切半、中心交换，只有拖出应用窗口才独立；设置收进标题栏菜单，提醒在电脑端隐藏。手机端改为周表 / 时间轴 / 添加 / 我的四栏，修复日期选中态发白，并让 GitHub 头像与主题化模型选择器保持一致。

<p>
  <img src="./docs/assets/v0.5.0/mobile-week.png" alt="手机端周表" width="260" />
  <img src="./docs/assets/v0.5.0/mobile-add.png" alt="手机端添加日程" width="260" />
  <img src="./docs/assets/v0.5.0/mobile-me.png" alt="手机端我的" width="260" />
</p>

在线 Demo：GitHub Pages 首次部署正在队列中；完成前请本地 `npm run dev`，或直接下载 Windows / Android 安装包。  
最新安装包：[GitHub Releases](https://github.com/sinsine/lanshan-moments/releases)

技术判断、排期与风险见 [可行性分析](./docs/feasibility.md)；界面与交互取舍见 [前端设计讨论](./docs/frontend-design.md)；数据协议见 [数据模型](./docs/data-model.md)。

---

## 这一版新增

- **桌面登录持久化**：WebView 数据固定到 `%APPDATA%\LanshanMoments`，并迁移旧版本数据；更新后不再掉登录、布局与本地日程。
- **手机日期选中修复**：触摸后的 `:hover` 奶油色表面不再覆盖选中日期，选中态保持深底浅字。
- **删除同步**：删除写入墓碑并自动同步云端；撤销会用新的时间戳恢复，避免被远端墓碑盖回。
- **手机四栏**：周表 / 时间轴 / 添加 / 我的等权重；添加不再用抽屉，我的不再用弹窗，设置直接展开在栏目内。
- **GitHub 头像**：登录后在标题栏同步按钮和「多设备同步」账号卡中显示头像。
- **主题化模型选择**：模型提供商改为应用内选择弹层，不再打开系统默认主题的原生下拉菜单。
- **横向时间轴**：电脑端小时刻度沿横轴、事件按泳道排列，左右滚动；手机端保持纵向时间轴。
- **标签排序与默认布局**：左右拖动标签页可调整组内顺序；首次启动布局为左侧添加/整理，右侧时间轴在上、周概览在下。
- **六区拖拽**：标题合并为标签、四边各切一半、正中心交换位置；只有拖出应用窗口才独立，全部带预览动画。
- **电脑端隐藏提醒**：设置仅保留模型接口 / 多设备同步 / 数据。
- **设置展开栏**：标题栏「窗口」右侧新增「设置」菜单，按模型接口、多设备同步、数据分项打开。
- **延续**：标签页单独拖动、DeepSeek 思考强度、多日程 JSON、SHA 预检、液态玻璃、更新日志与淡奶白日间模式。

---

## Windows v0.5.0 构建

桌面壳在 `v4shell/`（Wails v3），构建前先把前端产物复制进去：

```powershell
npm run build
Remove-Item -Recurse -Force v4shell/dist -ErrorAction SilentlyContinue
Copy-Item dist v4shell/dist -Recurse
Push-Location v4shell
go build -ldflags "-H windowsgui" -o lanshan-moments-0.5.0-windows-amd64.exe .
Pop-Location
```

生成 `v4shell/lanshan-moments-<version>-windows-amd64.exe`。v0.3 的 Wails v2 构建仍保留在根目录 `wails.json`。

## 快速开始（网页版）

需要 Node.js 22+。

```bash
npm install
npm run dev
# http://localhost:5173
```

不配置任何 Key 的演示路径：

1. 点输入框下方的「示例」。
2. 点圆形「↑」。
3. 右侧出现 4 条草稿；其中“和小林吃饭”会追问结束时间，“周会”会追问是否参加。
4. 回答选项、取消“护照续签”后点「写入时间轴」。
5. 点顶部「本周」查看整周；点「JSON」查看统一格式。

---

## Windows 端

已构建的便携版在 [GitHub Releases](https://github.com/sinsine/lanshan-moments/releases) 提供（Wails v2 + WebView2，约 14 MB）。本地构建脚本：`scripts/build-windows.ps1`。

手动构建：

```powershell
npm run build
wails build -s -skipbindings -clean -webview2 embed
# 输出：build/bin/lanshan.exe
```

要求：Go 1.26+、Wails v2.17+、WebView2 Runtime。项目路径包含中文时，建议在 ASCII 路径（例如 `C:\dev\lanshan`）下构建；`main.go` 使用 `//go:embed all:dist`。

Windows 端使用 Go 原生代理访问 GitHub Device Flow，绕过 WebView 的 CORS 限制。

---

## Android 端

已构建的调试包在 [GitHub Releases](https://github.com/sinsine/lanshan-moments/releases) 提供。本地构建脚本：`scripts/build-android.ps1`。

手动重新构建：

```powershell
# 需要 JDK 21（Capacitor 8 要求）、Android SDK 36、platform-tools
$env:JAVA_HOME="C:\path\to\jdk21"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
# 输出：android\app\build\outputs\apk\debug\app-debug.apk
```

测试机：**一加 Ace 6T / ColorOS 16（Android 16）**。USB 调试 + USB 安装后：

```powershell
adb install -r release\lanshan-moments-0.5.0-android-universal.apk
```

ColorOS 额外设置（不设置会出现“通知不响/后台被杀”）：

- 设置 → 通知与状态栏 → 应用通知管理 → 阑珊时刻：允许通知、横幅、锁屏。
- 设置 → 电池 → 更多设置 → 应用耗电管理 → 阑珊时刻：允许完全后台行为、允许自启动。
- 设置 → 应用 → 特殊应用权限 → 闹钟和提醒：允许。
- 最近任务里给阑珊时刻加锁。

提醒在应用设置 → 提醒中开启；系统限制下不能保证 100% 准点，未授权精确闹钟时会提示可能延迟。

---

## GitHub 连接（网页授权）

“用 GitHub 网页登录”使用 **OAuth Device Flow**：点击后打开 GitHub 授权页，输入设备码即可，不需要把 client secret 放进客户端。

首次需要创建一个 OAuth App（约 2 分钟）：

1. 打开 GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**。
2. Application name 填 `阑珊时刻`；Homepage URL 填 `https://github.com/sinsine/lanshan-moments`。
3. **Redirect URI** 填同一个地址；如果输入框不可编辑，先点 **Add redirect URI**。
4. 勾选 **Enable Device Flow**；**取消勾选** **Expire user access tokens**（当前版本尚未实现 refresh token）。
5. 点 **Register application**。进入应用页后确认 Device Flow 已开启，再复制 **Client ID**（不是 Client secret）。当前安装包已内置该 Client ID，普通用户不需要自己创建 OAuth App。
6. 粘贴到「设置 → 多设备同步 → OAuth App Client ID」，保存。
7. 点击「用 GitHub 网页登录」→ 复制设备码 → 在 GitHub 页面确认 → 选择/新建私有仓库。

详细图文步骤：[GitHub OAuth 手把手配置](./docs/github-oauth-setup.md)。

也可以把 Client ID 写进 `.env`：

```bash
VITE_GITHUB_CLIENT_ID=Iv1.xxxxxxxx
```

> 浏览器 PWA 受 CORS 限制，无法直接调用 GitHub 设备码接口；网页版请使用“访问令牌”。Windows/Android 原生壳通过 Go / CapacitorHttp 代理，可以完成网页授权。客户端永远不需要 client secret。

### 访问令牌兜底

1. 新建一个 **私有** 仓库（例如 `lanshan-schedule`）。
2. 创建 [fine-grained PAT](https://github.com/settings/personal-access-tokens/new)，只勾选该仓库的 **Contents: Read and write**。
3. 在 GitHub 连接弹窗选择「使用访问令牌」，粘贴并验证，选择仓库后连接。

同步是事件级合并，不是“远端覆盖本地”；删除使用墓碑，SHA 冲突会重拉、合并、重试。完整协议见 [data-model.md](./docs/data-model.md)。

---

## 界面

| 桌面 · 深色 | 桌面 · 浅色 |
|---|---|
| ![深色](./docs/assets/v0.2/desktop-day.png) | ![浅色](./docs/assets/v0.2/desktop-light.png) |

| 移动端 · 时间轴 | 移动端 · 本周 |
|---|---|
| ![移动端时间轴](./docs/assets/v0.2/mobile-day.png) | ![移动端本周](./docs/assets/v0.2/mobile-week.png) |

| 整理稿与 AI 追问 | GitHub 图形化连接 |
|---|---|
| ![整理稿](./docs/assets/v0.2/review.png) | ![GitHub](./docs/assets/v0.2/github.png) |

---

## 技术栈

| 层 | 实现 |
|---|---|
| UI | React 19 + TypeScript + Vite 8 |
| 样式 | 原生 CSS + 墨辰黑白玻璃 design tokens |
| 本地存储 | localStorage（Demo）；生产迁移 IndexedDB / SQLite |
| AI | OpenAI Chat Completions 兼容接口，BYOK；`temperature=0.1`，JSON 输出 |
| 同步 | GitHub Contents API，单 `schedule.json`，事件级 LWW + 墓碑 |
| Windows | Wails v2 + Go + WebView2；原生 GitHub HTTP 代理 |
| Android | Capacitor 8 + JDK 21 + SDK 36；Local Notifications |
| 通知 | `@capacitor/local-notifications`，提前 10 分钟；精确闹钟授权入口 |
| 多语言 | 简体中文；`src/i18n.ts` + 模块级 COPY，预留语言包 |

```
.
├── android/              # Capacitor Android 工程
├── build/                # Wails 图标/清单
├── docs/                 # 可行性、设计、数据模型、截图
├── public/               # PWA manifest / 图标 / service worker
├── schema/               # 统一日程 JSON Schema
├── scripts/              # 构建脚本（后续补）
├── src/
│   ├── components/       # 采集/时间轴/本周/整理稿/GitHub/设置
│   ├── lib/              # ai / parser / clarify / sync / notifications
│   ├── i18n.ts
│   └── App.tsx
├── app.go / main.go      # Wails Go 壳
├── capacitor.config.ts
└── release/              # 本地构建产物（不提交，随 Release 上传）
```

---

## 版本与发布

- `v0.1.0`：可行性 Demo（Web）。
- `v0.2.0`：本周概览、墨辰视觉、AI 追问、必填校验、GitHub 图形化连接、Windows / Android 初版。
- `v0.2.1`：ColorOS 16 / Android 16 安全区修正，版本号同步。
- `v0.2.2`：内置公开 Client ID；已验证 GitHub 设备码接口。
- `v0.3.0`：顶部菜单、自由浮动窗口、手机周表、状态栏隐藏、模型预设/获取模型/Key 本地保存。
- `v0.3.1`：401 提示、同步高级项折叠、移除时间轴本周按钮、无演示日程、登录持久化、无边框窗口。
- `v0.4.0`：Wails v3、平铺实时回流、拖拽预览、独立原生窗口、跨窗口同步。
- `v0.4.1`：HarmonyOS Sans、默认日间模式、可拖动比例、DeepSeek 地址、无终端启动。
- `v0.4.2`：标签页组合、采集面板紧凑化、拖拽预览稳定化。
- `v0.4.3`：递归停靠工作区、标签组合并、四角/边缘停靠、最大化/全屏、浮动窗口、布局持久化、独立窗口拖回与生命周期修复。
- `v0.4.4`：标签页单独拖拽、DeepSeek 思考强度与多日程、同步 SHA、收回预览、AI 设置自动获取/测试、更新 403、液态玻璃、更新日志、淡奶白日间模式。
- `v0.5.0`：桌面登录持久化、手机日期选中修复、删除同步、手机四栏、GitHub 头像、主题化提供商选择、横向时间轴、六区拖拽、电脑端隐藏提醒、标题栏设置菜单。

每个版本会提交到 GitHub，并在 Releases 上传 Windows 可执行文件和 Android APK。源码提交与构建产物分开，避免仓库体积膨胀。

---

## 已知限制

- 网页版 GitHub Device Flow 受 CORS 限制，只能走访问令牌；Windows/Android 原生端可用网页授权。
- Android 桌面小组件尚未实现；本地通知与精确闹钟授权已接入。
- 精确闹钟受 ColorOS/Android 后台策略影响，不能承诺 100% 准点。
- 重复事件、拖拽改期、时区选择器、E2EE 尚未进入 1.0。
- 图片解析需要支持视觉的模型；未配置时明确提示，不假装 OCR。
- 六区拖拽针对主窗口内的停靠小窗口；已经独立的原生窗口之间不会直接合并，需要先收回主窗口。
- 电脑端隐藏提醒入口；提醒仍以 Android 原生端为主。
- 桌面登录迁移会在 v0.5.0 首次启动时执行一次；迁移完成后 WebView 数据固定到 `%APPDATA%\LanshanMoments`。
- 一个原生独立窗口目前只承载一个面板；多标签组拖出时只把当前标签变成独立窗口，其余标签留在主窗口。
- 网页版的浮动窗口是工作区内浮动，不是系统原生窗口；系统窗口只在 Wails v3 壳中提供。
- 布局快照保存在本机 `localStorage`，暂不随 GitHub 同步。
- 思考强度参数只发给官方 DeepSeek 接口；第三方 OpenAI 兼容网关可能忽略或拒绝该扩展。
- 未连接 GitHub 且 API 匿名额度耗尽时，检查更新仍可能提示 403；连接 GitHub 后会自动携带 Token。

---

## 安全与隐私

- 公开仓库不包含真实日程、Token、API Key；示例数据全部虚构。
- API Key 与 GitHub Token 按用户要求保存在本机 `localStorage`，关闭/更新应用后仍保留。原生端后续会迁移到系统钥匙串。
- fine-grained PAT 只申请目标私有仓库的 Contents 读写；OAuth 只使用公开 Client ID。
- 同步可选；默认单机可用。日程敏感，是否把原文发给模型必须由用户选择。

---

## License

[MIT](./LICENSE)









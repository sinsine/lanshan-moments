# GitHub OAuth 手把手配置

> 目标：拿到一个 **Client ID**，让「用 GitHub 网页登录」可用。  
> 唯一需要复制的是 **Client ID**；**Client secret 不要复制、不要发给任何人**，本应用不需要它。

## 0. 准备

- 已登录 GitHub 账号 `sinsine`。
- 能打开：<https://github.com/settings/applications/new>
- 这个页面如果 404，先打开 <https://github.com/settings/developers>，再点 **OAuth Apps** → **New OAuth App**。

## 1. 填写创建表单

| 字段 | 填什么 |
|---|---|
| Application name | `阑珊时刻` |
| Homepage URL | `https://github.com/sinsine/lanshan-moments` |
| Application description | `AI 日程整理与跨设备时间轴`（可选） |
| Authorization callback URL | `https://github.com/sinsine/lanshan-moments` |

说明：Device Flow 不使用 callback URL，但 GitHub 要求必须填；填项目主页即可。

点 **Register application**。

## 2. 勾选 Device Flow（最关键）

创建成功后会进入 OAuth App 的详情页：

1. 找到 **Enable Device Flow** 复选框。
2. 勾选它。
3. 点页面底部的 **Update application**。

如果不勾选，应用调用 `https://github.com/login/device/code` 会被 GitHub 拒绝。

## 3. 复制 Client ID

在同一个详情页顶部：

- **Client ID**：形如 `Iv1.xxxxxxxx` 或 `Ov23li...`，复制它。
- **Client secrets**：不要点“Generate a new client secret”；不要复制；不要发给我。
- 也**不要**点 “Revoke all user tokens” 之类的按钮。

## 4. 填进阑珊时刻

方式 A（推荐，立即生效）：

1. 打开阑珊时刻。
2. 设置 → 多设备同步。
3. 找到 **OAuth App Client ID（可选，开发者配置）**。
4. 粘贴 Client ID → 保存设置。
5. 关闭设置，点顶部同步按钮 →「用 GitHub 网页登录」。
6. 复制设备码 → 点“打开 GitHub 授权页” → 在网页里粘贴设备码 → 授权。
7. 回到应用，选择或新建一个私有仓库 → 连接并同步。

方式 B：把 Client ID 发给我，我写入默认配置并重新打包；之后每个用户打开就能直接点按钮。

> Client ID 是公开信息，可以发在聊天/Issue 里。  
> Client secret 是密码，不能发；本项目不需要它。

## 5. 常见卡点

| 现象 | 处理 |
|---|---|
| 设置里填了 ID，但按钮还是灰的 | 保存设置后关闭再打开 GitHub 连接弹窗；确认没有多余空格 |
| 浏览器点登录后报 CORS / Failed to fetch | 浏览器 PWA 不能直接调用设备码接口；用 Windows/Android 客户端，或改用「访问令牌」 |
| GitHub 说 Device Flow 未启用 | 回到 OAuth App 详情页勾选 **Enable Device Flow** 并 Update |
| 授权后没有仓库 | 账号下没有私有仓库时，在弹窗底部输入 `lanshan-schedule` 新建 |
| 授权页显示 “device code expired” | 设备码过期，关闭弹窗重开，重新获取 |
| 403 / rate limit | 稍后重试；确认 OAuth App 没有被删除或限制 |
| 想撤销授权 | GitHub → Settings → Applications → 找到「阑珊时刻」→ Revoke |

## 6. 安全边界

- 应用只申请 `repo read:user`，用于读取/创建私有仓库。
- 客户端只保存公开 Client ID；**没有 client secret**。
- Token 在网页端只放 `sessionStorage`；生产版会迁移系统钥匙串。
- 如果以后做托管代理，才需要服务端保存 secret；当前版本不需要。

## 7. 我需要你回什么

完成后回我两样：

1. **Client ID**（可以公开）；
2. 是否已经勾选 **Enable Device Flow**。

我收到后会把它写进默认配置，重新构建 Windows/Android 包，并跑一次真实授权验证。

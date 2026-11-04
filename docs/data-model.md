# 数据模型与同步协议

> 版本：v0.1 · 2026-11-04  
> JSON Schema：[schema/schedule.schema.json](../schema/schedule.schema.json)  
> 同步参考：[DarkCube](https://github.com/sinsine/DarkCube)（本地优先 + GitHub 私有仓库），但改为事件级合并。

---

## 1. 为什么不用“每天一个 Markdown”

DarkCube 的日记模型是“一天一篇 Markdown”，这适合日记，因为写入单位天然是“天”。日程不同：

- 同一天会有多个事件，两个设备可能分别改不同事件。
- 一个事件可能从 11 月 11 日改到 11 月 12 日。
- 删除、拆分、合并都需要稳定的身份。

所以使用**事件数组 + 稳定 id + 事件级修订**。文档保持可读的 JSON，GitHub 提交历史自然成为版本历史。

---

## 2. 规范示例

```json
{
  "schemaVersion": "1.0",
  "timezone": "Asia/Shanghai",
  "updatedAt": "2026-11-04T14:41:38.742Z",
  "deviceId": "dev_66a01db",
  "events": [
    {
      "id": "evt_01J9Z3K8Y6Q4M2V7T1R5X8B0C3",
      "title": "产品评审",
      "start": "2026-11-11T15:00:00+08:00",
      "end": "2026-11-11T16:30:00+08:00",
      "allDay": false,
      "timezone": "Asia/Shanghai",
      "location": "3 楼会议室",
      "notes": "带新版原型",
      "deadline": null,
      "category": "work",
      "status": "tentative",
      "source": {
        "kind": "text",
        "excerpt": "下周三下午3点到4点半，产品评审，3楼会议室"
      },
      "confidence": 0.93,
      "warnings": ["原文没有年份，已按最近的日期补全"],
      "createdAt": "2026-11-04T14:40:12.000Z",
      "updatedAt": "2026-11-04T14:41:38.742Z",
      "deletedAt": null,
      "deviceId": "dev_66a01db",
      "rev": 1
    }
  ]
}
```

### 2.1 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 当前固定 `"1.0"`；破坏性变更升主版本 |
| `timezone` | 是 | 文档默认时区（IANA），用于没有显式时区的输入 |
| `updatedAt` | 是 | 文档最后更新时间，UTC；用于展示/调试，不用于单事件决胜 |
| `deviceId` | 是 | 安装级设备 ID；同步平局时决胜 |
| `events` | 是 | 事件数组；包含墓碑 |
| `id` | 是 | `evt_` + UUID/ULID；跨设备稳定，永不复用 |
| `title` | 是 | 用户可读标题，≤120 字 |
| `start` | 是 | 带偏移的 ISO 8601；`null` = 待安排 |
| `end` | 是 | 带偏移的 ISO 8601；`null` = 未指定/全天 |
| `allDay` | 是 | 全天事件；此时 `start` 为当地 00:00，`end` 为 `null` |
| `timezone` | 是 | 事件语义时区；跨时区保留原时区 |
| `location` | 否 | 地点；没有就留空，不猜 |
| `notes` | 否 | 备注，≤1000 字 |
| `deadline` | 否 | `YYYY-MM-DD`，用于“只有截止日期”的任务 |
| `category` | 是 | `work` / `life` / `health` / `focus` / `other` |
| `status` | 是 | `confirmed` / `tentative`；AI 草稿默认 tentative |
| `source` | 是 | `kind` + 原文片段；不存整张图片 |
| `confidence` | 是 | 0–1；仅表示解析把握，不是事实正确概率 |
| `warnings` | 是 | 面向用户的中文提示；可为空数组 |
| `createdAt` | 是 | 创建时间，UTC |
| `updatedAt` | 是 | 最后编辑时间，UTC；同步合并主依据 |
| `deletedAt` | 是 | 软删除墓碑；非 null 时 UI 隐藏，仍同步 |
| `deviceId` | 是 | 最后编辑设备 |
| `rev` | 是 | 设备内修订号；用于审计/调试 |

### 2.2 时间语义

- **带偏移**：`2026-11-11T15:00:00+08:00` 表示上海时间 15:00。不要存无偏移的本地时间。
- **全天**：`start` 为当地 00:00，`end` 为 `null`；`allDay=true`。全天事件跨时区时仍按“当地日期”理解。
- **待安排**：`start=null`；可以没有日期，也可以有 `deadline`。
- **截止日期**：`deadline` 只表示“某天之前”，不是事件开始时间；不要自动变成当天全天的会议。
- **跨天**：v1.0 允许 `end` 落在次日；UI 在日视图里截断显示，周/月视图显示跨天条。
- **重复**：v1.0 不实现。v1.1 计划增加 `recurrence` 与 `exdates`，并保持“主事件 + 例外”的结构，避免把每次展开都写进 JSON。
- **时区显示**：列表默认显示设备当地时区；事件详情显示原时区与偏移，跨时区时加“原时区”标签。

生产实现建议使用 Temporal API（或 Luxon）处理 IANA 时区与 DST；当前 Demo 使用浏览器本地时区 + 偏移，覆盖常见场景，但不处理复杂 DST/跨时区。

---

## 3. 同步：事件级 LWW + 墓碑

### 3.1 远端布局（MVP）

```
<private-repo>/
  schedule.json          # 全部事件（v1.0）
  README.md              # 可选：说明这是阑珊时刻的数据仓库
```

当事件数 > 500 或文件 > 500 KB 时，升级为按月分片：

```
schedule/
  manifest.json          # schemaVersion, shards: ["2026-11.json", ...]
  2026-11.json
  2026-12.json
```

分片后每个文件独立合并，减少冲突和传输量；manifest 只记录分片列表，不参与事件决胜。

### 3.2 合并规则

伪代码：

```ts
function merge(local, remote) {
  const byId = new Map()
  for (const event of remote.events) byId.set(event.id, event)
  for (const event of local.events) {
    const other = byId.get(event.id)
    if (!other) {
      byId.set(event.id, event)
      continue
    }
    byId.set(event.id, newer(event, other))
  }
  return { ...local, events: [...byId.values()], updatedAt: now() }
}

function newer(a, b) {
  const ta = Date.parse(a.updatedAt)
  const tb = Date.parse(b.updatedAt)
  if (ta !== tb) return ta > tb ? a : b
  return a.deviceId >= b.deviceId ? a : b
}
```

- **墓碑也参与合并**：`deletedAt` 非 null 的事件不能因为“本地没有”就被复活。只要墓碑的 `updatedAt` 更新，就保持删除。
- **平局**：同一毫秒修改，按 `deviceId` 字典序决胜；确定性，不随机。
- **不整文件覆盖**：远端不会无条件覆盖本地；两边的新事件都保留。
- **Git 历史**：即使 LWW 选了旧版本，用户仍可从提交历史找回；UI 提供“查看历史”入口（Beta）。
- **冲突提示**：如果同一事件在两端都被修改，且时间差 < 5 秒，提示“两端都改过，已保留较新一版；可在 Git 历史中找回另一版”。

### 3.3 删除

- 删除 = 设置 `deletedAt` + `updatedAt` + `rev++`，不从数组移除。
- 墓碑保留 90 天；超过后由“压缩任务”清理（至少一台设备确认已同步）。
- 清空所有数据也写墓碑，而不是清空数组；否则另一台设备会把旧事件推回来。
- UI 的“清空本机”必须区分：
  - 仅清本机缓存（下次同步会拉回）；
  - 删除云端数据（写墓碑并推送）。

### 3.4 推送流程与重试

```ts
async function sync() {
  const remote = await adapter.pull()          // 404 => null
  const merged = remote ? merge(local, remote) : local
  if (!changed(merged, remote)) return
  try {
    await adapter.push(remote, merged)         // 带 sha / parent commit
  } catch (e) {
    if (!isConflict(e)) throw e
    const fresh = await adapter.pull()
    const retry = merge(merged, fresh)
    await adapter.push(fresh, retry)          // 最多重试 2 次
  }
}
```

GitHub Contents API 的 `PUT` 带 `sha`，旧 SHA 会返回 409/422；捕获后重新拉取、合并、重试。Git Data API 方式则用最新 `ref` 作为 parent，失败时重读 ref。

### 3.5 时钟问题

MVP 用 `updatedAt`，依赖设备时钟。手机/电脑时间通常由系统校准，但仍可能偏差。Beta 建议加 **HLC（Hybrid Logical Clock）**：

```
hlc = `${physicalMs.toString(36)}-${counter.toString(36)}-${deviceId}`
```

- 收到远端 HLC 时，把本地物理时间推到不小于远端；
- 同一毫秒内用 counter 递增；
- 比较时先比 physical，再比 counter，最后比 deviceId；
- JSON 保留 `hlc` 字段（可选），旧客户端忽略。

这样即使设备时钟差几秒，也不会把新编辑误判为旧编辑。

### 3.6 触发时机

- 应用启动/回到前台；
- 手动点击同步；
- 网络恢复；
- 本地写入后防抖 5–10 分钟（可选）；
- 不做后台常驻轮询；GitHub 不是实时通道。

---

## 4. GitHub 适配器

### 4.1 认证与权限

- Fine-grained PAT，只选目标私有仓库；
- `Contents: Read and write`；
- 不需要 `Administration`（不自动建仓）；
- Token 存系统钥匙串；浏览器 Demo 仅 sessionStorage；
- 仓库必须私有；公开仓库等于公开日程。

### 4.2 API 选择

| 场景 | API | 原因 |
|---|---|---|
| 单文件读写 | Contents API | 简单；`GET` 返回 base64 + sha；`PUT` 带 sha 做乐观锁 |
| 多文件/批量提交 | Git Data API | blob → tree → commit → ref；一次提交多个分片，减少请求 |
| 读取历史 | Commits API | 冲突恢复/审计 |

请求数估算：一次单文件同步 = 1 次 GET + 1 次 PUT（无变化时只有 GET）。每天几次同步完全在 5,000 次/小时内；不要为每个事件发一次请求。

### 4.3 错误语义

| 状态 | 含义 | UI 处理 |
|---|---|---|
| 401 | Token 失效 | 提示重新登录，不清本地 |
| 403 | 权限/限流 | 显示“稍后再试”，保留本地 |
| 404 | 文件/仓库不存在 | 首次同步则创建；否则提示检查仓库名 |
| 409/422 | SHA/内容冲突 | 自动重拉合并重试；仍失败则显示冲突说明 |
| 5xx | GitHub 故障 | 本地继续可用；稍后重试 |

### 4.4 端到端加密（可选，Beta）

如果启用：

```json
{
  "format": "lanshan-e2ee-v1",
  "kdf": "argon2id",
  "salt": "base64...",
  "nonce": "base64...",
  "ciphertext": "base64..."
}
```

- 口令派生 32 字节密钥；Argon2id 参数随文件保存，便于升级。
- XChaCha20-Poly1305 加密整个 JSON；GitHub 只看到密文。
- 配对：桌面显示二维码（仓库 + 加密盐 + 一次性密钥），手机扫描；不要通过聊天传口令。
- 忘记口令 = 数据不可恢复；UI 必须二次确认。
- DarkCube 的 Base64url 编码不是加密，不能把“仓库里看不到明文”当成安全承诺。

---

## 5. 本地存储

| 平台 | 存储 | 说明 |
|---|---|---|
| Web/PWA | IndexedDB（Dexie） | Demo 用 localStorage；生产迁移 |
| Windows/macOS | SQLite | Tauri SQL 插件；通知/托盘/启动时可读 |
| Android/iOS | SQLite | Capacitor SQLite / 原生 Room；小组件/闹钟 Worker 可读 |
| 密钥 | 系统钥匙串/Keystore | 不进 SQLite 明文 |
| 图片 | 本地文件/缓存 | 默认不进同步仓库；原图可删除，只留来源片段 |

**为什么原生端用 SQLite**：桌面小组件、Android AlarmManager/Worker、iOS WidgetKit 都需要在 WebView 不运行时读取数据。IndexedDB 只属于 WebView，原生侧访问麻烦。用 SQLite 作为主存储，WebView 通过桥接查询；PWA 继续用 IndexedDB，保持接口一致。

仓储接口：

```ts
interface EventRepository {
  list(): Promise<ScheduleEvent[]>
  get(id: string): Promise<ScheduleEvent | undefined>
  upsert(event: ScheduleEvent): Promise<void>
  softDelete(id: string, at: string): Promise<void>
}
```

---

## 6. 导入/导出与互操作

- 导出：`schedule.json`，完整字段，含墓碑？导出给用户时默认过滤墓碑；给同步/备份时保留墓碑。UI 提供两种导出：`导出日程` / `导出完整备份`。
- 导入：按 `id` 合并；没有 `id` 的文件生成新 id；无效字段丢弃并提示。
- ICS：v1.1 提供单向导出（`VEVENT`/`VTIMEZONE`），不把 ICS 作为主存储；双向同步需要处理 UID、SEQUENCE、RECURRENCE-ID，复杂度高。
- CSV：可选，仅用于迁移/查看，不作为规范。

---

## 7. 校验与迁移

- 运行时用 Zod 校验；JSON Schema 用于文档、CI 和第三方工具。
- 读取时：
  - `schemaVersion` 缺失：按 1.0 尝试，补默认值；
  - 主版本不同：拒绝写入，提示升级；
  - 未知字段：保留在 `_unknown` 或直接丢弃（需在迁移说明中明确）。
- 每次写入前校验：`start`/`end` 可解析、`category` 白名单、`confidence` 0–1、`rev` 正整数。
- CI：对 `schema/schedule.schema.json` 跑样例校验；对 TS 类型和 Schema 做一致性检查（后续可用 `json-schema-to-typescript`）。

---

## 8. 隐私边界

- `source.excerpt` 可能包含敏感原文；同步和导出时提示用户。
- 原图不默认上传仓库；如果用户选择保存，放在本地私有目录，并在设置里可清理。
- 遥测默认关闭；如果开启，只上报匿名性能/错误，不上报标题、地点、原文。
- GitHub 仍能看到仓库存在、提交时间、文件大小；E2EE 只能隐藏内容，不能隐藏元数据。

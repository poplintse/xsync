# xsync 书签同步应用设计

更新时间：2026-06-01

## 1. 目标

设计一个自托管 Chrome 书签同步系统：

- 客户端采用 Chrome 扩展 + 极小原生托盘 App，支持 macOS 和 Windows。
- Chrome 扩展可浏览本机 Chrome 书签树，选择需要同步的目录。
- 支持三种手动同步模式：
  - 合并：本地和服务器两侧变更合并。
  - 本地覆盖服务器：以本地选中目录为准更新服务器。
  - 服务器覆盖本地：以服务器侧内容为准更新本地选中目录。
- 扩展配置页底部提供“立即同步”按钮，按当前配置触发同步。
- 服务端部署在 `xunit.cc` 的 Docker 内。
- 服务端 Web 管理入口纳入 xsso 统一管理。
- 扩展和托盘 App 的 API 访问都必须绑定 xsso 用户授权，不能只靠裸 token。

## 2. 明确假设

1. 当前 `/Users/iclawtse/workspace/projects/xsync` 是空目录，因此这是新应用设计，不是修改已有 xsync 代码。
2. xsso 当前推荐 `ticket_callback` 模式：业务系统实现 `/sso/callback`，用一次性 ticket 到 `/xsso/tickets/verify` 换取用户映射结果，然后创建自己的 session。
3. 目标浏览器先只支持 Chrome/Chromium 系。Edge/Brave/Vivaldi 可以后续复用同一书签文件结构。
4. “原生 mac 端和 windows 端应用”调整为极小系统托盘/菜单栏 App：它不承载主要配置 UI，只负责系统入口、登录授权、状态提示、钥匙串和打开扩展页面。
5. Chrome 书签读写以 Chrome 扩展为主，因为扩展可以使用官方 `chrome.bookmarks` API，避免直接修改 `Bookmarks` JSON 文件带来的缓存覆盖风险。

## 3. GitHub 参考

### Floccus

仓库：https://github.com/floccusaddon/floccus

可参考点：

- 支持多个同步 profile。
- 支持选择本地浏览器书签目录。
- 支持单向/双向同步策略。
- 支持 Nextcloud、WebDAV、Git、Linkwarden 等自托管后端。

不直接采用的原因：

- 它主要是浏览器扩展，不是独立 macOS/Windows 桌面客户端。
- 后端是通用存储服务，不是和 xsso 深度绑定的业务系统。

### xBrowserSync

仓库：

- https://github.com/xbrowsersync/app
- https://github.com/xbrowsersync/api

可参考点：

- 有独立 API 服务端。
- 强调隐私和客户端加密。
- 保留浏览器书签层级。

不直接采用的原因：

- 仍以浏览器扩展/移动端为主。
- 现有认证模型与 xsso 的用户、应用、映射体系不一致。

### Linkwarden / Shiori

仓库：

- https://github.com/linkwarden/linkwarden
- https://github.com/go-shiori/shiori

可参考点：

- Docker 自托管成熟。
- 提供 Web 管理、导入导出、API、归档等能力。

不直接采用的原因：

- 它们更像“书签管理/收藏夹系统”，不是同步 Chrome 原生书签目录。
- 文件夹与浏览器原生书签的冲突合并不是核心能力。

## 4. 推荐总体架构

```text
Chrome Extension
  - 配置 UI
  - 浏览 Chrome 书签树
  - 选择同步目录和同步方式
  - 使用 chrome.bookmarks API 读写书签
  - 点击“立即同步”
        |
        | Native Messaging，本机轻量能力
        v
macOS Menu Bar / Windows Tray App
  - 显示登录和同步状态
  - 打开扩展配置页和 xsync Web 管理页
  - 系统钥匙串保存设备令牌
  - 注册自定义 URL scheme / Native Messaging host
        |
        | HTTPS API
        v
xsync 服务端 Docker
  - Web 管理界面：/xsync/
  - API：/xsync/api/
  - xsso ticket_callback 登录
  - 设备授权、书签快照、变更记录、审计日志
        |
        | 服务端校验 ticket
        v
xsso
```

### 为什么扩展优先

- Chrome 书签的官方读写入口就是 `chrome.bookmarks` API。
- 扩展可以直接展示并修改 Chrome 当前 profile 的书签树。
- 不需要处理 Chrome 运行时缓存、文件锁和 JSON 文件被覆盖的问题。
- macOS 和 Windows 共用同一套扩展 UI 与同步逻辑。

### 为什么仍保留极小原生托盘 App

- 提供 macOS 菜单栏 / Windows 托盘入口，满足“桌面端应用”的存在感。
- 负责更适合本机应用的能力：系统钥匙串、开机启动、状态通知、自定义 URL scheme。
- 作为 Chrome Native Messaging host，让扩展可以安全读取/写入本机设备授权状态。
- 后续如果需要后台定时同步、系统通知或多浏览器支持，可以在托盘 App 上平滑扩展。

托盘 App 不做完整书签配置 UI，避免把客户端做重。完整桌面 UI 可作为后续可选增强，不进入第一版。

## 5. 客户端设计

### Chrome 扩展配置页

上半部分：配置区

- 服务器地址：默认 `https://xunit.cc/xsync`
- 登录状态：显示当前 xsso 用户和设备名。
- 本地书签树浏览器：
  - 展示书签栏、其他书签、移动设备书签等根节点。
  - 支持展开目录。
  - 只能选择目录，不能选择单个 URL。
- 远端目录：
  - 默认与本地目录同名。
  - 可选择已有远端集合，或创建新集合。
- 同步方式：
  - 合并。
  - 本地覆盖服务器。
  - 服务器覆盖本地。
- 冲突处理：
  - 第一版固定为“保留两份，冲突项自动重命名”。
  - 后续增加冲突预览和手动选择。

下半部分：执行区

- “立即同步”主按钮。
- 最近同步状态：成功/失败、同步时间、变更数量。
- “预览变更”按钮：同步前展示新增、删除、移动、改名。
- “打开 Web 管理页”按钮。

### 托盘 App

托盘菜单只保留必要功能：

- 同步状态：未登录 / 已连接 / 同步中 / 最近失败。
- 打开扩展配置页。
- 打开 xsync Web 管理页。
- 重新授权设备。
- 退出。

托盘 App 不直接浏览或编辑书签，避免重复实现扩展已经能可靠完成的能力。

### 客户端技术栈

Chrome 扩展：

- Manifest V3。
- TypeScript。
- React 或轻量原生 Web Components。
- `chrome.bookmarks` 读写书签。
- `chrome.storage.local` 保存非敏感配置。
- `chrome.runtime.connectNative` 连接托盘 App。

极小托盘 App：

- Rust 单代码库。
- macOS 打包为 `.app` / `.dmg`，Windows 打包为 `.msi` / `.exe`。
- 使用 `tray-icon` 或同类轻量库实现菜单栏/托盘。
- 使用 `keyring` crate 访问 macOS Keychain 和 Windows Credential Manager。
- 安装时写入 Chrome Native Messaging host manifest。

不建议第一版使用 Electron 或完整 Tauri UI，因为主要界面已经在扩展配置页里，托盘 App 只需要本机能力和系统入口。

### 配置保存策略

选择配置后自动保存草稿，但同步前必须点“立即同步”。

理由：

- 用户选择目录和模式后，下次打开应保留配置。
- 自动保存配置不会修改书签，风险低。
- 修改书签必须由明确的同步按钮触发。

本地配置保存：

- 非敏感配置：扩展 `chrome.storage.local`。
- access token / refresh token / device secret：优先保存在 macOS Keychain、Windows Credential Manager，由托盘 App 通过 Native Messaging 提供给扩展；如果托盘 App 未安装，则退化为扩展本地加密存储。
- 每次写本地书签前，由扩展向服务端保存远端 revision，并在本地记录同步前快照。

### 可靠读写 Chrome 书签

推荐方案：Chrome 扩展直接负责书签读写。

- 扩展使用 `chrome.bookmarks` API 读取和写入书签。
- Chrome 打开时也能可靠同步。
- 不需要直接改 Chrome 的 `Bookmarks` 文件。

托盘 App 不写 `Bookmarks` 文件，只通过 Native Messaging 给扩展提供本机辅助能力。

如果后续支持 Edge/Brave/Vivaldi，优先为每个浏览器提供扩展版本，而不是直接改浏览器数据文件。

## 6. 服务端设计

### 技术栈

推荐第一版：

- Node.js 20+
- Fastify 或 Hono
- SQLite
- Docker 单容器
- 数据目录挂载到 `/app/.data`

理由：

- 和现有 xsso 轻量单体风格一致。
- SQLite 足够支撑个人/小团队书签同步。
- 后续可以迁移 PostgreSQL，但第一版不引入。

### 核心数据表

```text
users
  id
  xsso_user_id
  username
  display_name
  created_at

devices
  id
  user_id
  name
  platform
  device_secret_hash
  last_seen_at
  revoked_at

collections
  id
  user_id
  name
  root_key
  created_at
  updated_at

bookmarks
  id
  collection_id
  stable_id
  parent_stable_id
  type              -- folder/bookmark/separator
  title
  url
  position
  content_hash
  deleted_at
  updated_at

sync_snapshots
  id
  collection_id
  device_id
  base_revision
  new_revision
  mode
  summary_json
  created_at

audit_logs
  id
  user_id
  device_id
  action
  ip
  user_agent
  detail_json
  created_at
```

### API 草案

Web 页面走 xsso session，客户端 API 走设备令牌。

```http
GET /xsync/
GET /xsync/sso/callback

POST /xsync/api/device/authorize/start
POST /xsync/api/device/authorize/finish
POST /xsync/api/device/token/refresh
POST /xsync/api/sync/preview
POST /xsync/api/sync/apply
GET /xsync/api/collections
GET /xsync/api/collections/:id/tree
GET /xsync/api/audit
POST /xsync/api/devices/:id/revoke
```

客户端认证建议：

1. 扩展或托盘 App 打开浏览器访问 `/xsync/device`。
2. 用户通过 xsso 登录 Web 管理端。
3. Web 端显示一次性授权码，或通过自定义 URL scheme 回跳托盘 App。
4. 托盘 App 用一次性授权码换取设备令牌，保存到系统钥匙串。
5. 之后 API 请求使用短期 access token + 长期 refresh token，服务端绑定 device。
6. 扩展通过 Native Messaging 向托盘 App 获取短期 access token。

这样做的原因是：客户端不应该保存 `XSSO_APP_SECRET`，也不应该模拟 xsso 的服务端 callback。扩展也不适合长期保存高权限 refresh token，因此交给托盘 App 和系统钥匙串。

## 7. 同步模型

### 书签节点规范化

每个节点转成统一结构：

```json
{
  "stableId": "hash(parentPath + title + url/type)",
  "type": "folder",
  "title": "Dev",
  "url": null,
  "children": []
}
```

注意：

- Chrome 自带 id 在不同设备上不稳定，不能作为跨设备主键。
- 第一版用路径 + 类型 + URL 生成 stable key。
- 移动目录会被识别为删除 + 新增；第二版再引入更强的相似度匹配。

### 三种同步方式

#### 本地覆盖服务器

流程：

1. 扩展读取选中本地目录。
2. 生成规范化树和 revision。
3. 上传到服务端，替换对应 collection。
4. 服务端保留旧 revision，可回滚。

适用：

- 第一次初始化服务器。
- 本地确认是正确版本。

#### 服务器覆盖本地

流程：

1. 扩展拉取服务器 collection。
2. 扩展记录当前选中目录的本地快照。
3. 通过 Chrome 扩展写入选中的本地目录。
4. 记录本地写入结果和新 revision。

适用：

- 新电脑初始化。
- 本地书签混乱，需要恢复。

#### 合并

第一版采用三路合并：

```text
base: 上次同步成功时的共同快照
local: 当前本地目录
remote: 当前服务器目录
```

规则：

- base 没有、local 有、remote 没有：新增到 remote。
- base 没有、local 没有、remote 有：新增到 local。
- base 有、local 删除、remote 未改：删除 remote。
- base 有、remote 删除、local 未改：删除 local。
- local 和 remote 同时改同一节点标题/URL：保留两份，冲突项追加 ` (local)` / ` (server)`。
- 文件夹排序冲突：以本地排序为主，远端新增项追加到同级末尾。

这个规则保守，优先避免数据丢失。

## 8. xsso 集成

### Web 管理端

在 xsso 注册应用：

```text
code: xsync
name: xsync
basePath: /xsync/
callbackPath: /xsync/sso/callback
integrationMode: ticket_callback
requiredRoles: admin,user
```

xsync 服务端实现：

- 未登录访问 `/xsync/` 跳转 `/xsso/launch?app=xsync&redirect=/xsync/`。
- `/xsync/sso/callback` 服务端调用 `/xsso/tickets/verify`。
- 校验成功后创建 xsync 自己的 session。
- `/xsync/api/*` 不返回 302 登录页；API 认证失败返回 401/403。

### 客户端授权

扩展和托盘 App 不直接接入 xsso ticket callback，而是接入 xsync 的设备授权：

```text
扩展/托盘 App -> 打开浏览器 /xsync/device/authorize
用户 -> xsso 登录
xsync Web -> 确认授权当前设备
托盘 App -> 获得 device token 并保存到系统钥匙串
扩展 -> 通过 Native Messaging 获取 access token
扩展 -> 调用 /xsync/api/sync/*
```

这样 xsso 仍然是统一身份源，xsync 负责设备生命周期和 API 权限。

## 9. Docker 部署

`docker-compose.yml` 形态：

```yaml
services:
  xsync:
    build:
      context: .
    image: xsync:latest
    container_name: xsync
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      AUTH_MODE: ${AUTH_MODE:-sso_ticket}
      XSYNC_HOST: 0.0.0.0
      XSYNC_PORT: ${XSYNC_PORT:-8791}
      XSYNC_BASE_PATH: ${XSYNC_BASE_PATH:-/xsync}
      XSYNC_DATA_DIR: /app/.data
      XSYNC_COOKIE_SECURE: ${XSYNC_COOKIE_SECURE:-true}
      XSSO_BASE_URL: ${XSSO_BASE_URL:-http://host.docker.internal:7000/xsso}
      XSSO_APP_CODE: ${XSSO_APP_CODE:-xsync}
      XSSO_APP_SECRET: ${XSSO_APP_SECRET:?XSSO_APP_SECRET must be set}
      XSSO_CALLBACK_PATH: ${XSSO_CALLBACK_PATH:-/xsync/sso/callback}
    ports:
      - "${XSYNC_BIND:-127.0.0.1}:${XSYNC_PORT:-8791}:${XSYNC_PORT:-8791}"
    volumes:
      - ../data/xsync:/app/.data
```

反向代理：

```text
https://xunit.cc/xsync/ -> http://127.0.0.1:8791/xsync/
```

## 10. 安全设计

- 所有客户端 API 必须 HTTPS。
- 设备令牌只保存 hash；托盘 App 保存原始 token 到系统钥匙串。
- 每台设备可在 Web 管理端撤销。
- 同步写入本地前强制生成备份。
- 服务端每次覆盖保留 revision，可回滚。
- API 认证失败只返回 401/403，不跳转 xsso。
- 服务端限制单次同步大小、节点数量和请求频率。
- 可选增强：客户端侧端到端加密。第一版不建议默认启用，否则 Web 管理端无法展示书签内容，也会增加恢复复杂度。

## 11. 第一版里程碑

### M1：服务端基础

- Docker 单容器。
- xsso ticket callback 登录。
- collection CRUD。
- 设备授权。
- revision 和备份。

验收：

- `/xsync/` 能通过 xsso 登录。
- 未授权 API 返回 401。
- 授权设备可创建 collection 和上传书签树。

### M2：Chrome 扩展配置与上传

- Chrome 扩展基础配置页。
- 浏览本地书签树。
- 选择目录并本地覆盖服务器。
- 使用扩展本地存储临时保存非敏感配置。

验收：

- 能把本地指定目录同步到服务端。
- Web 管理端能查看同步结果。

### M3：极小原生托盘 App

- macOS 菜单栏 App。
- Windows 托盘 App。
- Native Messaging host。
- 系统钥匙串保存设备 token。
- 自定义 URL scheme 接收授权回跳。
- 菜单项打开扩展配置页和 xsync Web 管理页。

验收：

- 扩展可以通过 Native Messaging 获取短期 access token。
- Web 端撤销设备后，扩展同步请求失败并提示重新授权。

### M4：服务器覆盖本地

- 支持预览服务器覆盖本地的变更。
- 通过 `chrome.bookmarks` API 写入选中目录。
- 写入前记录本地快照和服务端 revision。

验收：

- Chrome 运行中也能安全更新选中目录。
- 写入失败时不破坏原目录结构。

### M5：三路合并

- 保存 base snapshot。
- 支持 preview。
- 支持合并模式。

验收：

- 双端新增能合并。
- 单端删除能传播。
- 同一节点冲突不会丢数据。

## 12. 建议暂不做

- 自动后台同步：第一版只做手动立即同步，降低误删风险。
- 多浏览器全覆盖：先 Chrome，后续再支持 Edge/Brave。
- 复杂冲突 UI：第一版以不丢数据为目标。
- 完整 Tauri / SwiftUI / WinUI 桌面 UI：当前方案用扩展配置页 + 托盘入口替代。
- PostgreSQL / Redis / 队列：个人服务不需要先引入。

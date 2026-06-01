# xsync 服务端部署准备

## 是否需要 .env

需要。真实 `.env` 只放服务器，不提交到仓库。

推荐服务器路径：

```text
/opt/apps/xsync/.env
```

本仓库只保留：

- `.env.example`：通用本地/开发示例。
- `.env.production.example`：生产部署变量清单，无真实密钥。

## 生产 .env 变量

```env
AUTH_MODE=sso_ticket
XSYNC_PORT=8791
XSYNC_BASE_PATH=/xsync
XSYNC_BIND=127.0.0.1
XSYNC_COOKIE_SECURE=true
XSSO_BASE_URL=http://host.docker.internal:7000/xsso
XSSO_APP_CODE=xsync
XSSO_APP_SECRET=<从 xsso 应用配置中生成>
XSSO_LOGIN_URL=/xsso/launch
```

## xsso 侧需要注册应用

```text
code: xsync
name: xsync
basePath: /xsync/
callbackPath: /xsync/sso/callback
integrationMode: ticket_callback
requiredRoles: admin,user
```

`XSSO_APP_SECRET` 必须和 xsso 中 `xsync` 应用的 secret 一致。

## Docker Compose 部署形态

服务监听容器内 `8791`，宿主机默认只绑定 `127.0.0.1:8791`。

反向代理：

```text
https://xunit.cc/xsync/ -> http://127.0.0.1:8791/xsync/
```

Nginx 示例：

```nginx
location /xsync/ {
  proxy_pass http://127.0.0.1:8791/xsync/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

如果 xunit.cc 使用统一反向代理容器，保持目标仍是：

```text
http://host.docker.internal:8791/xsync/
```

或代理宿主机端口：

```text
http://127.0.0.1:8791/xsync/
```

健康检查：

```text
https://xunit.cc/xsync/health
```

本机端口检查：

```sh
curl -i http://127.0.0.1:8791/xsync/health
```

## 服务器目录建议

```text
/opt/apps/xsync/
├── repo/
├── .env
└── backups/
```

如果用当前 `docker-compose.yml`，在 `repo/` 内执行：

```sh
docker compose --env-file ../.env up -d --build
```

数据会挂载到：

```text
/opt/apps/xsync/data/xsync
```

如果不想用相对路径，可以在服务器上加 `docker-compose.override.yml`：

```yaml
services:
  xsync:
    volumes:
      - /opt/apps/xsync/data:/app/.data
```

## 部署前检查

- `XSSO_APP_SECRET` 已生成并只保存在服务器 `.env`。
- xsso 可从容器内通过 `XSSO_BASE_URL` 访问。
- 反向代理已配置 `/xsync/` 到 `127.0.0.1:8791`。
- HTTPS 已开启，否则 Chrome 扩展生产环境调用会受限。
- `/xsync/api/*` 失败时返回 `401/403`，不能跳转登录页。

## 当前本地预检状态

- `Dockerfile` 已存在。
- `docker-compose.yml` 已存在。
- `.env.example` 已存在。
- `.env.production.example` 已存在。
- `.gitignore` 已排除 `.env`、`.env.local`、`*.pem`、`*.key`。
- `.dockerignore` 已排除客户端、native、测试、文档和构建产物，服务端镜像只打包 Node 服务端需要的文件。
- 当前目录还不是 git 仓库，没有 `origin`。如果使用服务器 git 拉取部署，需要先初始化仓库并设置 SSH origin；如果使用 `rsync` 上传部署，则不需要 origin。

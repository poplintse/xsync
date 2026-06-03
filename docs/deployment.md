# xsync lite 服务端部署准备

## 是否需要 .env

需要。真实 `.env` 只放服务器，不提交到仓库。

推荐服务器路径：

```text
/opt/apps/xsync-lite/.env
```

本仓库只保留：

- `.env.example`：通用本地/开发示例。
- `.env.production.example`：生产部署变量清单，无真实密钥。

## 生产 .env 变量

```env
AUTH_MODE=api_token
XSYNC_PORT=8792
XSYNC_BASE_PATH=/xsync-lite
XSYNC_BIND=127.0.0.1
XSYNC_COOKIE_SECURE=true
```

## Docker Compose 部署形态

服务监听容器内 `8792`，宿主机默认只绑定 `127.0.0.1:8792`。

反向代理：

```text
https://xunit.cc/xsync-lite/ -> http://127.0.0.1:8792/xsync-lite/
```

Nginx 示例：

```nginx
location /xsync-lite/ {
  proxy_pass http://127.0.0.1:8792/xsync-lite/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

健康检查：

```text
https://xunit.cc/xsync-lite/health
```

本机端口检查：

```sh
curl -i http://127.0.0.1:8792/xsync-lite/health
```

## 服务器目录建议

```text
/opt/apps/xsync-lite/
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
/opt/apps/xsync-lite/data/xsync-lite
```

如果不想用相对路径，可以在服务器上加 `docker-compose.override.yml`：

```yaml
services:
  xsync:
    volumes:
      - /opt/apps/xsync-lite/data/xsync-lite:/app/.data
```

## 部署前检查

- 反向代理已配置 `/xsync-lite/` 到 `127.0.0.1:8792`。
- HTTPS 已开启，否则 Chrome 扩展生产环境调用会受限。
- `/xsync-lite/api/*` 使用 Bearer API token。

## 当前本地预检状态

- `Dockerfile` 已存在。
- `docker-compose.yml` 已存在。
- `.env.example` 已存在。
- `.env.production.example` 已存在。
- `.gitignore` 已排除 `.env`、`.env.local`、`*.pem`、`*.key`。
- `.dockerignore` 已排除客户端、native、测试、文档和构建产物，服务端镜像只打包 Node 服务端需要的文件。
- 当前目录还不是 git 仓库，没有 `origin`。如果使用服务器 git 拉取部署，需要先初始化仓库并设置 SSH origin；如果使用 `rsync` 上传部署，则不需要 origin。

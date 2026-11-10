# staging-only 构建变体（E2.1）

本目录的 `Dockerfile.staging` 是 **仅用于 Sprint E2 staging** 的构建变体，不是生产 Dockerfile。生产构建仍使用仓库根 [Dockerfile](../../../Dockerfile)。

## 为什么需要变体（证据）

E2.1 要求从当前提交构建真实镜像。直接使用仓库根 Dockerfile 的两次构建均在 deps 阶段失败：

| 尝试 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 1 | `docker build --progress=plain --platform linux/amd64 -t flower-e2-staging:9112ed3bfa46 .` | deps 阶段 `npm ci` 长时间无输出（约 20 分钟）后人工取消 | `docs/evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-173320.log` |
| 2 | 同上（重试） | `npm ci` 在 12 分钟后报 `ECONNRESET` / `network aborted`，退出码 1 | `docs/evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-183511-attempt2.log` |
| 3 | 使用 `Dockerfile.staging`（官方 registry 重写 + 重试/超时放宽） | `npm ci` 在 3 小时 22 分钟后仍以网络错误退出（exit 1） | `docs/evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-185537-attempt3-variant.log` |
| 4 | 使用 `Dockerfile.staging-offline`（复用本地 `flower-e2-deps:linux`，其依赖由 `npm ci` 按锁文件安装，含 linux 原生包） | **成功**：image `flower-e2-staging:9112ed3bfa46`，`sha256:ce51b564…`，linux/amd64，1.8 GB | `docs/evidence/sprint-e2/logs/e21-build-9112ed3bfa46-20261110-222030-attempt4-offline.log` |

补充诊断：容器内单次下载 tarball 正常（2–5 秒），但 `package-lock.json` 中 627 条 `resolved` 指向 `registry.npmmirror.com` / `cdn.npmmirror.com`；在容器内执行完整 `npm ci` 时大量请求出现 80–130 秒级等待并最终 `ECONNRESET`。这与 E1 记录的 npmmirror 故障一致。

## 尝试 4（成功）的依赖来源

- 本机先用容器按 package-lock.json 执行 
pm ci（带宿主 npm 缓存 + 少量网络补齐 linux 原生包），提交为本地镜像 lower-e2-deps:linux（node:22-alpine + linux 依赖，含 @next/swc-linux-x64-gnu/musl、schema-engine-linux-musl）。
- Dockerfile.staging-offline 的 builder/runner 阶段复用该 deps 层；与生产 Dockerfile 的差异是 deps 来源和跳过 
pm prune --omit=dev（runner 含 devDependencies，镜像更大）。
- 这不是生产构建等价物；E2 简报将其列为需要维护者/CI 复跑的偏差，生产镜像构建仍以 master workflow 为准。

## 变体差异

与仓库根 Dockerfile 的差异 **仅限 deps 阶段**：

```dockerfile
ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REPLACE_REGISTRY_HOST=always
ENV NPM_CONFIG_FETCH_RETRIES=5
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000
ENV NPM_CONFIG_FETCH_TIMEOUT=600000
```

其余阶段（base/builder/runner）、构建参数、入口与运行镜像内容保持不变；源码仍为当前提交。该变体只把依赖下载源从 npmmirror 重写到官方 registry 并放宽重试/超时，不改变依赖版本（`package-lock.json` 未修改）。

## 范围与提案

- 本变体在 `deploy/staging/` 范围内，未修改生产 Dockerfile、生产 compose 或 workflow。
- 若该变体构建成功，E2 简报将把“上游修复”作为提案提交：在仓库根 Dockerfile 或 CI 构建步骤中固定 npm registry 重写策略（与 E1.6 PR workflow 的官方 registry 处理一致），由用户/维护者批准后实施。
- 证据记录：`images.json` 中 `dockerfile` 字段与构建日志；简报注明“本机镜像使用 staging 变体构建”的偏差，远程 staging 复跑时需确认是否采用同样策略或由维护者在 CI 构建。


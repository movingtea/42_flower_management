# staging 部署 workflow 提案（E2.2，未落地）

本文件只是提案。按 Sprint E2 交接要求，`deploy/staging/` 本地验证通过后才可以提议新增独立 staging workflow；**本 Sprint 不修改 `.github/workflows/`**，需用户批准触发条件、镜像库、目标主机与最小权限后另立工作包。

## 现状与动机

- 现有 [deploy.yml](../../../.github/workflows/deploy.yml) 仅在 `push master` 时构建、推送 ACR 并 SSH 远程部署生产；没有 staging 触发入口。
- E2.2 已在本机验证：显式目标镜像、预检、迁移前备份、web 先迁移/健康、cron 后启动、迁移后核对、失败停止与同版本重试安全。
- 需要把同一流程接到远程 staging，但仍不获得生产发布权限。

## 提案要点

| 项 | 建议 |
|---|---|
| 触发 | `workflow_dispatch` 手动触发，输入 `target_sha`（必填）与可选 `previous_image`；不允许 push 自动部署 |
| 镜像 | 复用 ACR 仓库 `flower-platform-app:<sha>`；staging 使用 immutable digest，workflow 内记录 digest 与源码 SHA 对照 |
| 目标 | 独立 staging 主机/目录（如 `/root/flower-staging/`），与生产 `/root/flower-platform/` 物理或账号隔离 |
| 权限 | `permissions: contents: read`；secrets 通过 GitHub Environment（如 `staging`）注入；不使用生产 secrets |
| 步骤 | 构建/拉取 SHA 镜像 → `--connect` 目标预检 → staging 迁移前备份 → 停 web/cron → 起 web（entrypoint 迁移）→ 健康 → 迁移后核对 → 起 cron → 冒烟 → 发布记录 artifact |
| 失败 | 任一步失败即停止并保留日志；不自动回滚数据库；镜像回滚需兼容性证据（E2.5） |
| 并发 | 同一 staging 目标串行（concurrency group），禁止并行发布 |
| 记录 | 上传脱敏发布记录（目标、SHA、digest、上一版、迁移/备份标识、健康/冒烟、清理结果） |
| 审批 | 是否要求 Environment protection（人工审批）由维护者决定；生产 workflow 保持现状 |

## 前置条件（维护者）

- 远程 staging 主机、SSH 凭据、ACR 登录与最小权限账号；
- staging 域名/TLS、外部服务测试配置、备份目标；
- 明确 staging secrets 的注入方式与轮换策略；
- 确认 workflow 使用的基础镜像/构建环境（本机镜像构建曾因容器网络 npm ci 失败，CI 需固定 registry 重写策略，见 `deploy/staging/images/README.md`）。

## 不做的事

- 不修改 `deploy.yml` 的 `push master` 生产触发；
- 不把 staging workflow 设为生产部署的必经步骤；
- 不在 workflow 中执行数据库回滚或 `migrate reset`。

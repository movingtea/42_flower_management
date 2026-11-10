# Sprint E3.7 · 依赖、密钥与镜像安全门禁

2026-11-11。本文件是 E3.7 的实现与运维说明。任务 ID `e37-security-gates`，基线 `dev` 上的 `65326e5`。本轮只新增安全门禁文件与离线校验脚本，**不修改**生产 `Dockerfile`、`deploy.yml`、`pr.yml`、应用依赖、锁文件或业务源码，也不提交、不推送 Git。

## 1. 结论口径

| 层级 | 结论 | 依据 |
|---|---|---|
| 结构与脚本 | **本机通过** | 三个离线门禁脚本的默认检查、`--self-test`、`--fixtures` 全部退出码 0；受控失败样本逐一失败；YAML/TOML 独立语法校验通过 |
| 真实扫描 | **未执行** | 未安装 gitleaks/trivy/syft，未执行真实 secret/镜像扫描；真实 GitHub Actions 首跑由维护者补证 |
| 外部配置 | **待维护者** | 分支保护、Code Scanning、ACR 只读拉取账号、Dependency graph、组织级 `GITLEAKS_LICENSE`、网络白名单 |

按 Sprint E3 验收口径，以上不得合并表述为“真实扫描通过”。本包可交付的是：门禁结构、政策与例外语义、离线可复现的失败证据，以及真实首跑所需的维护者清单。

## 2. 交付文件

| 类型 | 路径 | 说明 |
|---|---|---|
| Workflow | [security.yml](../.github/workflows/security.yml) | 独立安全门禁：`pull_request`（同仓）+ `workflow_dispatch` |
| 政策 | [policy.yml](../.github/security/policy.yml) | 运行时/开发依赖、严重度、可利用性、修复可用性、例外契约 |
| Secret 配置 | [gitleaks.toml](../.github/security/gitleaks.toml) | 保留默认规则；仅为已知占位值位置添加带理由的 allowlist |
| 镜像忽略 | [trivy-ignore.yaml](../.github/security/trivy-ignore.yaml) | 无活动忽略；每条忽略必须由 policy 例外背书且带到期日 |
| 依赖更新 | [dependabot.yml](../.github/dependabot.yml) | npm + github-actions + docker 周更分组，目标分支 `dev`，禁止自动 major 升级 |
| 离线脚本 | [check-workflow-pins.mjs](../scripts/security/check-workflow-pins.mjs) | 固定 SHA、最小权限、触发范围、镜像扫描守卫、policy 一致性 |
| 离线脚本 | [check-exceptions.mjs](../scripts/security/check-exceptions.mjs) | policy 结构、例外必填字段与过期、trivy ignore 关联、gitleaks allowlist 结构 |
| 离线脚本 | [check-lockfile.mjs](../scripts/security/check-lockfile.mjs) | 锁文件 resolved host / SRI integrity 离线检查，只报告不修改 |
| 受控样本 | [fixtures](../scripts/security/fixtures) | workflow/policy/lockfile/secret 四类受控样本 |
| 本文件 | `docs/sprint-e3-security-gates.md` | 门禁分层、失败政策、例外流程、artifact、本地验证与维护者待办 |
| 追加说明 | [workflow-proposal.md](../deploy/staging/workflow-proposal.md) | 仅追加 staging 与安全门禁对接段，未改既有内容 |

## 3. 门禁分层

| 层 | 触发 | 执行内容 | 权限 | 失败即阻断 |
|---|---|---|---|---|
| PR 依赖审查 | 同仓 `pull_request` | `actions/dependency-review-action` 固定 SHA；`fail-on-severity: high`、`fail-on-scopes: runtime`；开发依赖只报告 | `contents: read`、`pull-requests: read` | 是 |
| PR secret 扫描 | `pull_request` + `workflow_dispatch` | `gitleaks/gitleaks-action` 固定 SHA + gitleaks 8.30.1 + `gitleaks.toml` | `contents: read` | 是 |
| PR SBOM | `pull_request` + `workflow_dispatch` | `anchore/sbom-action` 固定 SHA；对源码树生成 SPDX 与 CycloneDX JSON | `contents: read` | 是 |
| 离线供应链 | `pull_request` + `workflow_dispatch` | 运行三个 `scripts/security/*.mjs` 与受控样本自检 | `contents: read` | 是 |
| 生产镜像扫描 | 仅 `workflow_dispatch`（兼容未来 `push master`） | 从 ACR 拉取 `:<sha>` 生产镜像、记录 digest、trivy 固定 SHA 扫描 HIGH/CRITICAL 并归档 SARIF/JSON | `contents: read`、`security-events: write` | 是（SARIF 上传在 Code Scanning 启用前为 best-effort） |

- 不使用 `pull_request_target`；PR 任务不读取 ACR 凭据，也不在 PR 中构建生产镜像。
- PR 门禁只对同仓 PR 运行依赖审查；fork PR 的 dependency-review 明确未覆盖，列入 §9 残留风险，而不是伪报为通过。
- `security-events: write` 仅出现在 `image-scan` job；其他 job 不授予写权限。
- 每个 `uses:` 固定 40 位 commit SHA 并带 `# vX.Y.Z` 注释；`check-workflow-pins.mjs` 在离线门禁中强制该格式。

## 4. 固定版本与 SHA 复核

复核方法：GitHub 公开 API `GET /repos/<repo>/git/ref/tags/<tag>`（annotated tag 再取 `/git/tags/<sha>`）；当 API 配额受限时用公开只读 `git ls-remote <repo>.git refs/tags/<tag> "refs/tags/<tag>^{}"` 取得同一不可变 commit。复核时间 2026-11-11（UTC 2026-11-10T16:35Z），证据 [e37-action-sha-verification-20261110-163122.log](evidence/sprint-e3/logs/e37-action-sha-verification-20261110-163122.log)。

| Action | 版本 | 固定 commit | action runtime |
|---|---|---|---|
| `actions/checkout` | v5.1.0 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | node24 |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | node24 |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | node24 |
| `github/codeql-action/upload-sarif` | v4.39.3 | `33d7b85da1a04171e211befe2c739303b9a4c066` | node24 |
| `actions/dependency-review-action` | v5.0.0 | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` | node24 |
| `gitleaks/gitleaks-action` | v3.0.0 | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | node24 |
| `anchore/sbom-action` | v0.24.3 | `66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c` | node24 |
| `aquasecurity/trivy-action` | v0.36.0 | `ed142fd0673e97e23eac54620cfb913e5ce36c25` | composite（内部再固定 trivy 版本） |

所有 action 的 `runs.using` 均为 node24 或 composite，未使用 Node 20 运行时（GitHub 在 2026-09-16 移除 Node 20 runner）。特别注意：`github/codeql-action@v3` 当前已改为“stub，执行即退出 1”，因此 SARIF 上传固定到 v4.39.3；`actions/setup-node@v4`、`actions/upload-artifact@v4` 仍是 node20，本 workflow 不使用。复核证据包含 runtime 列，见 [e37-action-sha-verification-20261110-163122.log](evidence/sprint-e3/logs/e37-action-sha-verification-20261110-163122.log)。

维护规则：升级时先查 API 复核 tag→commit，替换 SHA 与注释版本，再运行 `node scripts/security/check-workflow-pins.mjs --self-test`。不得凭记忆写入 SHA。现有 [pr.yml](../.github/workflows/pr.yml) 与 [deploy.yml](../.github/workflows/deploy.yml) 仍按主版本 tag 引用 action；它们不在 E3.7 允许修改范围，**列为维护者后续工作包**，不要用本 workflow 的固定结果掩盖该缺口。

## 5. 失败政策

政策机器可读定义在 [policy.yml](../.github/security/policy.yml)，`scripts/security/check-exceptions.mjs` 校验其结构与值域。

### 5.1 依赖（dependency review）

- 运行时依赖：HIGH 及以上阻断；MODERATE 及以下记录。
- 开发依赖：不阻断，进入 action 摘要，避免把不进入生产镜像的依赖问题伪装成已通过。
- 可利用性：`known_exploited: block`（CISA KEV 命中不得静默豁免）、`epss_threshold: 0.5`（作为例外评估门槛，EPSS/KEV 数据源为后续工作包）。
- 修复可用性：有修复版本时阻断；无修复版本必须走例外。

### 5.2 镜像（trivy）

- 只扫描 `deploy.yml` 已推送的 ACR 生产镜像 `:<sha>`（或 dispatch 输入的镜像），**不现场构建生产镜像**；E2 staging-offline 镜像含开发依赖，其结果不能替代生产镜像扫描。
- `severity: HIGH,CRITICAL`、`ignore-unfixed: false`、`scanners: vuln`；found 即 job 失败。
- 发现漏洞只生成报告与修复工作包，不在本任务批量升级依赖或重写锁文件。

### 5.3 Secret（gitleaks）

- 保留默认规则；只有已知占位值位置（`docs/evidence/**`、`*.env*.example`、带 `E37CONTROLLED-` 标记的受控样本值）进入 allowlist，且每条必须有说明。
- 用值模式而不是路径白名单覆盖受控样本，避免把 `scripts/security/fixtures/**` 整体变成 secret 盲区。
- 受控合成样本为 [controlled-token.txt](../scripts/security/fixtures/secrets/controlled-token.txt)；证明真实检测能力仍需维护者在首跑中验证。

### 5.4 锁文件（离线）

- 只读 `flower-wms-system/package-lock.json`，**绝不修改**。
- `registry.npmjs.org` 为允许来源；`registry.npmmirror.com` 是 E2 已知基线（当前 739 个包中 627 个），只报告为 warning，不静默“归一化”；未知 host、非 HTTPS、缺失/畸形 SRI 为 error。
- 清理 npmmirror 的锁文件与镜像构建可复现性属独立批准工作包，不在 E3.7 自动修复。

## 6. 例外流程

例外必须同时出现在 [policy.yml](../.github/security/policy.yml) 的 `exceptions:` 中，必填：`id`、`tool`、`vuln_id`、`reason`、`owner`、`expires_on`、`compensating_controls`；建议补充 `exploitability`、`fix_availability`、`package`。

- 日期使用 `YYYY-MM-DD`；**过期例外使检查失败**（`check-exceptions.mjs` 退出码 1），不会静默放行。
- 同一 `tool + vuln_id` 重复、缺少字段、非法日期、未知 tool 均失败。
- 镜像例外还必须在 [trivy-ignore.yaml](../.github/security/trivy-ignore.yaml) 有同 ID 条目，且 `expired_at` 不得晚于 policy 的 `expires_on`；无到期日或未被 policy 背书的忽略直接失败。
- 例外审批人、漏洞数据源（EPSS/KEV）与复审节奏由维护者确定；本包只提供机制与占位。

## 7. Artifact 与日志

| Artifact | 内容 | 保留 |
|---|---|---|
| `sbom-source` | `sbom-source.spdx.json`、`sbom-source.cyclonedx.json` | 30 天 |
| `security-offline-reports` | `workflow-pins.json`、`exceptions.json`、`lockfile.json`（含 host 分布） | 30 天 |
| `image-scan-reports` | `image-ref.txt`（引用 + digest）、`trivy-image.json`、`trivy-image.sarif` | 30 天 |
| gitleaks action artifact | 检测结果 SARIF（由 action 自身上传） | action 默认 |

日志与 artifact 只含引用、digest、主机分布、计数与相对路径；脚本不打印 secret、凭据、`Authorization`/Cookie 或连接串。镜像登录使用 `--password-stdin`，ACR 凭据不落日志。

## 8. 本地验证

在 `CMS_and_WMS` 目录执行；Node 24，零新增依赖（只用 `node:*` 内置模块）。

```text
node scripts/security/check-workflow-pins.mjs
node scripts/security/check-workflow-pins.mjs --self-test
node scripts/security/check-exceptions.mjs --today 2026-11-11
node scripts/security/check-exceptions.mjs --self-test --today 2026-11-11
node scripts/security/check-lockfile.mjs
node scripts/security/check-lockfile.mjs --self-test
node scripts/check-knowledge-structure.mjs --json
node --test scripts/check-knowledge-structure.test.mjs
```

退出码约定（三个脚本一致，`--help` 已写明）：`0` 通过；`1` 政策违规或受控预期不匹配；`2` 用法/内部错误。`--fixtures` 只跑受控样本矩阵；`--self-test` 还包含原语断言与真实仓库文件检查。CI 中同时执行真实检查与 `--self-test`，确保受控失败能力不会随仓库演进而失效。

### 8.1 正常与受控失败证据

| 检查 | 正常样本 | 受控失败样本（均实测失败） | 证据 |
|---|---|---|---|
| 固定 SHA | `security.yml` 15 个 `uses:` 全部 40 位 SHA | `unpinned-tag.yml`、`short-sha.yml`、`missing-version-comment.yml` | [e37-workflow-structure-20261110-163122.log](evidence/sprint-e3/logs/e37-workflow-structure-20261110-163122.log) |
| 最小权限 | 仅 SARIF job 有 `security-events: write` | `missing-permissions.yml`、`write-all-permissions.yml`、`unneeded-security-events.yml` | 同上 |
| 触发与镜像守卫 | PR + dispatch，无 `pull_request_target`，PR 不构建镜像 | `pull-request-target.yml`、`docker-build.yml`、`unpinned-image-scan-guard.yml`、`secret-echo.yml` | 同上 |
| 政策/例外 | 当前 policy 无例外，退出 0 | 过期例外、缺补偿措施、缺 owner、非法日期、未背书/过期/永久 trivy ignore、过宽/缺覆盖 gitleaks allowlist | [e37-exceptions-20261110-163122.log](evidence/sprint-e3/logs/e37-exceptions-20261110-163122.log) |
| 锁文件 | 真实锁文件通过（627 条 npmmirror 仅 warning） | 未知 host、缺失 integrity、HTTP、畸形 integrity、错误 lockfileVersion，`--strict-mirrors` 对 legacy mirror 失败 | [e37-lockfile-20261110-163122.log](evidence/sprint-e3/logs/e37-lockfile-20261110-163122.log) |
| YAML/TOML 语法 | workflow、dependabot、policy、trivy ignore、全部 fixtures 解析通过 | 非法样本由脚本自检覆盖（见上） | [e37-config-syntax-20261110-163122.log](evidence/sprint-e3/logs/e37-config-syntax-20261110-163122.log) |

## 9. 未验证项与维护者待办

**真实首跑（必须由维护者补证，DSH 无 GitHub 推送/运行权限）**

1. 推送后手动触发一次 `workflow_dispatch`，确认 4 个 PR job 均真实执行（`dependency-review` 在 dispatch 下按设计 skipped，需在真实 PR 上验证）。
2. 在真实 PR 上确认 `dependency-review`、`secret-scan`、`sbom`、`offline-supply-chain` 实际运行并通过；失败时保留 run 链接与 artifact。
3. 手动触发 `image-scan`：确认 ACR 凭据可拉取 `:<sha>`、digest 被记录、trivy JSON/SARIF 归档；记录真实镜像的扫描结果（无论通过或失败）。
4. 用受控分支/临时 fork 验证 secret 扫描对真实 secret 的检测；本地只证明了配置结构与 allowlist 语义。

**仓库与权限配置**

5. 分支保护：把 `dependency-review`、`secret-scan`、`sbom`、`offline-supply-chain` 设为 required checks；`image-scan` 保持手动。
6. Code Scanning：启用后移除 `upload-sarif` 步骤的 `continue-on-error: true`，使 SARIF 上传成为硬失败。
7. ACR：建立**只读 pull** 的最小权限账号，写入 `ACR_USERNAME`/`ACR_PASSWORD`；可选用仓库变量覆盖 `ACR_REGISTRY`/`ACR_NAMESPACE`/`IMAGE_REPO`。
8. Dependency graph：dependency-review 依赖仓库 Dependency Graph；关闭时该 job 会失败，需维护者启用。
9. 组织账号需提供 `GITLEAKS_LICENSE`（个人仓库不需要）；不要把许可证值提交到仓库。
10. 网络白名单：gitleaks action（含 gitleaks 8.30.1 下载）、trivy、syft/sbom-action、GitHub API 与 ACR 的出口访问需可用。
11. fork PR：dependency-review 只在同仓 PR 运行；若需覆盖 fork，需要单独的受控设计（不使用 `pull_request_target`）。
12. 现有 `pr.yml`/`deploy.yml` 的 action 仍为 tag 引用，建议另立工作包固定 SHA；本包不修改既有 workflow。
13. 镜像扫描的 EPSS/KEV 富化与 `trivy --vex` 支持、SBOM 与镜像 digest 的长期保留策略，作为后续工作包。
14. 若要在 `push master` 时自动扫描镜像：在 [security.yml](../.github/workflows/security.yml) 的 `on:` 增加 `push: branches: [master]` 即可（`image-scan` 的 `if: github.event_name != 'pull_request'` 已兼容），但会增加 ACR 凭据使用频率，需维护者批准；本包按任务只启用 `pull_request` 与 `workflow_dispatch`。

## 10. 已知限制与风险

- 真实扫描未执行；本文件任何“通过”只指结构/脚本验证。
- 锁文件 npmmirror 基线未改变；该 warning 会持续出现，直到独立工作包修复。
- SBOM 由源码树生成，不等价于生产镜像 SBOM；镜像 SBOM 未在首轮启用。
- 依赖审查不含开发依赖阻断，且 fork PR 未覆盖。
- gitleaks 的受控合成样本只证明 allowlist 不会盲目隐藏受控值；真实规则命中能力以首跑为准。
- 企业级策略（多实例、集中策略下发、审计留存）不在 E3.7 范围。

## 11. 变更边界与知识建议

本包未修改：`pr.yml`、`deploy.yml`、`Dockerfile`、`package.json`、`package-lock.json`、Prisma/迁移、业务源码、已批准知识文档、E1/E2 证据。对 [workflow-proposal.md](../deploy/staging/workflow-proposal.md) 只在末尾追加安全门禁对接段。

建议的知识更新（DSH 只提案，需 Codex/用户批准）：新增或修订“供应链安全门禁政策与例外流程”条目（政策分层、例外必填字段与过期语义、artifact 约定、ACR 拉取权限模型），并在 ADR 登记中评估是否需要 ADR-006“可观测性与安全基线”。不修改已批准业务规则。

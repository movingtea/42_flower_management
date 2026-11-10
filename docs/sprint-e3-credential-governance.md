# Sprint E3.5 · 默认密码与首次登录治理

2026-11-11。任务 `e35-credential-governance`（共享任务 `task-5`）。本文记录 V2 首次登录闭环、V1 遗留风险、密码策略分叉、会话撤销边界、启动检查策略与待批项。实现遵循 [Sprint E3 执行计划](sprint-e3-plan.md) §4.5、§6.2、§9 与 [E3 共享契约](evidence/sprint-e3/contracts.md) §5。

## 1. 结论摘要

- **V2 生产 bootstrap 无默认口令路径**：production seed 只接受密码文件，强制 ≥16 字符强密码，密码文件读取失败只返回固定文案（不含路径/口令），继续拒绝弱密码、test tier、V1/V2 同名库；竞态兜底 `upsert.create` 补 `mustChangePassword: true`，不改变“已存在不覆盖”。
- **首次改密闭环**：bootstrap 会话在改密前被 proxy 重定向到 `/account/v2-password`，V2 授权每次重读 DB；改密用 CAS `updateMany` 并检查 `count`，成功后写 V2 `AuditEvent`（`V2_STAFF_PASSWORD_CHANGED`，`StaffUser`，before/after 仅状态）、发 `auth.password.changed` 事件，随后 `signOut`；错误统一为一条通用提示，不泄露账号状态。
- **启动检查**：新增只读 `scripts/check-v2-credential-governance.mjs`，默认 `V2_CREDENTIAL_CHECK_MODE=warn` 只告警退出 0；`block` 才非零。识别已知默认口令、未完成 bootstrap 的 active 账号、V1 `admin/admin` 风险；不修改账号。
- **V1 仍并存**：无 `mustChangePassword`、无自助改密、重置仅 ≥6、JWT 会话不回查 DB、seed 含 `admin/admin`；本轮只记录，不修改 V1 schema/seed。
- **未做**：不改 Prisma schema/迁移、不改 `src/auth.ts`/`src/auth.config.ts`/`src/proxy.ts`/`staff-management.ts`；管理员重置是否置 must-flag 保持现状（待决 #17）。

## 2. V2 首次登录闭环

### 2.1 生产初始化（`prisma/v2/seed.ts`、`prisma/v2/seed/production.ts`）

| 机制 | 现状（E3.5 后） |
|---|---|
| 密码来源 | 仅 `V2_BOOTSTRAP_ADMIN_PASSWORD_FILE`；不接受环境变量明文口令 |
| 强度 | `isStrongV2Password`：≥16 字符、≤72 UTF-8 字节、不含用户名、去重字符 ≥8 |
| 读取失败 | `readFile` 错误包装为固定文案 `Unable to read the V2 bootstrap password file`；不打印绝对路径、不打印口令 |
| 拒绝矩阵 | 缺失密码文件、弱密码、默认凭据形状、`--tiers=`、V1/V2 同名数据库均失败且退出码 1 |
| 已有账号 | 先查 `StaffUser`，存在则打印“已存在，保留现有凭据与成员关系”并退出 0，不覆盖 |
| must-change | 两条插入路径（`createMany` 与竞态兜底的 `upsert.create`）都写 `mustChangePassword: true` |
| 目标库 | 保留原有 PostgreSQL URL/库名/本地后缀校验；production 仍不做本地后缀限制 |

正常初始化后，管理员下一次 V2 登录携带 `v2BootstrapSession`，只能进入改密/退出所需入口。

### 2.2 改密页（`src/app/account/v2-password/page.tsx`）

1. 读取会话 → 重读 `StaffUser`：非 active 返回“重新登录”；`mustChangePassword` 为 true 才展示表单。
2. 纯决策 `evaluateV2PasswordChange`（`src/v2/password-policy.ts`）：字段完整性、两次一致、强度、当前密码、禁止复用；所有失败统一重定向 `/account/v2-password?invalid=1`。
3. CAS 更新：`updateMany({ where: { id, active: true, mustChangePassword: true, passwordHash: 旧哈希 } })`，**检查 `count`**；`count === 0`（其他设备已改/状态变化）直接 `signOut`，不报告账号状态。
4. 成功后写 `AuditEvent`：
   - `action = V2_STAFF_PASSWORD_CHANGED`、`entityType = StaffUser`、`entityId = 员工 ID`；
   - `tenantId` 先从 active `TenantMember` / `StoreMember` 解析（bootstrap 会话 JWT 的 tenant 字段为 `null`，不能直接用）；解析结果遵循现有授权路径的确定性选择；
   - before/after 只含 `{ active, mustChangePassword }`，**不含哈希或口令**；
   - 解析不到 active 成员关系或审计写入失败时安全降级：记录安全日志、不阻断已完成的改密（见 §5 风险）。
5. 审计后发 `auth.password.changed` 结构化事件（账号仅经 HMAC 指纹），随后 `signOut` 到登录页。
6. 审计写入在 CAS 成功后尽力执行，不在密码事务中；因此“密码已改但审计失败”是已知窗口，靠启动检查与运行日志兜底。

### 2.3 独立测试落点

| 文件 | runner | 覆盖 |
|---|---|---|
| `src/v2/password-policy.vitest.ts` | vitest（`npm run test:unit`） | 常量 16/8/72/8、强度边界、改密决策与失败原因、默认候选清单去重 |
| `src/app/account/v2-password/page.vitest.ts` | vitest | 审计快照仅状态、tenant/store 解析、统一失败重定向、页面接线（CAS count → 审计 → signOut 顺序） |
| `src/v2/credential-governance.test.ts` | integration（`npm run test:integration:v2`） | 策略/候选一致性、竞态兜底 `upsert.create` 契约、启动检查 4 场景、production seed 拒绝矩阵、正常 bootstrap 与不覆盖重跑 |

页面 JSX/Server Action 的真实浏览器行为不在 vitest 层断言；由既有登录/改密 e2e 路径与静态接线测试共同保证，若后续需要浏览器级证据，另立 e2e 用例（需维护者确认账号与数据隔离）。

## 3. 密码策略分叉（未统一，待批 #16）

| 场景 | 最小值 | 其他规则 | 位置 | 本轮处理 |
|---|---|---|---|---|
| V2 bootstrap / 首次改密 | 16 | ≤72 字节、不含用户名、去重 ≥8 | `src/v2/password-policy.ts` | 常量集中为 `V2_BOOTSTRAP_PASSWORD_MIN_LENGTH`，行为不变 |
| V2 管理员重置普通员工 | 8 | ≤72 字节、首尾无空格、复用现有校验 | `src/v2/services/staff-management.ts:12` | 导出 `V2_STAFF_RESET_PASSWORD_MIN_LENGTH=8` 记录现状；**不改服务文件** |
| V1 重置 | 6 | 历史规则 | V1 认证/员工服务 | 只记录，不把 V2 规则套到 V1 |

建议（未批准，不做）：V2 统一为 16 或产品确认的两档；V1 随退役处理。任何收紧都需要产品决定、迁移/通知方案与回退计划。

## 4. 启动检查（`scripts/check-v2-credential-governance.mjs`）

- **调用点**：`docker-entrypoint.sh` 在 V1 `prisma migrate deploy` 与 V2 `db:v2:migrate:deploy` 之后、`exec "$@"` 之前调用。`SKIP_DB_MIGRATE=true` 时整段跳过（与迁移同一开关）。
- **模式**：`V2_CREDENTIAL_CHECK_MODE=warn`（默认）→ 高严重度告警、退出 0；`=block` → 退出 1，容器启动失败。非法值退出 2（配置错误必须显式暴露）。
- **事件**：stdout/stderr 一行 JSON `security.startup.check`，`fields = { outcome: "ok" | "warn" | "blocked", findings: string[] }`；finding 代码示例：`v2_known_default_password:<staffId>`、`v2_bootstrap_pending:<staffId>`、`legacy_default_admin_password`、`v2_check_truncated`、`v2_check_unavailable:<safeCode>`、`legacy_check_unavailable:<safeCode>`。
- **检测项**：
  1. active V2 `StaffUser` 的 bcrypt 哈希与“账号名 + 已知默认口令清单”比对；最多扫描 100 个 active 账号、4 并发，超限写 `v2_check_truncated`。
  2. active V2 账号仍 `mustChangePassword = true`（bootstrap 未完成）。
  3. 配置 `DATABASE_URL` 时只读检查 V1 `staff_users` 的 `admin` 是否仍为默认 `admin` 密码；V1 不可用时只告警，不阻断 V2。
- **安全边界**：只读、不修改账号；输出不含 DSN、密码文件路径、口令、bcrypt 哈希、明文账号；只有内部 staff ID 与 finding 代码。DB 连接失败只输出安全错误码。
- **策略理由**：存量生产账号状态未知（待决 #19），默认不自行锁死生产；`block` 必须由维护者批准后按环境显式开启（待决 #18）。

## 5. 会话撤销边界（待决 #20）

- JWT 为 12 小时无状态会话，**没有** `sessionVersion` / session 表；本轮不新增迁移。
- 现有保障：`src/proxy.ts` 对带 `v2BootstrapSession` 的会话持续重定向到改密页；V2 授权（`requireV2Context`/`resolveV2Membership`）每次请求重读 `StaffUser`、成员关系与 `mustChangePassword`，因此改密/停用/角色变化在“下一次授权”生效。
- 改密成功后的旧 JWT：本设备被 `signOut`；其他设备/标签页不会立即失效，但在下次 V2 授权时因 `mustChangePassword` 已为 false 且 `v2BootstrapSession` claim 仍存在 → proxy 会重定向到改密页；页面发现无待改密状态后要求重新登录（不会获得新授权）。
- **限制如实记录**：无法做到真正的服务端即时撤销；若必须即时撤销，需要新增会话版本字段与迁移，属于另立设计/批准项。V1 会话完全不回查 DB，风险更高（见 §6）。

## 6. V1 遗留风险（只记录，不修改）

| 项 | 现状 | 风险/说明 |
|---|---|---|
| 默认账号 | V1 `prisma/seed.ts` 创建 `admin/admin` 并可打印明文 | 生产若沿用 V1 seed 即为已知默认口令；启动检查只提示 |
| 强制改密 | V1 `StaffUser` 无 `mustChangePassword` | 无法强制首次改密；不能把 V2 字段/规则套到 V1 schema |
| 自助改密 | 无 | 只能管理员重置 |
| 重置强度 | ≥6 | 低于 V2 的 16/8，是否统一待产品决定 |
| 会话 | JWT 不回调 DB 重新校验 | 停用/改密后旧 token 在有效期内仍可用；V1 退役前需接受或另立方案 |
| 并存边界 | V1/V2 独立 schema、独立库、独立审计 | 不做跨库迁移或自动同步 |

## 7. 管理员重置 must-flag（保持现状，待决 #17）

`resetStaffPassword`（`src/v2/services/staff-management.ts`）只更新 `passwordHash`，不置 `mustChangePassword`。本轮**未修改**该文件，也未改变行为；重置后审计沿用 `V2_STAFF_PASSWORD_RESET`。若产品要求“管理员重置后必须再次改密”，需另立范围变更并评估会话重定向、运营成本与 e2e。

## 8. 验证与证据

命令（`CMS_and_WMS/flower-wms-system`）与结果（2026-11-10 UTC）：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx next typegen` | 0 | 路由类型生成成功 |
| `npx tsc --noEmit` | 0 | 无类型错误 |
| `npm run lint` | 0 | 0 error（15 个既有 warning） |
| `npm run test:unit` | 0 | vitest 7 文件 73 用例通过；DB harness 自测 34 项通过；DB-free V2 unit 9 文件通过 |
| `npm run test:integration:v2` | 0 | 33 个 V2 integration 文件通过（含本包矩阵） |

隔离 DB 证据（`node scripts/with-v2-test-db.mjs` 自建临时 PostgreSQL，随机端口，不触碰 5432/55432）：

```text
node scripts/with-v2-test-db.mjs -- node node_modules/tsx/dist/cli.mjs src/v2/credential-governance.test.ts
node scripts/with-v2-test-db.mjs -- node scripts/check-v2-credential-governance.mjs          # warn，退出 0
node scripts/with-v2-test-db.mjs -- node scripts/check-v2-credential-governance.mjs          # block，退出 1
node scripts/with-v2-test-db.mjs -- npm run db:v2:init:production                            # 缺失密码文件，退出 1
```

证据文件（脱敏，`docs/evidence/sprint-e3/logs/`）：

| 文件 | 内容 |
|---|---|
| `e35-gates-20261110-163723.log` | typegen / tsc / lint 命令与退出码 |
| `e35-unit-full-20261110-163818.log` | unit 全量（含本包两个 vitest 文件） |
| `e35-integration-full-20261110-163523.log` | integration 全量 33 文件；含本包 seed/startup 矩阵 13 条 `[e35]` 结论 |
| `e35-startup-warn-20261110-163412.log` | 启动检查默认 warn：`security.startup.check` outcome=warn、退出 0 |
| `e35-startup-block-20261110-163440.log` | 启动检查 block：outcome=blocked、退出 1 |
| `e35-seed-missing-password-file-20261110-163243.log` | 缺失密码文件：固定文案、退出 1、无路径 |

集成测试内部覆盖：启动检查 warn/block/未完成 bootstrap/干净 ok/只读不变，production seed 缺失文件/弱密码/默认凭据形状/test tier/同名库/强密码成功/不覆盖重跑，以及竞态兜底 create 分支。证据日志已做敏感词扫描（无 DSN、bcrypt 哈希、`password_hash`、明文口令）。

## 9. 残留风险与待批项

| # | 事项 | 状态/默认 | 关联待决 |
|---|---|---|---|
| 1 | 密码策略分叉 16/8/6 | 保持现状，只集中常量；未统一 | #16 |
| 2 | 管理员重置不置 must-flag | 保持现状，未改服务文件 | #17 |
| 3 | 启动检查告警 vs 拒绝启动 | 默认 warn 退出 0；block 需显式 env 与批准 | #18 |
| 4 | 当前生产账号状态未知 | 只读检查；生产结论由维护者核对 | #19 |
| 5 | 会话即时撤销 | 无 tokenVersion/迁移；依赖下一次授权重读 DB，已如实记录 | #20 |
| 6 | V1 遗留（默认口令/无强制改密/会话不回查） | 只记录与提示，不修改 V1 | #21 |
| 7 | 生产 bootstrap 密码文件管理 | 仅文件输入；环境模板/发布手册未列该变量，另立提案 | #22 |
| 8 | 改密审计窗口 | CAS 成功与审计写入之间失败时密码已改、审计缺失；已记录安全日志 | — |
| 9 | bcrypt 扫描边界 | 启动检查最多 100 个 active 账号；超出只告警截断 | — |

## 10. 明确未做

- 未修改 Prisma schema/迁移、V1 schema/seed、`src/auth.ts`、`src/auth.config.ts`、`src/proxy.ts`、`staff-management.ts`。
- 未修改 `package.json`/锁文件，未新增依赖（复用 `bcryptjs`、`pg`、现有 Prisma 客户端）。
- 未提交/推送 Git。
- 浏览器级改密 e2e 未新增；页面行为由静态接线测试 + 既有登录路径覆盖，真实 staging/e2e 验证列入后续批次（批次 5）。

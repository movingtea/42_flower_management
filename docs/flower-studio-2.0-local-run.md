# Flower Studio 2.0 本地启动

当前默认入口为 `http://localhost:3000/`，会进入 v2 业务工作台 `/v2`。v2 员工登录与业务数据都使用 `V2_DATABASE_URL` 指向的 v2 数据库；旧数据库只供明确访问旧版后台时使用。该文件被 Git 忽略；其他机器可参照 `.env.v2.example` 创建。

## 本机日常启动

在 PowerShell 中执行：

```powershell
$docker = 'C:\Users\Lorem\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
& $docker start flower-v2-pg
Set-Location 'D:\My-project\flower-studio-ecosystem\CMS_and_WMS\flower-wms-system'
npm run dev
```

打开 `http://localhost:3000/`，使用本地 seed 创建的管理员登录。首次准备应用时，运行 `npm ci`、`npx prisma generate` 和 `npm run db:v2:generate`。

在 WMS 应用目录的 `.env.local` 设置 `V2_DATABASE_URL`，与 `next dev` 共用同一份本地配置。V2 Prisma 配置、迁移目标检查和 seed 按 Next.js 本地开发优先级读取环境文件：当前 shell 变量优先，其次是 `.env.development.local`、`.env.local`、`.env.development` 和 `.env`，因此无需把 `V2_DATABASE_URL` 复制到 `.env`。`DATABASE_URL` 继续指向 V1，也可在 `.env.local` 中覆盖 `.env`。准备空 V2 库或升级已有 V2 库时，依次运行：

```powershell
npm run db:v2:migrate:deploy
npm run db:v2:migrate:status
npm run db:v2:migrate:check
```

`db:v2:seed:dev` 在本机 `_dev` 库创建本地管理员和基础门店资料。`db:v2:seed:test` 在本机 `_test` 库建立测试角色。`db:v2:reset:test` 清空并重建指定测试库，再装入测试数据。这三个命令均限制为本机数据库，在生产模式下拒绝执行。

## 容器与生产初始化

- 在生产主机的 Compose `.env` 配置独立的 `V2_DATABASE_URL`，预先创建目标数据库。应用启动执行两套迁移。发布使用 Git SHA 镜像，并检查 `/api/health` 和 V1/V2 迁移状态。
- 首次初始化前，把管理员临时强密码存入仅受授权用户可读的文件。以只读方式挂载到一次性应用容器，传入 `V2_BOOTSTRAP_ADMIN_USERNAME` 和指向容器内文件的 `V2_BOOTSTRAP_ADMIN_PASSWORD_FILE`，执行 `npm run db:v2:init:production`。初始化只创建指定管理员，重复执行保留已有账号、密码和权限。
- 管理员用临时密码登录后必须修改密码并重新登录。初始化后移除临时密码文件和挂载。

若用生产构建的独立服务验证，需要先把 `.env.local` 中的 v2 连接串注入当前 PowerShell，再启动：

```powershell
$v2Line = Get-Content .env.local | Where-Object { $_ -match '^V2_DATABASE_URL=' } | Select-Object -First 1
$env:V2_DATABASE_URL = $v2Line.Substring('V2_DATABASE_URL='.Length).Trim('"')
npm run build
node .next/standalone/server.js
```

## 已验证

- v2 初始与成本快照增量迁移、seed、并发预留、分次采购验收、缺货补货自动重检。
- 完整试单：采购入库 → 多 SKU 后台订单 → 批次预留 → 采购需求关联或人工替代 → 制作结转 → 自提交付 → 成本快照。
- `npx tsc --noEmit`、v2 ESLint、`npm run build` 通过；管理员会话访问 `/v2` 返回 200，多商品行入口已渲染。

## 如果本地所有页面突然返回 404

先停止 `npm run dev`，再删除项目内 `.next/dev` 开发缓存并重新运行 `npm run dev`。不要同时运行 `npm run build` 与 `npm run dev`；两者都可能更新 Next.js 的生成文件。本机曾出现 `/v2`、`/login` 和认证 API 同时返回 404，清理该缓存并重启后已恢复。

## 当前边界

第一阶段代码与本地自动化验收已完成，下一步是由真实花店员工试用并记录流程反馈。确认后增加或删除 SKU 行仍需取消并重建订单；制作开始后涉及物料的修改进入人工协调。小程序、打样优化与完整报表按后续阶段实施。

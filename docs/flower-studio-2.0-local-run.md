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

打开 `http://localhost:3000/`，使用 v2 seed 创建的本地管理员登录。首次安装依赖时先运行 `npm ci` 和 `npx prisma generate --config prisma.v2.config.ts`。若重新建立空 v2 数据库，在临时设置 `DATABASE_URL` 为 v2 连接串后运行 `npx prisma migrate deploy --config prisma.v2.config.ts`、`npx prisma db seed --config prisma.v2.config.ts`、`npx prisma generate --config prisma.v2.config.ts`。

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

---
title: ADR-001 V1/V2 过渡、认证与切换
type: adr
module: platform
status: under-review
version: 3
owner: engineering
updated: 2026-11-09
sources:
  - "docs/flower-studio-2.0-v1-v2-gap-matrix.md"
  - "flower-wms-system/src/auth.ts"
  - "flower-wms-system/src/auth.config.ts"
  - "flower-wms-system/src/app/page.tsx"
related:
  - "[[E0-adr-register]]"
---

# ADR-001 V1/V2 过渡、认证与切换

## 当前证据

应用根路径已跳转到 `/v2`，旧后台保留显式入口。V1 和 V2 共用 Auth.js 入口与会话机制，凭据提供者分别查询各自的数据源，会话标记 `legacy` 或 `v2`。

## 已确认的退役条件

用户于 2026-11-09 确认，V1 没有正式用户，数据库没有需保留的业务数据。V2 完整覆盖 V1 功能并通过验收后，可直接下线 V1。V1 历史访问、账号迁移、业务数据迁移、门店分批切换和旧入口重定向均不作为下线条件。

## 提案

- V2 上线范围按 [[E0-v1-v2-ownership|功能归属表]] 和验收清单确认。退役时停用 V1 页面、API、凭据提供者及仅服务 V1 的后台任务。先核对 V2 是否仍依赖共用服务或后台任务。
- V2 使用自身的员工账号和门店成员权限。两版并存期间按路由验证会话来源。V2 成为唯一生产写入端，无需双写或双向同步。数据库策略见 [[ADR-002-v2-database-migration]]。

## 下线验收

以 V1/V2 功能差距矩阵为盘点起点，逐项核对 V1 功能在 V2 中的对应能力，并补记矩阵快照之后发现的遗漏。验收覆盖 WMS、CMS、CRM、小程序、经营报表和必需的认证、权限、接口及后台任务。每项记录 V2 入口或等效流程、验收证据和结果。P1 WMS 验收是阶段里程碑。只要还有 V1 功能在 V2 缺失、部分覆盖或未通过验收，就保留 V1。


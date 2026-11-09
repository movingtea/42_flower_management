---
title: ADR-002 V2 数据库、迁移与恢复
type: adr
module: database
status: under-review
version: 2
owner: engineering
updated: 2026-11-09
sources:
  - "flower-wms-system/src/v2/db.ts"
  - "flower-wms-system/prisma.v2.config.ts"
  - "flower-wms-system/prisma/v2/migrations"
  - "Dockerfile"
  - "flower-wms-system/docker-entrypoint.sh"
related:
  - "[[E0-adr-register]]"
---

# ADR-002 V2 数据库、迁移与恢复

## 当前证据

V2 运行时读取 `V2_DATABASE_URL`，V2 Prisma 迁移配置仍读取 `DATABASE_URL`。V1/V2 各有迁移目录，当前镜像和启动脚本使用默认 Prisma 配置。E0.5 负责正式化构建和迁移链路。

## 提案

- V2 使用独立 PostgreSQL 数据库和迁移历史。执行前校验目标数据库和待执行迁移，连接不匹配时停止。测试和开发 Seed 与生产初始化分离。
- 用户于 2026-11-09 确认 V1 数据库无需要保留的业务数据。V1 数据备份、导入 V2、跨版本对账和向 V1 回灌均不在退役范围内。
- 在非生产环境验证 V2 空库迁移和已有 V2 库增量升级。若 V2 生产库已有正式数据，变更前为 V2 保留可恢复的备份。发生故障时保留 V2 写入与审计记录，优先修复并恢复 V2。只有上一版 V2 应用镜像兼容已迁移 schema 时才回退镜像。

## 验证与待决

E0.5 记录 V2 空库迁移和增量升级结果。V2 生产数据的备份周期、恢复责任人、可接受停机和数据丢失上限在正式发布与恢复演练前确定。


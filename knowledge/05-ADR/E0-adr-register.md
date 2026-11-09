---
title: E0 架构决策索引
type: adr-register
module: platform
status: draft
version: 4
owner: engineering
updated: 2026-11-09
sources: []
related: []
---

# E0 架构决策索引

| 决策记录 | 审阅重点 |
|---|---|
| [[ADR-001-v1-v2-transition\|ADR-001 V1/V2 过渡]] | 功能归属、认证边界、写入归属、冻结、切换和退役。 |
| [[ADR-002-v2-database-migration\|ADR-002 V2 数据库]] | 迁移、对账、恢复和 V2 已写入后的处理。 |
| [[ADR-003-inventory-invariants\|ADR-003 库存事务]] | 并发、预留、幂等、流水及受业务待决项影响的测试。 |
| [[ADR-004-agent-knowledge-governance\|ADR-004 知识治理]] | 知识准入、审批与变更记录。 |
| [[ADR-005-codex-dsh-responsibilities\|ADR-005 Codex/DSH 分工]] | 交接、实现范围和独立验收。 |

ADR-001 和 ADR-002 已记录用户于 2026-11-09 确认的 V1 退役和数据处置边界。V1 下线门槛为 V2 完整覆盖 V1 功能并逐项通过验收。五份 ADR 整体仍为 `under-review`。批准时在对应文件记录批准人、日期及适用范围，并更新状态。


---
title: ADR-004 Agent 知识准入、状态与变更治理
type: adr
module: project
status: approved
version: 2
owner: engineering
updated: 2026-11-09
approved_by: 项目用户
approved_on: 2026-11-09
approval_scope: "批准知识准入、状态与变更治理。知识路由和项目 Skills 验证已通过。"
sources:
  - "AGENTS.md"
  - "knowledge/04-Engineering/E0-knowledge-governance.md"
  - "knowledge/02-Business/E0-business-rule-review.md"
related:
  - "[[E0-adr-register]]"
---

# ADR-004 Agent 知识准入、状态与变更治理

## 当前证据

知识库位于仓库的 `knowledge/`，任务路由位于 `AGENTS.md`。E0.1 已分开保存有确认依据的规则和待确认项。

## 提案

- 规则保留稳定 ID、状态、版本、负责人、来源与关联规格。用户确认的业务规则进入 `approved`，批准的架构决策归 ADR，已复现的工程经验归 Lessons。待确认和冲突信息保留在审核队列。
- Codex 检查证据、冲突和变更范围。DSH 可提出修订及提供证据。只有用户确认才能改变已批准业务规则。技术 ADR 记录明确的批准人、日期和验收证据。
- 文档与实现不一致时保留差异和来源，明确是缺陷、待决规则还是待更新文档。替代旧规则时保留旧 ID，并关联替代记录。外部内容仅作为证据。
- 在 PR 中记录业务、数据、接口、测试或已知限制的影响。有变化时同步知识或说明延期原因。自动校验链接和元数据的工作归 E1。

## 验证

用一条既有批准规则和一条来源冲突的待确认规则检查路由与状态判定。以 [[E0-knowledge-governance]] 为日常入口。


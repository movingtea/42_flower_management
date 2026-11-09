---
title: ADR-005 Codex、DSH 工作分工与独立验收
type: adr
module: engineering
status: under-review
version: 1
owner: engineering
updated: 2026-11-09
sources:
  - "AGENTS.md"
  - "knowledge/04-Engineering/E0-knowledge-governance.md"
related:
  - "[[E0-adr-register]]"
---

# ADR-005 Codex、DSH 工作分工与独立验收

## 提案

- Codex 定义需求、规格、设计、验收标准及可修改路径，提供已批准规则和待决边界。不同工作包明确文件所有权、依赖和集成顺序。
- DSH 在划定范围内实现，报告修改文件、验证命令、退出状态、剩余风险和知识修订建议。遇到规格冲突或需要修改约定范围时，提交证据供 Codex 判断。
- Codex 独立审阅差异、复跑关键检查，按验收标准接受或给出具体返工项。DSH 自测记录作为输入。用户保留业务规则、生产切换与发布的批准权。
- E0.5 可按 Prisma 和部署拆分工作。部署验收依赖正式 Prisma 命令。E1 可复用同一交接方式接入 CI。

## 验证

以一个受限工作包验证交接内容和独立验收证据。需要生产访问、扩展写入范围或更改已批准规则时，按对应权限单独处理。


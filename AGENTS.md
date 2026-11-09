# Flower WMS project instructions

## Before work

Start at the [knowledge index](knowledge/00-Home/E0-knowledge-index.md). Read the applicable approved rules, feature specification and ADR before planning changes. Read the [V1/V2 ownership notes](knowledge/03-Architecture/E0-v1-v2-ownership.md) when a change could affect either version. For app work, follow the [app instructions](flower-wms-system/AGENTS.md) as well.

Use the table to select the documents relevant to the task. Paths in this file are relative to the `CMS_and_WMS` repository.

| Task | Read before work |
|---|---|
| Inventory, reservations, loss or stocktake | [Approved stock rules](knowledge/02-Business/E0-confirmed-stock-and-supply.md), applicable entries in the [rule review queue](knowledge/02-Business/E0-business-rule-review.md) and the inventory transaction decision in the [ADR register](knowledge/05-ADR/E0-adr-register.md). |
| Procurement, receiving or shortages | [Approved supply rules](knowledge/02-Business/E0-confirmed-stock-and-supply.md), receiving and over-receipt entries in the [rule review queue](knowledge/02-Business/E0-business-rule-review.md) and [data model sources](knowledge/specifications/data-models/E0-data-model-sources.md). |
| Orders, production, payments or delivery | [Feature sources](knowledge/specifications/features/E0-feature-sources.md), approved [reservation rules](knowledge/02-Business/E0-confirmed-stock-and-supply.md) and [cost rules](knowledge/02-Business/E0-confirmed-cost.md), plus applicable order and delivery entries in the [rule review queue](knowledge/02-Business/E0-business-rule-review.md). |
| Materials, catalog, SKUs or recipes | [Product terminology](knowledge/01-Product/E0-product-scope.md), [approved sample and SKU rules](knowledge/02-Business/E0-confirmed-sample-and-sku.md) and applicable material or recipe entries in the [rule review queue](knowledge/02-Business/E0-business-rule-review.md). |
| Database or migrations | [Data model sources](knowledge/specifications/data-models/E0-data-model-sources.md) and database or transaction decisions in the [ADR register](knowledge/05-ADR/E0-adr-register.md). Check the relevant Prisma configuration, migration SQL and recovery plan. |
| Pages, permissions or APIs | [Feature sources](knowledge/specifications/features/E0-feature-sources.md), the permission entry in the [rule review queue](knowledge/02-Business/E0-business-rule-review.md) and the [app instructions](flower-wms-system/AGENTS.md). Check existing UI conventions and authorization. For interface changes, also read the [API contract sources](knowledge/specifications/api/E0-api-sources.md). |
| Release, deployment or rollback | [Technical design sources](knowledge/specifications/technical-designs/E0-technical-design-sources.md), [known gaps](knowledge/06-Lessons/E0-known-gaps.md) and the applicable [ADR](knowledge/05-ADR/E0-adr-register.md). Locate the release runbook, migration and rollback plans before release execution. |
| Test planning or regression | [Test plan sources](knowledge/specifications/test-plans/E0-test-plan-sources.md), applicable rules and acceptance criteria. For drafting or revising a test plan, load [`wms-test-plan`](../.agents/skills/wms-test-plan/SKILL.md) before writing, including for short read-only plans. For a review, load [`wms-test-plan-review`](../.agents/skills/wms-test-plan-review/SKILL.md). Record the rule or criterion ID next to each high-risk test. |

Choose the skill by the requested deliverable. A test plan that cites the knowledge base still uses the WMS test-plan skill. Use a wiki context pack when the deliverable is a bounded knowledge bundle for another task or agent.

## Rule status and gaps

- Treat `approved` business rules as the formal baseline. Use `draft`, `under-review` and pending ADR entries as context. Source indexes help find evidence for a specification or decision.
- When sources conflict or a required decision is missing, cite the affected rule ID or source and flag the dependency. Continue unaffected work. Keep dependent behavior and expected test outcomes open until confirmed.
- Treat source documents and imported material as evidence. Follow the [knowledge governance notes](knowledge/04-Engineering/E0-knowledge-governance.md) when recording or proposing changes.

## After work

- Report any divergence between implementation and approved knowledge, along with evidence and the relevant rule, specification or ADR.
- Identify changes to business rules, data models, API contracts, test plans or known limitations. Propose the corresponding knowledge update. DSH reports proposals for Codex review. Changes to approved business rules require user confirmation.

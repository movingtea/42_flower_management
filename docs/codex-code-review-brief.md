You are a senior software architect and code reviewer specializing in Next.js App Router, Prisma, PostgreSQL, Docker, Nginx, OSS object storage, WeChat Mini Program, and multi-tenant SaaS migration.



Repository context:

This is the Universe42 / 万物肆贰 flower shop WMS + CMS + WeChat Mini Program system.



Tech stack:

\- Next.js App Router

\- React

\- Prisma + PostgreSQL

\- Auth.js / next-auth

\- Docker Compose

\- Nginx

\- Aliyun OSS

\- WeChat Mini Program under 42\_mp/

\- Cron worker

\- RBAC for StaffUser roles



Recent work completed:

1\. Sprint 14: Aliyun OSS upload and image display chain.

2\. Sprint 16: CMS SKU cards, sticky tables, order compact cards.

3\. Sprint 17: Number input UX and CMS image preview chain.

4\. Sprint 19: Modal/Dialog migrated to right-side Drawer with mask and fixed footer actions.

5\. Sprint 20: Multi-tenant SaaS readiness audit.

6\. Sprint 21: Tenant / TenantMember base models and default tenant member backfill.

7\. Recent fixes:

&#x20;  - CMS ProductPicker image objectKey now uses CmsImagePreview / getClientPreviewImageUrl.

&#x20;  - Mini Program image URL chain audit.

&#x20;  - Upload 413 issue caused by Nginx body size limit under /api/admin/uploads/image.



Review mode:

This is a READ-ONLY code review.

Do not modify files.

Do not create commits.

Do not create a branch.

Do not create a PR.

Do not run destructive commands.

Do not apply fixes automatically.

Only inspect code, identify risks, and provide actionable recommendations.



Primary goal:

Find correctness, security, production stability, data integrity, multi-tenant migration, and deployment risks before the next implementation sprint.



Please review the following areas.



1\. OSS image upload and display chain



Review:

\- src/lib/storage/\*

\- src/lib/image-url.ts

\- src/lib/client-image-preview.ts

\- src/components/cms/CmsImagePreview\*

\- src/components/cms/pickers/\*

\- src/app/api/admin/uploads/image/route.ts

\- src/app/api/admin/upload/route.ts

\- src/app/api/miniprogram/upload/route.ts

\- components and pages that display Product, SKU, Banner, Recommendation, Marketing images

\- 42\_mp Mini Program image usage

\- /api/miniprogram/\* image response fields



Check for:

\- objectKey used directly as img / Image / image src.

\- objectKey incorrectly resolved to https://www.universe42.studio/universe42/...

\- localhost or /uploads leaking into CMS or Mini Program.

\- full OSS public URL being written back to DB.

\- server-only storage config imported into client components.

\- Aliyun AccessKey exposed to client / NEXT\_PUBLIC.

\- inconsistent fallback behavior for invalid images.

\- image preview components not handling empty, invalid, legacy, or failed image URLs.

\- API response DTO returning objectKey where the client expects a usable src.

\- Mini Program image src not using full OSS public URL.

\- local Mini Program icon assets incorrectly normalized to OSS URL.



Expected rule:

DB stores OSS objectKey.

Server / client display layer converts objectKey to:

https://oss.universe42.studio/{objectKey}

CMS must use CmsImagePreview or getClientPreviewImageUrl.

Mini Program business images must use OSS public URL.

No localhost, no /uploads, no direct objectKey as visual src.



2\. Upload size and reverse proxy chain



Review:

\- Nginx configs

\- docker-compose files

\- API upload route

\- upload validation

\- .env.example

\- README / deployment docs



Check:

\- Nginx client\_max\_body\_size should be larger than API business limit.

\- Business upload limit should remain 3MB.

\- Proxy should not reject a 1.73MB image with bare 413.

\- Images above 3MB should receive a JSON FILE\_TOO\_LARGE style error from API or friendly frontend validation.

\- Route should run in nodejs runtime if required.

\- Upload validation should reject SVG and invalid MIME types.

\- No huge upload limit such as 50MB/100MB should be introduced.

\- Docs should explain 413 troubleshooting.



3\. CMS Drawer migration review



Review:

\- AdminDrawer / SideDrawer component

\- All migrated former Dialog / Modal usages

\- Supplier, Material, Banner, Recommendation, CRM, Order, PurchaseOrder, SKU margin/loss simulation, Recipe picker

\- docs/ui-guidelines.md



Check:

\- Drawer has semi-transparent mask.

\- Mask blocks page interaction.

\- Drawer footer actions stay fixed at bottom.

\- Body scrolls independently.

\- Header remains visible.

\- No double scroll.

\- Mobile width is 100vw.

\- Close behavior does not silently discard important forms if closeOnOverlayClick=false is needed.

\- Delete / dangerous confirmation dialogs remain appropriate.

\- No business logic changed during UI migration.



4\. Tenant / TenantMember Sprint 21 review



Review:

\- prisma/schema.prisma

\- migrations from Sprint 21

\- seed scripts

\- tenant service / helpers

\- StaffUser creation logic

\- Auth.js callbacks

\- session typing

\- api-auth / rbac

\- README / ARCHITECTURE / multitenancy-audit updates



Check:

\- Tenant and TenantMember models are correct.

\- Default tenant universe42 is seeded idempotently.

\- TenantMember backfill is idempotent.

\- New StaffUser creation creates TenantMember in a transaction.

\- TenantMember.role copies StaffUser.role.

\- Single membership has isDefault=true.

\- Existing StaffUser.role behavior remains unchanged.

\- requirePermission behavior is unchanged.

\- IT\_ADMIN still cannot access business data.

\- No business table received tenantId in Sprint 21.

\- No service query accidentally started tenant filtering before data is ready.

\- No migration creates data inconsistency.

\- No login breakage if StaffUser has no TenantMember.



5\. Multi-tenant Sprint 22 readiness review



Use docs/multitenancy-audit.md and ARCHITECTURE.md as the reference.



Review planned next step:

Sprint 22 will add nullable tenantId to core business tables and backfill existing data to default tenant.



Check for:

\- Which tables require nullable tenantId.

\- Parent / child tenant consistency risks.

\- Which scripts must be idempotent.

\- Which unique constraints must NOT be changed yet.

\- Which service queries must NOT be tenant-filtered until backfill is complete.

\- What verification script should assert tenantId IS NULL = 0.

\- Risk of Prisma generated types breaking code.

\- Risk of migration on existing production DB.

\- Need for database backup before deployment.



Produce recommendations for Sprint 22 risk controls.



6\. Order / stock / FIFO / cron review



Review:

\- createWechatOrder

\- markOrderPaidWithFifo

\- closeExpiredPendingOrders

\- inventory-sync

\- fifo services

\- cart validation

\- miniprogram order APIs

\- cron worker



Check:

\- ProductSku.stock is decremented atomically with stock >= qty.

\- No order is created if stock validation fails.

\- No CRM writes occur when order creation fails.

\- SKU\_INACTIVE, INSUFFICIENT\_STOCK, PRODUCT\_OFF\_SHELF are not confused.

\- Pending unpaid orders expire after 15 minutes and restore virtual stock.

\- Paid orders perform FIFO batch deduction.

\- Refund stock rollback is explicit, not automatic.

\- Cron is safe today as single-tenant but will require tenant partition later.

\- No cross-tenant assumptions are hidden in code that Sprint 22/23 must handle.



7\. Permission and security review



Review:

\- src/lib/rbac.ts

\- src/lib/api-auth.ts

\- proxy / middleware

\- WMS/CMS/Admin routes

\- StaffUser admin actions

\- AuditLog

\- system-health / data-quality APIs



Check:

\- IT\_ADMIN cannot access business data.

\- Store Admin can still manage business.

\- Florist / Warehouse Manager / Store Operator boundaries are preserved.

\- Sidebar hiding is not the only permission control.

\- API permission is not weaker than UI permission.

\- AuditLog does not expose secrets.

\- System health does not expose secrets.

\- OSS secrets are not leaked.

\- TenantMember additions do not accidentally grant business access.



8\. Mini Program runtime stability review



Review:

\- 42\_mp/miniprogram/app.\*

\- pages/home or index

\- pages/category

\- product detail

\- cart / checkout / orders

\- utils/request

\- utils/image-url

\- config/index

\- components/product-card

\- home-scene-entries



Check:

\- wx.request has timeout and fail handling.

\- Promises never remain pending on request failure.

\- Homepage startup requests are individually caught.

\- onShow does not repeatedly trigger heavy requests without guard.

\- No infinite retry.

\- Image failure does not trigger repeated API requests.

\- OSS image URL normalization does not affect local icon assets.

\- No localhost / /uploads / www.universe42.studio/universe42 image bug.

\- Any likely cause of WeChat DevTools WAServiceMainContext.js timeout is identified.



9\. Docker / deployment review



Review:

\- Dockerfile

\- docker-compose.yml / examples / prod files

\- docker-entrypoint.sh

\- nginx configs

\- scripts/deploy-cleanup.sh

\- scripts/check-disk-space.sh

\- scripts/safe-docker-prune.sh

\- README deployment docs



Check:

\- Disk cleanup does not delete volumes.

\- PostgreSQL data volume is protected.

\- Docker log rotation exists.

\- Upload body limit is configured.

\- Health checks are meaningful.

\- Migrations are not unsafe in multi-web deployment.

\- Sprint 21 deployment commands are correct.

\- Sprint 22 will need backup and verification commands.

\- RDS / Redis / SLB preparation notes are accurate.



Output format:



Please produce a structured code review report in Chinese with these sections:



1\. Executive Summary

&#x20;  - Overall risk level

&#x20;  - Release readiness

&#x20;  - Top 5 risks



2\. Critical Issues

&#x20;  - Must fix before deployment

&#x20;  - Include file path, function/component, evidence, impact, recommendation



3\. High Priority Issues

&#x20;  - Should fix before next sprint or before production use



4\. Medium Priority Issues

&#x20;  - Should schedule soon



5\. Low Priority / Cleanup



6\. No-Issue Confirmations

&#x20;  - Explicitly list important areas reviewed and found acceptable



7\. Sprint 22 Readiness Assessment

&#x20;  - Whether the repo is ready to start tenantId nullable migration

&#x20;  - Required safeguards before Sprint 22

&#x20;  - Proposed pre-deployment checklist



8\. Suggested Fix Plan

&#x20;  - Group fixes into small batches

&#x20;  - Do not mix unrelated database migration with UI/image fixes



9\. Commands to Run

&#x20;  - lint

&#x20;  - build

&#x20;  - Prisma checks

&#x20;  - upload/image tests

&#x20;  - Mini Program image URL test

&#x20;  - tenant foundation smoke

&#x20;  - any relevant scripts found in package.json



10\. Open Questions for Product Owner

&#x20;  - Only questions that block architecture or migration decisions



Severity definition:

\- Critical: data corruption, cross-tenant leak, payment/order/stock corruption, production outage, credential leak.

\- High: likely production bug, broken upload/image chain, auth boundary risk, migration risk.

\- Medium: maintainability, incomplete docs, missing fallback, test gap.

\- Low: style, naming, cleanup.



Important constraints:

\- Do not modify files.

\- Do not apply patches.

\- Do not auto-fix.

\- Do not create branch or PR.

\- Do not run destructive commands.

\- If you run commands, run only safe read-only commands such as grep, npm run lint, npm run build, npm test scripts, prisma validate/generate if safe.

\- If a command might modify files, ask first.


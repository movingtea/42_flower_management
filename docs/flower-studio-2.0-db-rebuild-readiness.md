# Flower Studio 2.0 数据库重构准备

状态：用户已确认旧连接目标及数据可以丢弃。v2 初始迁移已在独立本地测试库验证；现有配置目标尚未修改。

## 交付物

- 目标模型：`flower-wms-system/prisma/schema.v2.draft.prisma`，`prisma validate` 已通过。
- 空 PostgreSQL 库的初始 SQL 预览：`docs/flower-studio-2.0-initial-preview.sql`，由 `prisma migrate diff --from-empty --to-schema` 生成，未执行。
- 数据库额外约束草案：`docs/flower-studio-2.0-check-constraints.sql`，包含非负数量与核心跨租户复合外键，已随初始迁移在独立测试库执行。
- 正式 v2 迁移文件：`flower-wms-system/prisma/v2/migrations/0001_initial/migration.sql`，已从空库部署成功。
- 业务约束与并发要求：`docs/flower-studio-2.0-constraint-review.md`。
- 旧模型去向：`docs/flower-studio-2.0-peripheral-model-mapping.md`。

## 已准备的边界

内容运营模型包括商品和物料分类、Banner、推荐位和首页场景入口，均有租户归属。SKU 默认关系、打样选中的方案均采用复合外键。订单、采购和打样计划的租户与门店归属，采购单的供应商归属，以及 Banner 关联商品的租户一致性，已列入额外约束 SQL。

库存数量约束、支付与退款正金额约束已列入额外约束 SQL。跨行总量，例如同批次顾客订单预留加打样预留不得超过可用量、在途分配不得超过供应商确认量，须由 PostgreSQL 事务、行锁和条件更新保证；单行 `CHECK` 无法完成这些规则。

## 正式迁移前的实施门槛

1. 已确认旧系统没有正式上线，旧目标和数据可以丢弃。执行前仍需读取并核对实际 `DATABASE_URL` 指向的数据库，以免误操作无关目标。
2. 将草案整理为正式 `prisma/schema.prisma`，按新模型修改 seed 和应用服务；旧服务和旧页面仍引用旧 Prisma client，不能只替换 Schema 就启动现有应用。
3. 将 SQL 预览及额外约束合并为正式初始 migration，检查复合外键与 Prisma 生成的外键是否共存、索引是否足够、默认 SKU 的循环关联是否可按“先建商品及 SKU，再设置默认值”初始化。
4. 在全新测试库执行迁移与 seed，验证跨租户引用被拒绝、负库存被拒绝、客户订单与打样并发不超额、在途不超配、支付回调幂等、降级验收与结账成本调整。
5. 完成 API 与页面切换、重新生成 Prisma client、TypeScript 构建和端到端试用后，才让 2.0 接管运行环境。

## 当前尚未由 Schema 自动保证的规则

- 默认 SKU 必须启用、在售商品至少一个启用 SKU；售罄时前台临时预选有货 SKU。
- 分类关系、推荐项 SKU、样品来源 SKU 等多跳关系的租户一致性；服务层必须检验，迁移时可继续增加复合外键或触发器。
- 物料整数单位规则 `quantityScale=0`；跨表约束需要写入业务服务并用数据库触发器强化。
- 已发布配方、库存流水、支付事实、成本快照不可被业务 API 覆盖。
- 账面余额与交易流水、整卷耗材状态与批次余额之间的一致性。

这些事项属于实现任务，不是尚待花店确认的业务问题。设计结论已足以开始服务与迁移开发。

-- 受控失败迁移：故意引用不存在的表，使 prisma migrate deploy 失败（仅测试镜像使用）
ALTER TABLE "e2_controlled_failure_missing_table" ADD COLUMN "should_fail" text;

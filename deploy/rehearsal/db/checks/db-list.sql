-- E1.8 演练：列出数据库实例中的数据库（用于确认 V1/V2 独立库存在，且未触碰其他项目）
SELECT datname FROM pg_database ORDER BY 1;

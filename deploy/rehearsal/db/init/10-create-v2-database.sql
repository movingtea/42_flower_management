-- E1.8 演练：在空数据卷首次启动时创建独立的 V2 数据库。
-- V1 数据库由 POSTGRES_DB 自动创建（flower_e18_v1）。
-- 固定库名以保证隔离与可复跑；不得在本文件写入真实凭据。
CREATE DATABASE flower_e18_v2;

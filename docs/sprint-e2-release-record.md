# Sprint E2 发布记录模板与归档

本文件沿用 [E1 发布手册](flower-studio-2.0-release-runbook.md) 第 14 节模板，补充 E2 staging 字段。每次本机 staging 演练的发布/回滚记录归档在 `docs/evidence/sprint-e2/releases/`（脱敏）。

## 模板

```text
发布编号：REL-YYYYMMDD-NN（环境：local-staging / remote-staging / prod）
目标环境：<flower-e2-staging 或远程 staging 主机>
源码 SHA：
实际镜像 digest（远程 registry digest；本机记录 image ID）：
上一版镜像：
发布窗口（计划/实际）：
审批/执行人/复核人：
包含迁移：<无 / V1: n 个 / V2: m 个；待应用清单>
迁移执行者：<web entrypoint / 显式迁移任务；不得重复>
迁移前备份：<备份集、路径、sha256、manifest 位置>
预检结果：<目标连通、镜像、迁移历史、磁盘>
迁移前后核对：<applied 数、unfinished=0、行数/不变量>
健康检查：<时间、返回体>
核心冒烟：<登录/工作台/关键页面/cron/上传（远程）>
cron：<成功轮次与时间>
失败决策：<停止条件编号、处置、是否回滚>
回滚：<未使用 / 使用；镜像 digest、数据库保持前滚、耗时>
恢复（如适用）：<备份集、恢复点、恢复耗时、停写边界>
故障单：<编号或“无”>
资源清理：<容器/卷/网络/镜像/临时库/备份>
后续知识更新：<Runbook/ADR/已知限制>
```

## 本机 staging 记录

| 记录 | 类型 | 说明 |
|---|---|---|
| [rel-20261110-143533-local](evidence/sprint-e2/releases/rel-20261110-143533-local.md) | 部署 | 同版本部署（E2.2 首次成功） |
| [rel-20261110-143640-local](evidence/sprint-e2/releases/rel-20261110-143640-local.md) | 部署 | 同版本重试安全 |
| [rel-20261110-144133-local](evidence/sprint-e2/releases/rel-20261110-144133-local.md) | 部署 | 坏镜像后恢复正常镜像 |
| [rollback-*-local](evidence/sprint-e2/releases/) | 回滚 | E2.5 坏镜像 → 上一版镜像；数据库保持前滚 |

## 记录要求

- 每次成功部署/回滚写一条；失败场景写故障与停止记录（可引用 e22/e25 证据日志）。
- 只写相对路径与脱敏字段；连接串、密码、token、真实业务数据不入库。
- 远程 staging/生产的正式记录由维护者/项目用户按同一模板归档；本机记录不得冒充远程或生产证据。
- 关闭条件：E2 工程验收五项（真实 SHA 镜像、自动备份可恢复、迁移前后可重复验证、坏版本停止与兼容回滚、发布记录可复查）逐项有证据；远程/生产待决项单列。

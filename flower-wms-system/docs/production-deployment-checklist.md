# 生产部署检查清单（Batch D.1）

> 部署路径：`/root/flower-platform/` + 根目录 `docker-compose.yml`  
> 生产 env 模板：[`../.env.production.example`](../.env.production.example)  
> Nginx 模板：[`../deploy/nginx/conf.d/flower.conf.example`](../deploy/nginx/conf.d/flower.conf.example)

自动化预检：

```bash
cd flower-wms-system
npm run check:production-env-example
npm run check:nginx-upload-limit
```

---

## 1. 环境变量

- [ ] `.env` 由 `.env.production.example` 复制，`chmod 600`
- [ ] `DATABASE_URL` 指向 compose 内 `db` 服务
- [ ] `NEXTAUTH_URL` = `https://www.universe42.studio`（或实际域名）
- [ ] `NEXTAUTH_SECRET` / `AUTH_SECRET` 已更换为强随机值
- [ ] `ENABLE_OSS_UPLOAD=true`
- [ ] `ALIYUN_OSS_REGION` / `ALIYUN_OSS_BUCKET` 正确
- [ ] `ALIYUN_OSS_ENDPOINT`（外网）已配置
- [ ] `ALIYUN_OSS_INTERNAL_ENDPOINT`（内网）已配置
- [ ] `ALIYUN_OSS_UPLOAD_ENDPOINT` 生产 ECS 同地域用 **内网**
- [ ] `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET` 已填写（**仅服务端**）
- [ ] `ALIYUN_OSS_OBJECT_PREFIX=universe42`
- [ ] `ALIYUN_OSS_PUBLIC_BASE_URL=https://oss.universe42.studio`
- [ ] `NEXT_PUBLIC_OSS_PUBLIC_BASE_URL` 与 public base 一致
- [ ] `NEXT_PUBLIC_OSS_OBJECT_PREFIX=universe42`
- [ ] `UPLOAD_MAX_SIZE_MB=3`
- [ ] `ENABLE_LEGACY_UPLOADS=false`
- [ ] **无** `NEXT_PUBLIC_*ACCESS_KEY*` / `NEXT_PUBLIC_*SECRET*`

---

## 2. Nginx

- [ ] `/root/flower-nginx/conf.d/flower.conf` 含 `client_max_body_size 5m;`
- [ ] 80 → 443 跳转正常
- [ ] SSL 证书路径正确
- [ ] upstream 为 `flower-web:3000`（compose 服务名）
- [ ] 修改配置后：`docker compose exec flower-nginx nginx -t && nginx -s reload`
- [ ] 验证：`docker compose exec flower-nginx nginx -T | grep client_max_body_size`

---

## 3. OSS

- [ ] Bucket 可写（`cd flower-wms-system && npm run test:oss` 可选）
- [ ] `https://oss.universe42.studio/{objectKey}` 浏览器可访问
- [ ] 自定义域名证书有效
- [ ] 微信小程序后台 **downloadFile 合法域名** 含 `https://oss.universe42.studio`

---

## 4. 上传验收

- [ ] CMS Banner 上传 **1.73MB** 图片成功
- [ ] CMS SKU 上传 **1.73MB** 图片成功
- [ ] 超过 **3MB** 图片：API 返回 JSON `FILE_TOO_LARGE`（非裸 Nginx 413）
- [ ] DB 保存 **objectKey**，非完整 OSS URL
- [ ] CMS 预览显示 `https://oss.universe42.studio/...`
- [ ] 小程序 API 图片字段为 OSS public URL

详见 [`upload-size-limit-checklist.md`](upload-size-limit-checklist.md)。

---

## 5. 安全

- [ ] AccessKey 未出现在 `NEXT_PUBLIC_*`
- [ ] AccessKey 未提交到 Git
- [ ] `.env.production.example` 仅含占位值
- [ ] `/api/admin/system/health` 不返回密钥明文

---

## 6. 发布前测试

```bash
cd flower-wms-system
npm run check:production-env-example
npm run check:nginx-upload-limit
npm run test:upload-validation
npm run test:image-url
npm run test:miniprogram-image-dto
npm run smoke:permission-matrix
npm run lint
npm run build
```

---

## 7. Sprint 22 前（tenantId）

进入 Sprint 22 生产发布前必须：

1. **备份** 生产数据库
2. `npx prisma migrate deploy`
3. `npm run db:seed:tenant` / `db:backfill:tenant-members`（按 Sprint 21 文档）
4. 验证 tenant smoke
5. 再部署应用镜像

---

## 8. D.2 后续（migration job）

| 现状 | 后续 |
|---|---|
| 单 `flower-web` 实例 | `docker-entrypoint.sh` 内 `prisma migrate deploy` 可暂保留 |
| 多 web 实例 / 滚动发布 | **必须**迁移到独立 migration job，避免并发 migrate |
| Sprint 22 生产 | **backup → migrate → backfill → verify → deploy** |

本轮 **不修改** `docker-entrypoint.sh`；D.2 单独实现 migration job。

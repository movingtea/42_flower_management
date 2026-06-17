# 图片上传大小限制验收清单

> 业务层 `UPLOAD_MAX_SIZE_MB=3`；Nginx `client_max_body_size=5m`（必须高于业务限制）。

## Nginx / 部署

- [ ] 生产 `/root/flower-nginx/conf.d/flower.conf` 含 `client_max_body_size 5m;`
- [ ] 配置来源：`deploy/nginx/conf.d/flower.conf.example`
- [ ] 修改后已执行 `docker compose exec flower-nginx nginx -t && nginx -s reload`
- [ ] `docker compose exec flower-nginx nginx -T | grep client_max_body_size` 输出 `5m`

## CMS 上传（应成功）

- [ ] Banner 上传 **1.73MB** jpg/png/webp 成功
- [ ] 商品 SKU 上传 **1.73MB** 图片成功
- [ ] 营销弹窗上传 **1.73MB** 图片成功
- [ ] 上传成功后 DB 保存 **objectKey**（非完整 OSS URL）
- [ ] CMS 预览显示 `https://oss.universe42.studio/...`

## 超限与非法文件（应友好拒绝）

- [ ] **超过 3MB** 图片：前端或 API 提示「图片不能超过 3MB，请压缩后重试」
- [ ] 超过 3MB **不应**再出现裸 Nginx 413 HTML 页（需 Nginx 5m 已配置）
- [ ] API 超限返回 JSON，`code: FILE_TOO_LARGE`
- [ ] 非图片类型被拒绝（`INVALID_FILE_TYPE`）
- [ ] SVG 被拒绝

## 回归

- [ ] OSS 上传仍正常（`npm run test:oss` 可选）
- [ ] 小程序图片展示未受影响

## 自动化

```bash
cd flower-wms-system
npm run test:upload-validation
npm run test:storage
npm run lint
npm run build
```

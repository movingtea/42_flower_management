# 生产 Nginx 配置

## 部署路径

1. 将 `conf.d/flower.conf.example` 复制到服务器：
   ```bash
   cp deploy/nginx/conf.d/flower.conf.example /root/flower-nginx/conf.d/flower.conf
   ```
2. 与根目录 `docker-compose.yml` 中 `flower-nginx` 挂载一致：
   - `/root/flower-nginx/conf.d` → `/etc/nginx/conf.d`
3. 修改 SSL 证书路径后 reload：
   ```bash
   docker compose exec flower-nginx nginx -t
   docker compose exec flower-nginx nginx -s reload
   ```

## 图片上传 body 限制

| 层 | 推荐值 | 说明 |
|----|--------|------|
| Nginx `client_max_body_size` | **5m** | 必须 **大于** 业务限制，否则 1MB+ 图片在到达 Next.js 前即 413 |
| 应用 `UPLOAD_MAX_SIZE_MB` | **3** | API `upload-validation` 校验；超限返回 JSON `FILE_TOO_LARGE` |

验证已生效：

```bash
docker compose exec flower-nginx nginx -T | grep client_max_body_size
```

若 1MB 以上图片返回裸 **413 Request Entity Too Large**（非 JSON），优先检查此项。

# Sprint 22 — 小程序图片 URL 审查验收清单

> 业务远程图片必须使用 `https://oss.universe42.studio/...`；禁止 objectKey、localhost、`/uploads` 作为 `<image src>`。

## 微信后台配置

- [ ] 微信小程序后台 → 开发 → 开发管理 → 服务器域名
- [ ] **downloadFile 合法域名** 含 `https://oss.universe42.studio`
- [ ] **request 合法域名** 含业务 API 域名（如 `https://www.universe42.studio`）
- [ ] 远程 `<image>` 加载 OSS 图片依赖上述域名配置（本轮不改微信后台，仅人工确认）

## 首页

- [ ] Banner 轮播图正常显示（OSS URL）
- [ ] 推荐位商品图正常显示
- [ ] 首页场景入口 **本地 icon** 正常（不走 OSS）
- [ ] 首页商品列表/分类 Tab 商品图正常
- [ ] 营销弹窗图片正常（如有）

## 商品

- [ ] 分类/列表页商品卡片图正常
- [ ] 商品详情主图轮播正常
- [ ] 多规格 SKU 款式图切换正常
- [ ] 单规格不显示「默认规格」选择器（业务逻辑未改，顺带确认）
- [ ] 售罄状态展示正常

## 购物车 / 下单 / 订单

- [ ] 购物车行商品图正常
- [ ] 下单页商品图正常
- [ ] 订单列表快照商品图正常
- [ ] 历史订单中 objectKey 快照经 API/前端转换后正常或占位

## 个人中心

- [ ] 头像展示正常（OSS public URL）
- [ ] 头像上传后展示与保存正常

## 禁止出现的地址

- [ ] 无 `https://www.universe42.studio/universe42/...` 错误拼接
- [ ] 无 `localhost` 业务图片
- [ ] 无 `/uploads` 业务图片
- [ ] 本地 `assets/icons` 未被错误拼接 OSS 域名

## API

- [x] `/api/miniprogram/*` 服务端 DTO 经 `miniprogram-image-dto` + `imageUrlFormatter` 输出完整 HTTPS OSS URL（Batch C）
- [x] 客户端 `normalizeImageUrl` 保留为防御性兜底
- [ ] 数据库存储仍为 objectKey（未写入完整 URL）

## 自动化

```bash
cd flower-wms-system
npm run test:miniprogram-image-url
npm run test:miniprogram-image-dto
npm run check:miniprogram-image-dto
npm run test:image-url
npm run test:image-url-invariants
npm run build
```

## 微信开发者工具（需人工）

- [ ] 编译通过
- [ ] 真机预览图片加载正常
- [ ] `wx.previewImage`（规格大图预览）地址为完整 URL

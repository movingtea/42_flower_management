# Sprint 22 — CMS 客户端图片 URL 审查验收清单

> 目标：CMS 客户端不得将 OSS objectKey 直接作为 `next/image` / `img` 的 `src`；展示前须经 `CmsImagePreview` 或 `getClientPreviewImageUrl`。

## 环境

- [ ] `.env` / `.env.example` 含 `NEXT_PUBLIC_OSS_PUBLIC_BASE_URL=https://oss.universe42.studio`
- [ ] `.env` / `.env.example` 含 `NEXT_PUBLIC_OSS_OBJECT_PREFIX=universe42`
- [ ] 未将 `ALIYUN_OSS_ACCESS_KEY_*` 暴露到 `NEXT_PUBLIC_*`

## 商品选择器 / Picker

- [ ] 打开 CMS 推荐位或营销配置中的 **ProductPicker**，商品缩略图正常显示
- [ ] ProductPicker 中 objectKey 显示为 `https://oss.universe42.studio/universe42/...`
- [ ] ProductPicker **不再**出现 `https://www.universe42.studio/universe42/...` 错误地址
- [ ] 无主图时显示「暂无主图」占位，布局不挤压文字
- [ ] 图片加载失败时显示占位提示
- [ ] ProductMultiPicker 搜索与选择行为正常（无图片列，仅文字）
- [ ] SkuPicker 下拉正常（无图片列）
- [ ] CmsLinkTargetSelector 内嵌 ProductPicker 图片正常

## 商品编辑与预览

- [ ] 商品编辑页 SKU 卡片图片正常（`ProductSkuEditorCards` + `CmsImagePreview`）
- [ ] 商品小程序预览卡片图片正常（`ProductMiniProgramPreview`）

## Banner / 营销

- [ ] CMS Banner 列表缩略图正常（`BannerManager` + `CmsImagePreview`）
- [ ] Banner 编辑 Drawer 预览图正常
- [ ] 营销弹窗图片预览正常（`MarketingSettings` + `CmsImagePreview`）

## 推荐位 / 首页场景

- [ ] 推荐位商品列表文案与状态正常（推荐项列表当前无缩略图列）
- [ ] 首页场景入口配置正常（如涉及图片字段，须走 `CmsImagePreview`）

## 无效图片

- [ ] 数据库中为 `localhost` 路径的图片显示「图片需要重新上传」或占位
- [ ] 数据库中为 `/uploads/...` 的图片显示重新上传或占位

## 数据与 API 不变

- [ ] 数据库仍保存 objectKey，未写入完整 OSS public URL
- [ ] OSS 上传逻辑未改动
- [ ] 小程序 API / 页面图片展示未被本轮改动

## 自动化

```bash
npm run test:client-image-preview
npm run test:image-url
npm run smoke:cms-product-preview
npm run lint
npm run build
```

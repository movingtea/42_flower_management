# Sprint 17 表单与图片预览验收清单

## Number input

- [ ] 商品 SKU 库存默认 0 可以删除
- [ ] 删除后可以直接输入 11（不会立刻变回 0）
- [ ] SKU 价格可以清空后重新输入小数
- [ ] Banner sortOrder（列表内联 + 编辑弹窗）可清空后重输
- [ ] 推荐位 sortOrder / maxItems 可清空后重输
- [ ] 首页场景入口 sortOrder 可清空后重输
- [ ] 配送设置 dailyOrderLimit 可留空（不限制）
- [ ] 大批量预订阈值 / 提前天数可清空后重输
- [ ] WMS 入库 QuantityStepper 可清空后输入新数量
- [ ] 必填数字为空保存时有错误提示（如 SKU 库存）
- [ ] 移动端数字键盘正常

## 图片预览

- [ ] 商品编辑页「小程序展示预览」OSS 图片正常显示
- [ ] SKU 款式图预览正常（objectKey → public URL）
- [ ] Banner / 营销弹窗 / 推荐位图片预览正常
- [ ] URL 形如 `https://oss.universe42.studio/universe42/...`
- [ ] localhost 图片显示「图片需要重新上传」
- [ ] `/uploads` 图片显示「图片需要重新上传」
- [ ] 网络失败显示「图片加载失败，请重新上传」
- [ ] 保存后数据库仍为 objectKey
- [ ] 小程序 API 返回 OSS public URL（非 localhost）
- [ ] 微信开发者工具可加载图片

## 自动化

```bash
npm run test:number-input
npm run test:client-image-preview
npm run test:image-url
npm run smoke:cms-product-preview
npm run build
```

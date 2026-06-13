# Sprint 18 UI 抛光 — 手工验收清单

## SKU 卡片（商品编辑页）

- [ ] SKU 从「可售」切到「已停用」，Switch 位置不跳动
- [ ] SKU 从「已停用」切到「可售」，Switch 位置不跳动
- [ ] 状态 Badge 与「启用」文字位置稳定
- [ ] 停用说明显示在 Badge + Switch 下方，右对齐
- [ ] 已删除「关闭后，该规格不会在小程序展示…」冗余文案
- [ ] CMS 后台 stock=0 显示「库存为 0」，不显示「卖光啦！」

## 宽表格 sticky

- [ ] 供应商表：左/右冻结列背景不透明，滚动无透视
- [ ] 供应商表：操作按钮横向排列
- [ ] 商品列表（CmsProductsTable）：操作按钮横向排列
- [ ] 商品运营列表（CmsProductsOperationsList）：sticky 正常
- [ ] CRM 客户表：sticky 正常，操作列可见
- [ ] Banner / 推荐位：操作按钮横向排列
- [ ] 采购单列表：操作按钮横向排列（查看/编辑/取消/入库）
- [ ] 物料母表样式未被破坏

```bash
npm run lint
npm run build
```

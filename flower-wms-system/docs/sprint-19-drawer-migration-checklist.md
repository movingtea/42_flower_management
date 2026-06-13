# Sprint 19 — Drawer 迁移手工验收清单

## P0 Drawer

- [ ] 供应商新增 / 编辑从右侧 Drawer 打开
- [ ] 物料新增 / 编辑 / 详情从右侧 Drawer 打开
- [ ] Banner 新增 / 编辑从右侧 Drawer 打开
- [ ] 推荐位新增 / 编辑、添加推荐商品从右侧 Drawer 打开
- [ ] CRM 客户列表「查看详情」从右侧 Drawer 打开
- [ ] 订单详情（看板卡片 / 归档 compact card）从右侧 Drawer 打开
- [ ] SKU「查看损耗模拟」从右侧 Drawer 打开
- [ ] 配方「选择配方 / 更换配方」从右侧 Drawer 打开
- [ ] 采购单详情从右侧 Drawer 打开

## Drawer 交互

- [ ] Drawer 打开时有半透明 mask（`bg-slate-950/30`）遮盖页面
- [ ] mask 后面页面不可点击
- [ ] 重要表单（供应商 / Banner / 推荐位）点击 mask 不关闭
- [ ] 详情类 Drawer 点击 mask 可关闭
- [ ] 保存 / 取消按钮固定在 Drawer 底部
- [ ] Body 滚动时 Footer 不动
- [ ] 关闭 Drawer 不保存未提交数据
- [ ] 保存成功后关闭 Drawer 并刷新列表

## 布局

- [ ] 表单间距比原居中弹窗更紧凑
- [ ] 移动端 Drawer 宽度 100vw
- [ ] 无双重滚动

## 保留为居中确认弹窗（例外）

- [ ] 商品删除确认（CmsProductsTable）
- [ ] 订单发货 / 退款确认（OrdersKanban）
- [ ] 各类 `window.confirm` 停用 / 删除确认

```bash
npm run lint
npm run build
```

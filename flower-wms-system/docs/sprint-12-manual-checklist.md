# Sprint 12 人工验收 Checklist

配合 `docs/business-rules.md` 使用。Round 2 集成完成后逐项勾选。

## 1. 小程序商品展示

- [ ] 正常库存商品可浏览、加购
- [ ] 低库存（1–3）展示低库存提示
- [ ] 售罄（stock=0）展示「卖光啦」，非下架
- [ ] 下架商品不在小程序列表/详情展示

## 2. 购物车

- [ ] 超库存加入被拦截
- [ ] 数量增加超过库存被拦截
- [ ] `INSUFFICIENT_STOCK` 文案为「库存不足」，非「已下架」

## 3. 下单 / 配送

- [ ] 17:00 前可选当天配送
- [ ] 17:00 后不可选今天
- [ ] 配送时段仅 10:00–20:00（上午/下午/傍晚/晚上）
- [ ] CMS 配置的 disabledDates 不可选
- [ ] 大批量提前预订不可选今天
- [ ] 服务端违规下单返回 `INVALID_DELIVERY_DATE` / `DELIVERY_SLOT_UNAVAILABLE`
- [ ] 违规时不创建订单、不扣库存

## 4. 待支付订单

- [ ] 待支付订单显示「请在 MM:SS 内完成支付」
- [ ] 15 分钟后 cron 自动关闭
- [ ] 关闭后 `ProductSku.stock` 回补
- [ ] 用户可主动取消未支付订单
- [ ] 取消后库存回补
- [ ] 超时后显示「订单已超时关闭，请重新下单」，支付按钮隐藏

## 5. 支付 / FIFO

- [ ] Mock 支付成功扣物理库存（Batch）
- [ ] 生成 `SALE_OUT`
- [ ] 生成 `OrderCostSnapshot`

## 6. 退款

- [ ] 已支付退款提示是否回填库存
- [ ] 选择回填 / 不回填分别验证
- [ ] 报表退款单独列示

## 7. CMS Banner

- [ ] 可配置 `startsAt` / `endsAt`
- [ ] 停用 / 软删除 / 未开始 / 已过期不返回小程序
- [ ] 无跳转 Banner 可保存，小程序点击不跳转
- [ ] 图片 URL 不含 localhost

## 8. CMS 推荐位

- [ ] 售罄商品前台不展示，CMS 配置保留
- [ ] CMS 显示不可展示原因
- [ ] 空 slot 小程序不展示模块
- [ ] 不自动补位

## 9. 权限

- [ ] `STORE_ADMIN` 可访问 CMS / 订单 / 报表
- [ ] `WAREHOUSE_MANAGER` 不碰 CMS 营销
- [ ] `FLORIST` 可履约订单
- [ ] `IT_ADMIN` 不访问业务数据 API

## 10. 图片 URL

- [ ] CMS 不保存 localhost
- [ ] 小程序 API 不返回 localhost

## 11. CMS 配送设置

- [ ] `/cms/marketing` →「配送设置」Tab 可修改并保存
- [ ] 保存后 `orders/create` 读取最新配置

## 12. 大批量订单提示

- [ ] 小程序下单页整单数量 ≥5 显示提示，不阻止提交
- [ ] 后台订单详情数量较多时显示提示

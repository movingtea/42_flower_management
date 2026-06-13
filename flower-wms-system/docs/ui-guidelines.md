# 后台 UI 规范（Sprint 16 起）

## 原则

1. **高频信息默认可见** — 价格、库存、状态、主操作始终在主视图。
2. **低频信息默认折叠** — 损耗模拟、建议售价、warning、详细配方说明放入可展开区域。
3. **关键操作始终可见** — 启用开关、删除、编辑不应被挤到竖排或滚出视口。
4. **宽表不丢行上下文** — 带「操作」列的宽表使用 sticky 主识别列 + sticky 操作列。

## SKU 卡片（商品编辑页）

- 每个 SKU 一张卡片，不用宽表格作为主展示。
- 顶部：款式名、状态 badge（可售 / 卖光啦！ / 已停用）、启用开关、删除。
- 中部：固定宽度款式图、价格/库存/配方、毛利摘要（原始成本 + 原始毛利率 + 标准损耗后毛利率）。
- 底部：「查看损耗模拟」折叠按钮、设为主图。
- 启用说明文案固定：「关闭后，该规格不会在小程序展示，也不能被加入购物车或下单。」

## 订单看板 compact card

- 活跃履约列（待处理、制作中、配送中等）：完整订单卡片。
- 「已完成 / 历史归档」列：紧凑卡片，仅订单号、金额、日期（优先配送日）、状态。
- 点击紧凑卡片打开现有 `OrderDetailModal`。
- 归档列默认最多展示最近 20 条，超出显示数量提示。

## 宽表格 sticky 列

组件：`src/components/admin/sticky-table.tsx`

- 左侧冻结主识别列（`STICKY_LEFT_HEAD` / `STICKY_LEFT_CELL`）
- 中间横向滚动（`STICKY_SCROLL_HEAD` / `STICKY_SCROLL_CELL`）
- 右侧冻结操作列（`STICKY_RIGHT_HEAD` / `STICKY_RIGHT_CELL`）
- 容器：`StickyTableScroll`，配合 `colgroup` 固定首尾列宽
- 行使用 `group` class，sticky 单元格 hover 背景与行同步

### 主识别列映射

| 页面 | 左冻结列 |
|------|----------|
| 供应商管理 | 供应商名称 |
| 物料母表 | 花名 |
| 商品列表 | 品名 |
| 采购单列表 | 采购单号 |
| 包装方案 | 名称 |
| CMS Banner | 海报 |
| CMS 推荐位 | 名称 |

## 移动端

- SKU 卡片使用响应式 grid，小屏单列堆叠。
- 宽表允许横向滚动；sticky 列在小屏仍保持可见。
- 看板列宽使用 `min(100%, 17.5rem)`，紧凑卡片保持可点区域。

## 数字输入（Sprint 17 起）

组件：`src/components/ui/NumberInput.tsx`

- **NumberInput**：受控 `number | null`；内部 `draft` 字符串；输入阶段允许空值。
- **DecimalStringInput / IntegerStringInput**：表单字段存 `string`（如 price、bulkOrderThreshold）。
- **禁止** `onChange={(e) => setValue(Number(e.target.value))}` — 空字符串会变成 `0`。
- 整数 / 库存 / 排序：`integerOnly` + `min={0}`；金额：`DecimalStringInput` 或 `allowDecimal`。
- 可选字段：`allowEmpty` + 保存时 `value ?? null`；必填字段 submit 时校验。
- 表格内联保存：`commitOnBlur` 仅在 blur 时通知父组件。

## 图片字段存储与展示（Sprint 17 起）

| 层 | 规则 |
|----|------|
| 数据库 | 存 OSS **objectKey**（如 `universe42/products/sku/...webp`） |
| CMS 客户端预览 | `getClientPreviewImageUrl(stored)` → `https://oss.universe42.studio/...` |
| 服务端 API | `toPublicImageUrl` / `imageUrlFormatter` |
| 无效 | `localhost`、`/uploads`（`ENABLE_LEGACY_UPLOADS=false`）→ 提示重新上传 |

- 组件：`CmsImagePreview` 统一占位、onError fallback。
- 前端 env：`NEXT_PUBLIC_OSS_PUBLIC_BASE_URL`（**不要**暴露 AccessKey）。
- 保存：`normalizeStoredImagePath` 将 public URL 还原为 objectKey；拒绝 localhost。

### CMS 预览异常排查

1. 确认 `.env` 中 `NEXT_PUBLIC_OSS_PUBLIC_BASE_URL=https://oss.universe42.studio`。
2. 数据库字段应为 objectKey，不是完整 URL。
3. 若仍显示「图片需要重新上传」，字段可能是旧 `/uploads` 或 localhost 路径。
4. 小程序卡片预览见 `ProductMiniProgramPreview` + `CmsImagePreview`。

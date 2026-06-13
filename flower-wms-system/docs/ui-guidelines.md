# 后台 UI 规范（Sprint 16 起）

## 原则

1. **高频信息默认可见** — 价格、库存、状态、主操作始终在主视图。
2. **低频信息默认折叠** — 损耗模拟、建议售价、warning、详细配方说明放入可展开区域。
3. **关键操作始终可见** — 启用开关、删除、编辑不应被挤到竖排或滚出视口。
4. **宽表不丢行上下文** — 带「操作」列的宽表使用 sticky 主识别列 + sticky 操作列。
5. **新增 / 编辑 / 详情 / 配置统一右侧 Drawer** — 见下文；简单危险确认可保留居中 AlertDialog。

## 后台 Drawer（Sprint 19 起）

组件：`src/components/admin/AdminDrawer.tsx` · Footer：`DrawerFooterActions`

- 新增 / 编辑 / 详情 / 配置类操作使用**右侧 Drawer**，不再新增居中业务 Modal。
- 结构：Header（标题 + 关闭）/ Body（`flex-1 overflow-y-auto`）/ Footer（固定底部 action）。
- mask：`bg-slate-950/30 backdrop-blur-[1px]`，阻止底层点击；Drawer 打开时 `body` 禁止滚动。
- `closeOnOverlayClick`：重要表单 `false`；详情 / 只读 `true`。
- Footer：取消在左、保存在右；危险操作放 footer 左侧。
- 尺寸：`sm` 360 / `md` 480 / `lg` 640 / `xl` 760 / `full` min(960px, 100vw)；移动端 100vw。
- 表单布局紧凑：`space-y-3`、`grid-cols-2` 短字段；长说明折叠或弱化。

### 保留居中确认弹窗的例外

- 删除 / 危险二次确认（一句话 + 两按钮）
- 订单发货 / 退款等极简确认
- toast、下拉、日期选择、combobox popover

## SKU 卡片（商品编辑页）

- 每个 SKU 一张卡片，不用宽表格作为主展示。
- **右上角状态区布局固定**（`min-w-[240px]`）：第一行 Badge + Switch +「启用」；第二行说明文案或等高占位，避免切换 isActive 时跳动。
- 状态 Badge：可售 / 库存为 0 / 已停用 / 未保存（**不得**使用「卖光啦！」）。
- 停用说明（仅 inactive）：「该规格已停用，即使有库存也不会在小程序售卖」— 显示在状态区第二行，右对齐。
- stock=0 已保存 SKU：第二行可显示「小程序前台将显示售罄」。
- **不要**在卡片底部重复「关闭后，该规格不会在小程序展示…」类说明。
- 中部：款式图/商品图、价格/库存/配方、毛利摘要。
- 底部：「查看损耗模拟」（**右侧 Drawer**）、设为主图。

## 宽表格 sticky 列

组件：`src/components/admin/sticky-table.tsx`

- 左侧冻结主识别列（`STICKY_LEFT_HEAD` / `STICKY_LEFT_CELL`）
- 中间横向滚动（`STICKY_SCROLL_HEAD` / `STICKY_SCROLL_CELL`）
- 右侧冻结操作列（`STICKY_RIGHT_HEAD` / `STICKY_RIGHT_CELL`）
- 行：`STICKY_TABLE_ROW`（`group bg-white hover:bg-zinc-50`）
- 操作列按钮：`STICKY_ACTIONS`（`flex row items-center gap-2 whitespace-nowrap`）
- **sticky 列必须使用不透明背景**（`bg-white` / `bg-zinc-50`）；hover 使用实心 `group-hover:bg-zinc-50`，禁止 `/80` 半透明
- 阴影：`shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)]`（左）/ 负向（右）
- 选中行：sticky 单元格加 `!bg-rose-50` 与行背景同步
- 容器：`StickyTableScroll`，配合 `colgroup` 固定首尾列宽（物料母表）

### 主识别列映射

| 页面 | 左冻结列 |
|------|----------|
| 供应商管理 | 供应商名称 |
| 物料母表 | 花名 |
| 商品列表 | 品名 |
| 采购单列表 | 采购单号 |
| 包装方案 | 名称 |
| CMS Banner | 轮播图 |
| CMS 推荐位 | 名称 |
| CRM 客户列表 | 客户姓名 |
| 商品运营列表 | 品名 |

## 订单看板 compact card

- 活跃履约列：完整订单卡片。
- 「已完成 / 历史归档」列：紧凑卡片（订单号、金额、日期、状态）。
- 点击紧凑卡片打开 `OrderDetailModal`；归档列默认最多 20 条。

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

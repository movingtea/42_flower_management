# 花材接力 · Flower Relay

花艺样品拆解复用规划工具。系统根据候选样品的花材需求、采购价格和拆解损耗，计算采购成本最低的样品组合与制作顺序。

## 技术栈

- Next.js 16（App Router）
- TypeScript
- Prisma 6 + SQLite
- React 19

## 本地启动

```bash
npm install
npx prisma generate
npm run db:push
npm run db:seed
npm run dev
```

打开 <http://localhost:3000>。

## 已实现

- Prisma 花材、样品和样品花材关系模型
- 示例数据初始化
- 新建和编辑花材（分类、单位、单价、损耗率）
- 新建和编辑样品及其多行花材用量
- 服务端输入校验、Prisma 事务写入和保存后即时刷新
- 候选样品选择与制作数量设置
- 样品组合及制作顺序穷举优化
- 拆解损耗、复用数量、补购数量和成本模拟
- 前五个候选方案及逐步花材流转明细
- 样品库、花材库和响应式工作台界面

## 常用命令

```bash
npm run lint
npm run build
npm run db:studio
```

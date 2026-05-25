export type KanbanOrderItem = {
  label: string;
  quantity: number;
};

export type KanbanBomMaterial = {
  chineseName: string;
  englishName: string;
  quantityNeeded: number;
  maintenance: string | null;
};

export type ArchiveCardVariant =
  | "completed"
  | "customer_cancel"
  | "admin_close"
  | "refund_cancel";

export type KanbanColumnDef = {
  id: string;
  title: string;
  status: string;
  accentClass: string;
  badgeClass: string;
  isArchive?: boolean;
  allowDragOut?: boolean;
};

export type KanbanOrder = {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  deliveryDate: string;
  greetingCard: string | null;
  deliveryInfo: string | null;
  payAmount: string;
  refundAmount: number | null;
  cancelSource: string | null;
  createdAt: string;
  items: KanbanOrderItem[];
  bomMaterials?: KanbanBomMaterial[];
};

export type DragPayload = {
  orderId: string;
  fromColumnId: string;
};

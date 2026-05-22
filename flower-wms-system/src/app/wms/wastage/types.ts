/** 服务端序列化后传给客户端的批次行 */
export type WastageBatchRow = {
  id: string;
  batchNo: string | null;
  remainingQty: number;
  expiresAt: string | null;
  productName: string;
  productUnit: string;
  isExpiringSoon: boolean;
};

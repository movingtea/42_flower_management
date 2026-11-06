export type BatchStockInput = {
  onHandQty: number;
  frozenQty: number;
  reservedQty: number;
};

export function summarizeBatchStock(rows: readonly BatchStockInput[]) {
  return rows.reduce<{ onHandQty: number; frozenQty: number; reservedQty: number; availableQty: number }>((total, row) => {
    const onHand = Math.max(0, row.onHandQty);
    const frozen = Math.max(0, row.frozenQty);
    const reserved = Math.max(0, row.reservedQty);
    return {
      onHandQty: total.onHandQty + onHand,
      frozenQty: total.frozenQty + frozen,
      reservedQty: total.reservedQty + reserved,
      availableQty: total.availableQty + Math.max(0, onHand - frozen - reserved),
    };
  }, { onHandQty: 0, frozenQty: 0, reservedQty: 0, availableQty: 0 });
}

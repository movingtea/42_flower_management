/** 礼赠文案辅助 — 商品详情与下单页复用 */

export function buildOccasionSummary(labels: string[]): string {
  if (!labels.length) return '';
  const text = labels.slice(0, 4).join('、');
  return `适合${text}。`;
}

export function buildRelationshipSummary(labels: string[]): string {
  if (!labels.length) return '';
  const text = labels.slice(0, 4).join('、');
  return `适合送给${text}。`;
}

export function buildStoryText(sellingPoints: string[]): string {
  if (sellingPoints.length) {
    return sellingPoints.slice(0, 2).join(' ');
  }
  return '这束花适合表达温柔、认真和一点点浪漫。';
}

export const FLOWER_ADJUSTMENT_NOTE =
  '鲜花会因季节和到货状态略有调整，我们会保持整体色系、风格和价值感一致。';

export const DELIVERY_NOTES = {
  sameDay: '当日配送需根据花材和运力确认。',
  peakSeason: '节日前后订单较多，建议提前预订。',
  specialTime: '该时间段可能需要客服确认。',
} as const;

/** 根据配送日期与时段返回提示文案 */
export function getDeliveryHints(
  deliveryDate: string,
  timeBucket: string
): string[] {
  const hints: string[] = [];
  if (!deliveryDate) return hints;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  if (deliveryDate === todayStr) {
    hints.push(DELIVERY_NOTES.sameDay);
  }

  const monthDay = deliveryDate.slice(5);
  const peakDates = ['02-14', '03-08', '05-11', '05-20', '08-22', '12-25'];
  if (peakDates.includes(monthDay)) {
    hints.push(DELIVERY_NOTES.peakSeason);
  }

  if (timeBucket === '傍晚' || timeBucket === '晚上') {
    hints.push(DELIVERY_NOTES.specialTime);
  }

  return hints;
}

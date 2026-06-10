export const RELATION_OPTIONS = [
  { key: 'SELF', label: '本人' },
  { key: 'PARTNER', label: '伴侣' },
  { key: 'MOTHER', label: '母亲' },
  { key: 'FATHER', label: '父亲' },
  { key: 'FAMILY', label: '家人' },
  { key: 'FRIEND', label: '朋友' },
  { key: 'COLLEAGUE', label: '同事' },
  { key: 'CLIENT', label: '客户' },
  { key: 'TEACHER', label: '老师' },
  { key: 'OTHER', label: '其他' },
] as const;

export const OCCASION_OPTIONS = [
  { key: 'BIRTHDAY', label: '生日' },
  { key: 'ANNIVERSARY', label: '纪念日' },
  { key: 'VISIT', label: '探望' },
  { key: 'APOLOGY', label: '道歉' },
  { key: 'BUSINESS', label: '商务' },
  { key: 'OPENING', label: '开业' },
  { key: 'DAILY_SURPRISE', label: '日常惊喜' },
  { key: 'OTHER', label: '其他' },
] as const;

export function relationLabelByKey(key: string): string {
  return RELATION_OPTIONS.find((item) => item.key === key)?.label ?? key;
}

export function occasionLabelByKey(key: string): string {
  return OCCASION_OPTIONS.find((item) => item.key === key)?.label ?? key;
}

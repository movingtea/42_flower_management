/** 与后端 WechatUserProfile 对齐 */
export interface WechatUserProfile {
  id: string;
  openId: string;
  nickName: string | null;
  avatarUrl: string | null;
  defaultReceiverName: string | null;
  defaultReceiverPhone: string | null;
  defaultAddress: string | null;
}

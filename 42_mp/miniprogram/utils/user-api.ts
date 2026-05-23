import { request } from './request';
import type { WechatUserProfile } from './user';

export function fetchUserProfile() {
  return request<{ user: WechatUserProfile }>({
    url: '/user/profile',
    method: 'GET',
  });
}

export function patchUserProfile(
  patch: Partial<
    Pick<
      WechatUserProfile,
      | 'nickName'
      | 'avatarUrl'
      | 'defaultReceiverName'
      | 'defaultReceiverPhone'
      | 'defaultAddress'
    >
  >
) {
  return request<{ message: string; user: WechatUserProfile }>({
    url: '/user/profile',
    method: 'PATCH',
    data: patch,
  });
}

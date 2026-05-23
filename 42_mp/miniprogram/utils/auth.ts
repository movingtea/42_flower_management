import type { WechatUserProfile } from './user';

const TOKEN_KEY = 'token';
const OPEN_ID_KEY = 'openId';
const USER_KEY = 'userProfile';

export function getToken(): string {
  try {
    const v = wx.getStorageSync(TOKEN_KEY);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  wx.setStorageSync(TOKEN_KEY, token);
}

export function getOpenId(): string {
  try {
    const v = wx.getStorageSync(OPEN_ID_KEY);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

export function setOpenId(openId: string): void {
  wx.setStorageSync(OPEN_ID_KEY, openId);
}

export function getStoredUser(): WechatUserProfile | null {
  try {
    const raw = wx.getStorageSync(USER_KEY);
    if (!raw || typeof raw !== 'object') return null;
    return raw as WechatUserProfile;
  } catch {
    return null;
  }
}

export function setStoredUser(user: WechatUserProfile): void {
  wx.setStorageSync(USER_KEY, user);
}

export function clearAuthStorage(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(OPEN_ID_KEY);
  wx.removeStorageSync(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken() && !!getOpenId();
}

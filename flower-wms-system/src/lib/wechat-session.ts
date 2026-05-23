export type WechatCode2SessionResult = {
  openId: string;
  sessionKey?: string;
  unionId?: string;
};

type WechatCode2SessionResponse = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

/** 使用 wx.login 的 code 换取 openId（jscode2session） */
export async function exchangeCodeForOpenId(
  code: string
): Promise<WechatCode2SessionResult> {
  const appId = process.env.WECHAT_MINI_APP_ID?.trim();
  const appSecret = process.env.WECHAT_MINI_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new Error("微信小程序 AppId / AppSecret 未配置");
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`微信登录接口请求失败: HTTP ${res.status}`);
  }

  const data = (await res.json()) as WechatCode2SessionResponse;

  if (data.errcode) {
    throw new Error(data.errmsg || `微信登录失败（${data.errcode}）`);
  }

  if (!data.openid) {
    throw new Error("微信未返回 openId");
  }

  return {
    openId: data.openid,
    sessionKey: data.session_key,
    unionId: data.unionid,
  };
}

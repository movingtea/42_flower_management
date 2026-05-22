import { NextResponse } from 'next/server';

export const dynamic = "force-dynamic"; // 严格遵循防缓存规范

// 💡 必须是全大写的 POST 函数！
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code } = body;

    if (!code) {
      return NextResponse.json({ success: false, error: 'Code is required' }, { status: 400 });
    }

    // 这里是你的微信 auth.code2Session 换取 OpenID 逻辑...
    // 假装返回成功
    return NextResponse.json({ 
      success: true, 
      token: 'mock-jwt-token-xyz',
      userInfo: { name: '微信用户' }
    });

  } catch (error) {
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
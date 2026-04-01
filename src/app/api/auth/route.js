import { NextResponse } from 'next/server'
import { getUser, initUsers } from '@/lib/kv'
import { signToken } from '@/lib/auth'

export async function POST(req) {
  try {
    await initUsers()
    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: '请填写邮箱和密码' }, { status: 400 })
    }

    const user = await getUser(email)
    if (!user || user.password !== password) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 })
    }

    const token = await signToken({
      email: user.email,
      role: user.role,
      name: user.name,
    })

    const res = NextResponse.json({
      email: user.email,
      role: user.role,
      name: user.name,
    })

    res.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })

    return res
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('token')
  return res
}

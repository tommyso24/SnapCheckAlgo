import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-change-me')

export async function signToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET)
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload
  } catch {
    return null
  }
}

export async function getSession() {
  const cookieStore = cookies()
  const token = cookieStore.get('token')?.value
  if (!token) return null
  return await verifyToken(token)
}

export async function requireSession() {
  const session = await getSession()
  if (!session) {
    return { error: 'Unauthorized', status: 401 }
  }
  return { session }
}

export async function requireAdmin() {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized', status: 401 }
  if (session.role !== 'admin') return { error: 'Forbidden', status: 403 }
  return { session }
}

import { timingSafeEqual } from 'crypto'

// Autentica as rotas chamadas pelo worker local (processo Python, sem
// cookie de sessão de navegador) -- NUNCA a senha única de login do app.
// Falha de forma segura (devolve false, nunca lança) quando
// MESH_WORKER_SECRET não está configurada, pra uma rota esquecer de
// tratar a exceção nunca significar "deixar passar sem auth".
export function verifyWorkerAuth(request: Request): boolean {
  const secret = process.env.MESH_WORKER_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const headerBuf = Buffer.from(header)
  const expectedBuf = Buffer.from(expected)
  if (headerBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(headerBuf, expectedBuf)
}

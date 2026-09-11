// Cliente mínimo do login da Bambu Cloud (engenharia reversa da comunidade,
// não documentado oficialmente -- ver spec §4). Só usado uma vez, na tela
// de Configurações, pra obter o token que o listener usa depois.
//
// Fluxo real (sem "ticket" -- o e-mail é o próprio correlator entre as
// chamadas): 1) login com account+password; se a Bambu exigir verificação
// devolve { success: false, loginType: 'verifyCode' } (sem accessToken);
// 2) dispara o e-mail com o código via /sendemail/code; 3) login de novo,
// agora com account+code em vez de senha, devolve accessToken.
const BAMBU_LOGIN_URL = 'https://api.bambulab.com/v1/user-service/user/login'
const BAMBU_SEND_CODE_URL = 'https://api.bambulab.com/v1/user-service/user/sendemail/code'

export type LoginStep1Result = { status: 'code_required' } | { status: 'authenticated'; accessToken: string }

export async function requestLoginCode(email: string, password: string): Promise<LoginStep1Result> {
  const loginRes = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: email, password, apiError: '' }),
  })
  if (!loginRes.ok) throw new Error('Falha ao solicitar código de login da Bambu')
  const loginData = (await loginRes.json()) as { accessToken?: string; loginType?: string }

  // Algumas contas (sem verificação extra habilitada) já autenticam de
  // primeira -- não presume que sempre precisa do código por e-mail.
  if (loginData.accessToken) return { status: 'authenticated', accessToken: loginData.accessToken }
  if (loginData.loginType !== 'verifyCode') throw new Error('Bambu recusou o login — confira e-mail e senha')

  const codeRes = await fetch(BAMBU_SEND_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, type: 'codeLogin' }),
  })
  if (!codeRes.ok) throw new Error('Falha ao enviar o código de verificação por e-mail')
  return { status: 'code_required' }
}

export async function confirmLoginCode(email: string, code: string): Promise<{ accessToken: string }> {
  const res = await fetch(BAMBU_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: email, code }),
  })
  if (!res.ok) throw new Error('Falha ao confirmar código de login da Bambu')
  const data = (await res.json()) as { accessToken?: string }
  if (!data.accessToken) throw new Error('Código inválido ou expirado')
  return { accessToken: data.accessToken }
}

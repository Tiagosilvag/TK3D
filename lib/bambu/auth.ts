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
const BAMBU_PREFERENCE_URL = 'https://api.bambulab.com/v1/design-user-service/my/preference'
const BAMBU_BIND_URL = 'https://api.bambulab.com/v1/iot-service/api/user/bind'

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

// O username do broker MQTT da nuvem é "u_{uid}" (id numérico da conta),
// nunca o e-mail -- só descoberto depois de autenticado.
export async function fetchUserId(accessToken: string): Promise<string> {
  const res = await fetch(BAMBU_PREFERENCE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Falha ao obter o id da conta Bambu')
  const data = (await res.json()) as { uid?: number | string }
  if (data.uid === undefined || data.uid === null) throw new Error('Bambu não retornou o id da conta')
  return String(data.uid)
}

export type BambuDevice = { devId: string; name: string; productName: string; online: boolean }

// Lista as impressoras vinculadas à conta -- usado pra deixar escolher o
// número de série numa lista em vez de caçar no app/Studio (o serial em
// si não fica visível de forma óbvia em nenhum dos dois).
export async function fetchBoundDevices(accessToken: string): Promise<BambuDevice[]> {
  const res = await fetch(BAMBU_BIND_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Falha ao buscar impressoras da conta Bambu')
  const data = (await res.json()) as {
    devices?: { dev_id?: string; name?: string; dev_product_name?: string; online?: boolean }[]
  }
  return (data.devices ?? [])
    .filter((d): d is typeof d & { dev_id: string } => Boolean(d.dev_id))
    .map((d) => ({
      devId: d.dev_id,
      name: d.name ?? d.dev_id,
      productName: d.dev_product_name ?? '',
      online: Boolean(d.online),
    }))
}

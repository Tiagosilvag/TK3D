export async function register() {
  // Só roda no runtime Node do servidor (nunca no Edge nem no browser) --
  // o listener MQTT precisa de módulos nativos do Node (crypto, sockets).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Rede de segurança (visto em produção, 2026-09-12): a lib `mqtt` pode
  // disparar "Error: connack timeout" como exceção não tratada (fora do
  // pipeline normal de eventos do client) quando um reconnect insistente
  // deixa um timer velho sobrando -- sem isso, essa exceção derruba o
  // processo Node INTEIRO (não só o listener MQTT, o app inteiro cai e o
  // container reinicia). A causa raiz (reconectar pra sempre com
  // credencial rejeitada) já foi corrigida nos listeners (client.end() em
  // vez de deixar o reconnectPeriod insistir), mas mantém esse guard
  // estreito -- só pra essa mensagem específica -- como segunda camada,
  // sem mascarar nenhum outro tipo de erro não tratado.
  process.on('uncaughtException', (err) => {
    if (err.message === 'connack timeout') {
      console.error('[mqtt] connack timeout suprimido (rede de segurança, ver instrumentation.ts)')
      return
    }
    // Relançar aqui dentro não é seguro (pode virar loop) -- o jeito certo
    // documentado pelo Node é logar e derrubar o processo explicitamente,
    // preservando o comportamento padrão pra qualquer erro que não seja
    // esse caso específico já tratado acima.
    console.error('Exceção não tratada, encerrando processo:', err)
    process.exit(1)
  })
  const { startBambuListener } = await import('@/lib/bambu/listener')
  await startBambuListener().catch((err) => {
    console.error('[bambu] falha ao iniciar o listener MQTT:', err)
  })
  const { startAnycubicListener } = await import('@/lib/anycubic/listener')
  await startAnycubicListener().catch((err) => {
    console.error('[anycubic] falha ao iniciar o listener MQTT:', err)
  })
}

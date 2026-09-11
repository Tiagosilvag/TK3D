export async function register() {
  // Só roda no runtime Node do servidor (nunca no Edge nem no browser) --
  // o listener MQTT precisa de módulos nativos do Node (crypto, sockets).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startBambuListener } = await import('@/lib/bambu/listener')
  await startBambuListener().catch((err) => {
    console.error('[bambu] falha ao iniciar o listener MQTT:', err)
  })
}

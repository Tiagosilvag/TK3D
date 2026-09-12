// Comandos de controle de impressão via MQTT publish (device/{serial}/request).
// Puro -- só monta o payload, quem publica de verdade é lib/bambu/listener.ts.
export type BambuCommand = { print: { command: string } }

export function buildPauseCommand(): BambuCommand {
  return { print: { command: 'pause' } }
}

export function buildResumeCommand(): BambuCommand {
  return { print: { command: 'resume' } }
}

export function buildStopCommand(): BambuCommand {
  return { print: { command: 'stop' } }
}

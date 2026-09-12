export type BambuAmsTray = {
  id: string
  type: string
  color: string
  remainPercent: number
  tagUid: string | null
}

export type BambuStatus = {
  gcodeState: string
  percent: number | null
  remainingMinutes: number | null
  layerNum: number | null
  totalLayerNum: number | null
  gcodeFile: string | null
  nozzleTemp: number | null
  bedTemp: number | null
  amsTrays: BambuAmsTray[]
  // Ajuste "extrair mais dados" (2026-09-12): campos extras já presentes no
  // mesmo report MQTT, antes ignorados -- só leitura, sem custo de protocolo
  // novo. Todos opcionais/defensivos: impressora sem AMS, sem HMS ativo etc.
  // simplesmente não manda o campo, nunca vira erro de parse.
  chamberTemp: number | null
  nozzleTargetTemp: number | null
  bedTargetTemp: number | null
  speedLevel: number | null
  fanSpeeds: { heatbreak: number | null; cooling: number | null; big1: number | null; big2: number | null }
  wifiSignal: string | null
  gcodeFilePreparePercent: number | null
  nozzleDiameter: string | null
  nozzleType: string | null
  hmsCodes: string[]
  printErrorCode: string | null
  firmwareVersion: string | null
  upgradeState: string | null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

// HMS/print_error vêm como inteiro decimal -- a Bambu documenta o código de
// verdade como a representação hexadecimal, com 8 dígitos preenchidos com
// zero à esquerda (ex.: attr 50336256 -> "03001200").
function toHexCode(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

// Formato do report MQTT da Bambu (bloco "print" de device/{serial}/report),
// documentado pela comunidade (OpenBambuAPI) — impressora sem AMS
// simplesmente não manda o bloco `ams`, por isso amsTrays vem vazio nesse
// caso em vez de erro.
export function parseBambuReport(raw: unknown): BambuStatus | null {
  if (typeof raw !== 'object' || raw === null) return null
  const print = (raw as Record<string, unknown>).print
  if (typeof print !== 'object' || print === null) return null
  const p = print as Record<string, unknown>

  const gcodeState = str(p.gcode_state)
  if (!gcodeState) return null

  const amsTrays: BambuAmsTray[] = []
  const ams = p.ams as { ams?: { tray?: unknown[] }[] } | undefined
  for (const unit of ams?.ams ?? []) {
    for (const tray of unit.tray ?? []) {
      const t = tray as Record<string, unknown>
      const id = str(t.id)
      const remain = num(t.remain)
      if (id === null || remain === null) continue
      amsTrays.push({
        id,
        type: str(t.tray_type) ?? '',
        color: str(t.tray_color) ?? '',
        remainPercent: remain,
        tagUid: str(t.tag_uid),
      })
    }
  }

  const hmsCodes: string[] = []
  if (Array.isArray(p.hms)) {
    for (const entry of p.hms) {
      const e = entry as Record<string, unknown>
      const attr = num(e.attr)
      const code = num(e.code)
      if (attr === null || code === null) continue
      hmsCodes.push(toHexCode(attr) + toHexCode(code))
    }
  }
  const printErrorNum = num(p.print_error)
  const printErrorCode = printErrorNum !== null && printErrorNum !== 0 ? toHexCode(printErrorNum) : null

  const upgrade = p.upgrade_state
  const upgradeObj = typeof upgrade === 'object' && upgrade !== null ? (upgrade as Record<string, unknown>) : null

  return {
    gcodeState,
    percent: num(p.mc_percent),
    remainingMinutes: num(p.mc_remaining_time),
    layerNum: num(p.layer_num),
    totalLayerNum: num(p.total_layer_num),
    gcodeFile: str(p.gcode_file),
    nozzleTemp: num(p.nozzle_temper),
    bedTemp: num(p.bed_temper),
    amsTrays,
    chamberTemp: num(p.chamber_temper),
    nozzleTargetTemp: num(p.nozzle_target_temper),
    bedTargetTemp: num(p.bed_target_temper),
    speedLevel: num(p.spd_lvl),
    fanSpeeds: {
      heatbreak: num(p.heatbreak_fan_speed),
      cooling: num(p.cooling_fan_speed),
      big1: num(p.big_fan1_speed),
      big2: num(p.big_fan2_speed),
    },
    wifiSignal: str(p.wifi_signal),
    gcodeFilePreparePercent: num(p.gcode_file_prepare_percent),
    nozzleDiameter: str(p.nozzle_diameter),
    nozzleType: str(p.nozzle_type),
    hmsCodes,
    printErrorCode,
    // upgrade_state/versão nem sempre vem no report incremental -- só quando
    // a impressora manda um dump completo (ver listener.ts, pedido "pushall"
    // ao conectar). Fica null nos ticks incrementais que não incluem isso,
    // por design -- não é erro de parse.
    firmwareVersion: upgradeObj ? str(upgradeObj.current_ver ?? upgradeObj.new_version) : null,
    upgradeState: upgradeObj ? str(upgradeObj.status ?? upgradeObj.progress) : null,
  }
}

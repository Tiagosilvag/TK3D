export type BambuAmsTray = {
  id: string
  type: string
  color: string
  remainPercent: number
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
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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
      amsTrays.push({ id, type: str(t.tray_type) ?? '', color: str(t.tray_color) ?? '', remainPercent: remain })
    }
  }

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
  }
}

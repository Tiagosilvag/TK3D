import { describe, it, expect } from 'vitest'
import { parseBambuReport } from '@/lib/bambu/parser'

const baseReport = {
  print: {
    gcode_state: 'RUNNING',
    mc_percent: 42,
    mc_remaining_time: 30,
    layer_num: 10,
    total_layer_num: 50,
    gcode_file: 'peça.3mf',
    nozzle_temper: 220,
    bed_temper: 60,
  },
}

describe('parseBambuReport', () => {
  it('extrai os campos principais de um report em RUNNING', () => {
    const status = parseBambuReport(baseReport)
    expect(status).toEqual({
      gcodeState: 'RUNNING',
      percent: 42,
      remainingMinutes: 30,
      layerNum: 10,
      totalLayerNum: 50,
      gcodeFile: 'peça.3mf',
      nozzleTemp: 220,
      bedTemp: 60,
      amsTrays: [],
    })
  })

  it('extrai bandejas do AMS quando presentes', () => {
    const withAms = {
      print: {
        ...baseReport.print,
        ams: { ams: [{ tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FF0000FF', remain: 80 }] }] },
      },
    }
    const status = parseBambuReport(withAms)
    expect(status?.amsTrays).toEqual([{ id: '0', type: 'PLA', color: 'FF0000FF', remainPercent: 80 }])
  })

  it('retorna null para payload sem o bloco print', () => {
    expect(parseBambuReport({ system: {} })).toBeNull()
  })

  it('retorna null para payload não-objeto', () => {
    expect(parseBambuReport('lixo')).toBeNull()
    expect(parseBambuReport(null)).toBeNull()
  })
})

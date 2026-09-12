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

const emptyExtras = {
  chamberTemp: null,
  nozzleTargetTemp: null,
  bedTargetTemp: null,
  speedLevel: null,
  fanSpeeds: { heatbreak: null, cooling: null, big1: null, big2: null },
  wifiSignal: null,
  gcodeFilePreparePercent: null,
  nozzleDiameter: null,
  nozzleType: null,
  hmsCodes: [],
  printErrorCode: null,
  firmwareVersion: null,
  upgradeState: null,
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
      ...emptyExtras,
    })
  })

  it('extrai bandejas do AMS quando presentes, inclusive tag_uid do RFID', () => {
    const withAms = {
      print: {
        ...baseReport.print,
        ams: { ams: [{ tray: [{ id: '0', tray_type: 'PLA', tray_color: 'FF0000FF', remain: 80, tag_uid: 'ABC123' }] }] },
      },
    }
    const status = parseBambuReport(withAms)
    expect(status?.amsTrays).toEqual([{ id: '0', type: 'PLA', color: 'FF0000FF', remainPercent: 80, tagUid: 'ABC123' }])
  })

  it('retorna null para payload sem o bloco print', () => {
    expect(parseBambuReport({ system: {} })).toBeNull()
  })

  it('retorna null para payload não-objeto', () => {
    expect(parseBambuReport('lixo')).toBeNull()
    expect(parseBambuReport(null)).toBeNull()
  })

  it('extrai temperaturas alvo, câmara, velocidade, ventoinhas e wifi (campos string viram número)', () => {
    const status = parseBambuReport({
      print: {
        ...baseReport.print,
        chamber_temper: 35,
        nozzle_target_temper: 230,
        bed_target_temper: 65,
        spd_lvl: 2,
        heatbreak_fan_speed: '50',
        cooling_fan_speed: '100',
        big_fan1_speed: '0',
        big_fan2_speed: '0',
        wifi_signal: '-60dBm',
        gcode_file_prepare_percent: '100',
        nozzle_diameter: '0.4',
        nozzle_type: 'hardened_steel',
      },
    })
    expect(status).toMatchObject({
      chamberTemp: 35,
      nozzleTargetTemp: 230,
      bedTargetTemp: 65,
      speedLevel: 2,
      fanSpeeds: { heatbreak: 50, cooling: 100, big1: 0, big2: 0 },
      wifiSignal: '-60dBm',
      gcodeFilePreparePercent: 100,
      nozzleDiameter: '0.4',
      nozzleType: 'hardened_steel',
    })
  })

  it('converte hms e print_error pra código hex de 8 dígitos, print_error=0 vira null', () => {
    const status = parseBambuReport({
      print: {
        ...baseReport.print,
        hms: [{ attr: 50336256, code: 131073 }],
        print_error: 0,
      },
    })
    expect(status?.hmsCodes).toEqual(['0300120000020001'])
    expect(status?.printErrorCode).toBeNull()
  })

  it('print_error diferente de zero vira código hex', () => {
    const status = parseBambuReport({ print: { ...baseReport.print, print_error: 83935248 } })
    expect(status?.printErrorCode).toBe('0500c010')
  })

  it('firmwareVersion/upgradeState ficam null quando upgrade_state não vem no report (tick incremental normal)', () => {
    const status = parseBambuReport(baseReport)
    expect(status?.firmwareVersion).toBeNull()
    expect(status?.upgradeState).toBeNull()
  })
})

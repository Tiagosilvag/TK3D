'use server'
// Fronteira 'use server' fina sobre lib/productUnitTrail.ts -- a lógica de
// derivação em si não precisa ser uma server action (não escreve nada),
// só fica aqui pra VariantsModal.tsx (client component) poder chamar sob
// demanda (mesmo padrão lazy de getAssemblyStatus/getOrderablePartOptions).
import {
  getProductUnitTrail,
  getDeliveryDrillDown,
  getConsignmentSaleDrillDown,
  getDirectSaleDrillDown,
  type ProductUnitTrailResult,
  type DeliveryDrillDown,
  type ConsignmentSaleDrillDown,
  type DirectSaleDrillDown,
} from '@/lib/productUnitTrail'

export type { ProductUnitTrailResult, DeliveryDrillDown, ConsignmentSaleDrillDown, DirectSaleDrillDown }

export async function fetchProductUnitTrail(productId: string): Promise<ProductUnitTrailResult> {
  return getProductUnitTrail(productId)
}

export async function fetchDeliveryDrillDown(deliveryId: string): Promise<DeliveryDrillDown | null> {
  return getDeliveryDrillDown(deliveryId)
}

export async function fetchConsignmentSaleDrillDown(saleReportId: string): Promise<ConsignmentSaleDrillDown | null> {
  return getConsignmentSaleDrillDown(saleReportId)
}

export async function fetchDirectSaleDrillDown(saleId: string): Promise<DirectSaleDrillDown | null> {
  return getDirectSaleDrillDown(saleId)
}

'use server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

type ActionResult = { success: boolean; error?: string }

export interface AssemblyPartStatus {
  partId: string
  name: string
  quantityPerUnit: number
  produced: number
  consumed: number
  available: number
  // Quantas unidades do produto essa peça sozinha permite montar --
  // maxAssemblableUnits do produto é o mínimo entre todas as peças.
  maxUnitsFromThisPart: number
}

export interface AssemblyStatus {
  productId: string
  productName: string
  parts: AssemblyPartStatus[]
  maxAssemblableUnits: number
}

// 2.3: pra cada peça do produto, "disponível" = soma de tudo que já foi
// produzido com sucesso pra ela (ProductionRun.productPartId) menos o que
// já foi consumido em montagens anteriores (ProductAssembly.quantity ×
// quantityPerUnit dessa peça -- toda montagem consome as peças na mesma
// proporção da ficha técnica, spec 2.1). maxAssemblableUnits é o quanto dá
// pra montar AGORA, travado pela peça mais escassa.
export async function getAssemblyStatus(productId: string): Promise<AssemblyStatus> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: { parts: true, assemblies: true },
  })

  const alreadyAssembled = product.assemblies.reduce((sum, a) => sum + a.quantity, 0)

  const producedByPart = await prisma.productionRun.groupBy({
    by: ['productPartId'],
    where: { productPartId: { in: product.parts.map((p) => p.id) }, status: { not: 'CANCELADA' } },
    _sum: { quantitySuccess: true },
  })
  const producedMap = new Map(producedByPart.map((p) => [p.productPartId as string, p._sum.quantitySuccess ?? 0]))

  const parts: AssemblyPartStatus[] = product.parts.map((part) => {
    const produced = producedMap.get(part.id) ?? 0
    const consumed = alreadyAssembled * part.quantityPerUnit
    const available = produced - consumed
    return {
      partId: part.id,
      name: part.name,
      quantityPerUnit: part.quantityPerUnit,
      produced,
      consumed,
      available,
      maxUnitsFromThisPart: Math.floor(available / part.quantityPerUnit),
    }
  })

  const maxAssemblableUnits = parts.length === 0 ? 0 : Math.max(0, Math.min(...parts.map((p) => p.maxUnitsFromThisPart)))

  return { productId: product.id, productName: product.name, parts, maxAssemblableUnits }
}

const confirmAssemblySchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro').positive('Quantidade deve ser maior que zero'),
  notes: z.string().optional().nullable(),
})

// Confirma a montagem: valida de novo (contra corrida com outra montagem
// simultânea) que cada peça ainda tem estoque suficiente e só então grava
// o ProductAssembly -- não há contador físico pra decrementar em outro
// lugar, "dar baixa nas peças" e "somar ao estoque do produto acabado" são
// os dois lados do mesmo cálculo derivado (lib/reports.ts#getOwnStockSummary
// e getAssemblyStatus acima leem esta mesma tabela).
export async function confirmAssembly(formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData)
  const parsed = confirmAssemblySchema.safeParse({ ...raw, notes: raw.notes || null })
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
  const { productId, quantity, notes } = parsed.data

  const status = await getAssemblyStatus(productId)
  const insufficient = status.parts.filter((p) => p.maxUnitsFromThisPart < quantity)
  if (insufficient.length > 0) {
    return {
      success: false,
      error: `Peças insuficientes: ${insufficient.map((p) => `${p.name} (dá pra montar só ${p.maxUnitsFromThisPart})`).join('; ')}`,
    }
  }

  await prisma.productAssembly.create({ data: { productId, quantity, notes } })

  revalidatePath('/assembly')
  revalidatePath('/stock')
  return { success: true }
}

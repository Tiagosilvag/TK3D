import type { MarketplacePlatformKind } from '@prisma/client'
import type { PlatformFeeTier } from '@/lib/costing'

// Taxa cadastrada de cada plataforma (mesmo formato PlatformFeeTier[] de
// Configurações/Produtos), passada pronta de sales/page.tsx -- alimenta a
// prévia ao vivo do modal e o painel "Taxas cadastradas".
export interface PlatformFeeInfo {
  kind: MarketplacePlatformKind
  feePercent: number
  feeFixed: number
  feeTiers: PlatformFeeTier[] | null
}

// Brinde: produto sem preço, anexável como custo extra numa venda.
export interface GiftProductOption {
  id: string
  name: string
  unitCost: number
}

'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/format'
import {
  fetchDeliveryDrillDown,
  fetchConsignmentSaleDrillDown,
  fetchDirectSaleDrillDown,
  type DeliveryDrillDown,
  type ConsignmentSaleDrillDown,
  type DirectSaleDrillDown,
} from '@/actions/productTracking'

// Painel de drill-down (entrega/venda) a partir de um passo clicável da
// trilha por unidade. Bug evitado de propósito: um <dialog> aninhado (ou
// um Drawer portado pra document.body, como components/Drawer.tsx já faz
// em Pedidos) iria renderizar ATRÁS do <dialog> nativo já aberto de
// VariantsModal -- um <dialog> em showModal() sobe pro "top layer" do
// navegador, acima de QUALQUER outro elemento fora dele por z-index que
// seja (mesmo cuidado já documentado em VariantsModal.tsx/
// ComponentCategoryCard sobre bug de stacking). Este painel nunca sai do
// DOM do próprio <dialog> -- é um `absolute inset-0` dentro do mesmo
// container relativo, nunca um portal.
export type DrawerTarget = { type: 'delivery'; deliveryId: string } | { type: 'consignmentSale'; saleReportId: string } | { type: 'directSale'; saleId: string }

function StatusPill({ status }: { status: 'vendida' | 'com_parceiro' | 'devolvida' }) {
  const cls = status === 'vendida'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
    : status === 'devolvida'
      ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
  const label = status === 'vendida' ? 'Vendida' : status === 'devolvida' ? 'Devolvida' : 'Com ele(a)'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
}

function DeliveryPanel({ deliveryId, onOpenSale }: { deliveryId: string; onOpenSale: (saleReportId: string) => void }) {
  const [data, setData] = useState<DeliveryDrillDown | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setData(undefined)
    fetchDeliveryDrillDown(deliveryId).then((r) => { if (!cancelled) setData(r) })
    return () => { cancelled = true }
  }, [deliveryId])

  if (data === undefined) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Carregando entrega…</p>
  if (data === null) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Entrega não encontrada.</p>

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Entrega</p>
        <h4 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">#{data.deliveryId.slice(-4).toUpperCase()} · {data.partnerName}</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {new Date(data.deliveryDate).toLocaleDateString('pt-BR')}
          {data.otherProductsCount > 0 && ` · +${data.otherProductsCount} outro(s) produto(s) nesta entrega`}
        </p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{data.productName} nesta entrega</p>
          <div className="space-y-1.5">
            {data.items.map((item) => (
              <div key={item.n} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-700">
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                  <span className="text-xs text-slate-400 dark:text-slate-500">#{item.n}</span>
                  {item.colorHexes.map((hex, i) => <span key={i} style={{ background: hex }} className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 dark:border-white/10" />)}
                  <span className="truncate">{item.variantLabel}</span>
                </span>
                {item.status === 'vendida' && item.soldDetail ? (
                  <button type="button" onClick={() => onOpenSale(item.soldDetail!.saleReportId)} className="shrink-0 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                    Vendida ↗
                  </button>
                ) : (
                  <StatusPill status={item.status} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
          <p>Vendido {data.soldCount} de {data.items.length} · ainda com ele(a) {data.remainingCount}</p>
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">Valor parado com ele(a): {formatCurrency(data.valueWithPartner)}</p>
        </div>
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
        {/* Não existe deep-link direto pra ABRIR o modal de uma entrega
            específica (DeliveriesExplorer abre pelo clique na linha, sem
            estado via URL) -- filtra a lista pelo parceiro, o mais perto
            de "ir direto pra ela" que a tela hoje permite. */}
        <Link href={`/consignment/deliveries?partnerId=${data.partnerId}`} className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Abrir entrega completa
        </Link>
        <Link href={`/consignment/partners/${data.partnerId}`} className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Abrir parceiro
        </Link>
      </div>
    </div>
  )
}

function ConsignmentSalePanel({ saleReportId, onBackToDelivery }: { saleReportId: string; onBackToDelivery: (deliveryId: string) => void }) {
  const [data, setData] = useState<ConsignmentSaleDrillDown | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setData(undefined)
    fetchConsignmentSaleDrillDown(saleReportId).then((r) => { if (!cancelled) setData(r) })
    return () => { cancelled = true }
  }, [saleReportId])

  if (data === undefined) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Carregando venda…</p>
  if (data === null) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Venda não encontrada.</p>

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Venda consignada</p>
        <h4 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">#{data.saleReportId.slice(-4).toUpperCase()} · {data.partnerName}</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{new Date(data.reportDate).toLocaleDateString('pt-BR')}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700">
          <p className="text-slate-700 dark:text-slate-300">{data.quantitySold}x {data.productName} · {data.variantLabel}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatCurrency(data.unitPrice)} cada</p>
        </div>

        <div className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Vendido</span>
            <span className="tabular-nums">{formatCurrency(data.quantitySold * data.unitPrice)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">− Comissão ({(data.commissionPercent * 100).toFixed(0)}%)</span>
            <span className="tabular-nums">{formatCurrency(data.commissionValue)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">− Meu custo</span>
            <span className="tabular-nums">{formatCurrency(data.quantitySold * data.unitCost)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-1 font-medium dark:border-slate-700">
            <span>= Meu lucro</span>
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(data.profit)}</span>
          </div>
        </div>

        <button type="button" onClick={() => onBackToDelivery(data.deliveryId)} className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
          ← Veio da entrega · {new Date(data.deliveryDate).toLocaleDateString('pt-BR')}
        </button>
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
        {/* /consignment/reports não tem filtro por produto/parceiro hoje --
            a tela do parceiro (já com o detalhe de venda por produto,
            redesign recente) é o destino mais próximo de "ver a venda
            completa" que já existe. */}
        <Link href={`/consignment/partners/${data.partnerId}`} className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Abrir venda completa
        </Link>
        <Link href={`/consignment/partners/${data.partnerId}`} className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Abrir parceiro
        </Link>
      </div>
    </div>
  )
}

function DirectSalePanel({ saleId }: { saleId: string }) {
  const [data, setData] = useState<DirectSaleDrillDown | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setData(undefined)
    fetchDirectSaleDrillDown(saleId).then((r) => { if (!cancelled) setData(r) })
    return () => { cancelled = true }
  }, [saleId])

  if (data === undefined) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Carregando venda…</p>
  if (data === null) return <p className="px-4 py-6 text-sm text-slate-400 dark:text-slate-500">Venda não encontrada.</p>

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-4 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Venda direta</p>
        <h4 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">{data.productName}</h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{new Date(data.saleDate).toLocaleDateString('pt-BR')} · {data.buyerOrPlatform ?? data.channel}</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="space-y-1 rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Vendido ({data.quantity}x)</span>
            <span className="tabular-nums">{formatCurrency(data.quantity * data.unitPrice)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">− Meu custo</span>
            <span className="tabular-nums">{formatCurrency(data.quantity * data.unitCost)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-1 font-medium dark:border-slate-700">
            <span>= Meu lucro</span>
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(data.profit)}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-200 p-4 dark:border-slate-800">
        <Link href={`/sales?productId=${data.productId}`} className="block rounded-lg border border-slate-200 px-3 py-1.5 text-center text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          Abrir venda completa
        </Link>
      </div>
    </div>
  )
}

// Pilha de navegação ida-e-volta (entrega ↔ venda) -- "Veio da entrega"
// empilha de volta pra entrega sem perder o histórico de navegação; ✕/Esc/
// clique fora fecha tudo de uma vez (nunca só 1 nível).
export function UnitTrailDrawer({ target, onClose, onNavigate }: { target: DrawerTarget | null; onClose: () => void; onNavigate: (target: DrawerTarget) => void }) {
  useEffect(() => {
    if (!target) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [target, onClose])

  if (!target) return null

  return (
    <div className="absolute inset-0 z-20 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/50" />
      <div onClick={(e) => e.stopPropagation()} className="relative flex h-full w-full max-w-[420px] flex-col border-l border-slate-200 bg-white text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 z-10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">✕</button>
        {target.type === 'delivery' && (
          <DeliveryPanel
            deliveryId={target.deliveryId}
            onOpenSale={(saleReportId) => onNavigate({ type: 'consignmentSale', saleReportId })}
          />
        )}
        {target.type === 'consignmentSale' && (
          <ConsignmentSalePanel
            saleReportId={target.saleReportId}
            onBackToDelivery={(deliveryId) => onNavigate({ type: 'delivery', deliveryId })}
          />
        )}
        {target.type === 'directSale' && <DirectSalePanel saleId={target.saleId} />}
      </div>
    </div>
  )
}

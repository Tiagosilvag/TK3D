'use client'
import { useRouter } from 'next/navigation'
import { updateOrderStatus } from '@/actions/orders'
import { ORDER_STATUS_LABELS } from '@/lib/format'
import type { OrderStatus } from '@prisma/client'

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS) as [OrderStatus, string][]

export function OrderStatusForm({ orderId, status, locked }: { orderId: string; status: OrderStatus; locked: boolean }) {
  const router = useRouter()

  async function handleChange(newStatus: string) {
    const formData = new FormData()
    formData.set('status', newStatus)
    const result = await updateOrderStatus(orderId, formData)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  if (locked) {
    return <span className="text-slate-500 dark:text-slate-400">{ORDER_STATUS_LABELS[status]}</span>
  }

  return (
    <select
      defaultValue={status}
      onChange={(e) => void handleChange(e.target.value)}
      className="tk-input"
      aria-label="Status do pedido"
    >
      {STATUS_OPTIONS.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  )
}

'use client'
import { deleteAccessoryType } from '@/actions/accessoryTypes'

export function DeleteTypeForm({ id }: { id: string }) {
  async function action() {
    if (!window.confirm('Remover este tipo de acessório?')) return
    const result = await deleteAccessoryType(id)
    if (!result.success) alert(result.error)
  }

  return (
    <form action={action}>
      <button className="tk-link-danger">Remover</button>
    </form>
  )
}

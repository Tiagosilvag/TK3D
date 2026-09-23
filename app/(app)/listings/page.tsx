import { getListingsPageData } from '@/actions/listings'
import { ListingsExplorer } from './ListingsExplorer'

export const dynamic = 'force-dynamic'

export default async function ListingsPage() {
  const data = await getListingsPageData()

  return (
    <div className="tk-page">
      <h1 className="tk-page-title">Anúncios</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Vínculo entre produtos e os canais em que estão publicados (preço real, taxa aplicada e lucro).
      </p>
      <ListingsExplorer data={data} />
    </div>
  )
}

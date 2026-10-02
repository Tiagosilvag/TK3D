export interface MLListingSummary {
  id: string
  title: string
  price: number
  availableQuantity: number
  permalink: string
}

interface MLItemDetail {
  id: string
  title: string
  price: number
  available_quantity: number
  permalink: string
}

export async function fetchActiveListings(accessToken: string, sellerId: string): Promise<MLListingSummary[]> {
  const idsResponse = await fetch(`https://api.mercadolibre.com/users/${sellerId}/items/search`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!idsResponse.ok) throw new Error('Falha ao buscar anúncios no Mercado Livre')
  const { results: ids } = (await idsResponse.json()) as { results: string[] }
  if (ids.length === 0) return []

  const detailsResponse = await fetch(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!detailsResponse.ok) throw new Error('Falha ao buscar detalhes dos anúncios no Mercado Livre')
  const details = (await detailsResponse.json()) as Array<{ code: number; body: MLItemDetail }>

  return details
    .filter((d) => d.code === 200)
    .map((d) => ({
      id: d.body.id,
      title: d.body.title,
      price: d.body.price,
      availableQuantity: d.body.available_quantity,
      permalink: d.body.permalink,
    }))
}

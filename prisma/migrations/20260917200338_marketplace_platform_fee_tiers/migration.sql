-- Melhoria "Shopee: taxa por faixa de preço": feePercent/feeFixed (NOT
-- NULL) continuam existindo pra Mercado Livre, que nunca ganha feeTiers --
-- comportamento de hoje, taxa única, sem mudança nenhuma. feeTiers é
-- opcional -- só a Shopee recebe as 5 faixas reais abaixo.

-- AlterTable
ALTER TABLE "MarketplacePlatform" ADD COLUMN "feeTiers" JSONB;

-- Popula a Shopee com a tabela real de taxas por faixa de preço (taxa
-- "cheia", sem o subsídio Pix -- variável por transação, tratado como
-- margem extra eventual, nunca uma redução garantida no preço sugerido).
UPDATE "MarketplacePlatform" SET "feeTiers" = '[
  {"maxPrice": 79.99, "feePercent": 0.20, "feeFixed": 4},
  {"maxPrice": 99.99, "feePercent": 0.14, "feeFixed": 16},
  {"maxPrice": 199.99, "feePercent": 0.14, "feeFixed": 20},
  {"maxPrice": 499.99, "feePercent": 0.14, "feeFixed": 26},
  {"maxPrice": null, "feePercent": 0.14, "feeFixed": 26}
]'::jsonb
WHERE platform = 'SHOPEE';

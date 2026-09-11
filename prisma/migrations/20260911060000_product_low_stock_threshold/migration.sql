-- Melhoria "Meu Estoque" §1/§7: limiar de "pouco estoque" pra Produto
-- acabado -- número absoluto de unidades (Produto manufaturado não tem um
-- "estoque inicial" de referência pra calcular percentual, ao contrário de
-- Filamento/Acessório/Insumo).
ALTER TABLE "Settings" ADD COLUMN "productLowStockThreshold" INTEGER NOT NULL DEFAULT 3;

-- Melhoria "Consignação: pagamentos de comissão": registro dos pagamentos
-- feitos ao parceiro. "A pagar" = comissão total (Σ das vendas, cada uma com a
-- própria comissão) − Σ pagamentos -- sempre calculado dos registros, nunca um
-- contador. Aditiva: nenhuma tabela existente é tocada.

-- CreateTable
CREATE TABLE "ConsignmentPartnerPayment" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsignmentPartnerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsignmentPartnerPayment_partnerId_idx" ON "ConsignmentPartnerPayment"("partnerId");

-- AddForeignKey
ALTER TABLE "ConsignmentPartnerPayment" ADD CONSTRAINT "ConsignmentPartnerPayment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ConsignmentPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

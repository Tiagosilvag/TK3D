-- Bug 4: tipos de acessório cadastrados divergindo só por capitalização
-- (ex.: "CLICKER" e "Clicker") eram tratados como categorias diferentes,
-- porque a UNIQUE constraint em accessory_types.name é case-sensitive e a
-- tela de cadastro (Configurações -> Tipos de acessório) não validava isso.
-- App-level: createAccessoryType/renameAccessoryType agora normalizam pra
-- "Primeira maiúscula, resto minúsculo" e bloqueiam duplicata
-- case-insensitive antes de salvar (actions/accessoryTypes.ts). Este
-- arquivo corrige os dados que já existem em produção.

-- 1) Para cada grupo de tipos que só diferem por capitalização, escolhe um
-- sobrevivente (o criado primeiro -- mais provável de já ter Accessory
-- vinculado), reatribui todo Accessory.type dos demais pra ele, e remove
-- os registros redundantes.
DO $$
DECLARE
  dup RECORD;
  survivor_id TEXT;
BEGIN
  FOR dup IN
    SELECT LOWER(name) AS lname
    FROM accessory_types
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO survivor_id
    FROM accessory_types
    WHERE LOWER(name) = dup.lname
    ORDER BY "createdAt" ASC, id ASC
    LIMIT 1;

    UPDATE "Accessory"
    SET "type" = survivor_id
    WHERE "type" IN (
      SELECT id FROM accessory_types WHERE LOWER(name) = dup.lname AND id <> survivor_id
    );

    DELETE FROM accessory_types
    WHERE LOWER(name) = dup.lname AND id <> survivor_id;
  END LOOP;
END $$;

-- 2) Normaliza todo nome remanescente pra "Primeira maiúscula, resto
-- minúsculo" (ex.: "CORRENTE_BOLINHA"'s seed name "Corrente bolinha" já
-- está nesse formato e não muda; algo como "clicker" ou "CLICKER" vira
-- "Clicker").
UPDATE accessory_types
SET name = UPPER(LEFT(name, 1)) || LOWER(SUBSTRING(name FROM 2))
WHERE name <> (UPPER(LEFT(name, 1)) || LOWER(SUBSTRING(name FROM 2)));

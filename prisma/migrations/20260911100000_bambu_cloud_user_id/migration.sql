-- Fix login MQTT (esta sessão): o username do broker MQTT da nuvem Bambu
-- é "u_{uid}" (id numérico da conta), não o e-mail -- guarda o uid à parte
-- pra montar o username certo sem chamada extra a cada boot do listener.
ALTER TABLE "Settings" ADD COLUMN "bambuCloudUserId" TEXT;

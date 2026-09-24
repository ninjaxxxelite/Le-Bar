-- =====================================================================
-- LE BAR — Réévaluation mensuelle automatique de la valeur
-- À lancer dans Supabase > SQL Editor. Prérequis : la fonction Edge
-- "revalue-all" est déployée et le secret CRON_SECRET est défini.
-- =====================================================================

-- 1) Colonne pour mémoriser la date de dernière estimation
alter table public.bottles add column if not exists valued_at timestamptz;

-- 2) Extensions nécessaires (planification + appels HTTP)
--    (Peuvent aussi s'activer via Dashboard > Database > Extensions.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Planifier : le 1er de chaque mois à 03:00 (UTC)
--    Remplacez METTEZ_VOTRE_CRON_SECRET par le secret CRON_SECRET défini
--    dans les secrets de la fonction Edge.
select cron.schedule(
  'revalue-monthly',
  '0 3 1 * *',
  $$
  select net.http_post(
    url := 'https://hbnfosntlgcbdyrrctog.supabase.co/functions/v1/revalue-all',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'METTEZ_VOTRE_CRON_SECRET'
    )
  );
  $$
);

-- Pour arrêter la planification plus tard :
--   select cron.unschedule('revalue-monthly');
-- Pour tester tout de suite sans attendre le 1er du mois, appelez la
-- fonction manuellement (remplacez le secret) :
--   select net.http_post(
--     url := 'https://hbnfosntlgcbdyrrctog.supabase.co/functions/v1/revalue-all',
--     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','METTEZ_VOTRE_CRON_SECRET')
--   );

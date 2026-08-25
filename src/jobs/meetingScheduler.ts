import { autoEndExpiredMeetings } from "../services/meetingService";

const CHECK_INTERVAL_MS = 60_000; // vérifie toutes les minutes

/**
 * ⚠️ Implémentation simple par setInterval — suffisante pour UNE seule
 * instance du backend (typiquement un service Render standard). Si le
 * backend est un jour scalé horizontalement (plusieurs instances en
 * parallèle), cette approche exécuterait la vérification plusieurs fois
 * en simultané (inoffensif ici car idempotent — fermer une salle déjà
 * fermée ne fait rien de plus — mais inefficace). Passer à un vrai job
 * scheduler externe (ex: cron job Render séparé, ou BullMQ + Redis) le
 * jour où le backend tourne sur plusieurs instances.
 */
export function startMeetingScheduler(): void {
  setInterval(() => {
    autoEndExpiredMeetings()
      .then((count) => {
        if (count > 0) {
          // eslint-disable-next-line no-console
          console.log(`[meetingScheduler] ${count} réunion(s) terminée(s) automatiquement.`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[meetingScheduler] Erreur pendant la vérification:", err);
      });
  }, CHECK_INTERVAL_MS);

  // eslint-disable-next-line no-console
  console.log(
    `[meetingScheduler] Démarré — vérifie les séances expirées toutes les ${CHECK_INTERVAL_MS / 1000}s.`
  );
}

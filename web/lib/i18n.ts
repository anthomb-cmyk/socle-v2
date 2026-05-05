// lib/i18n.ts
// -----------
// Minimal bilingual dictionary for Socle CRM's smart-calling experience.
// Only display labels live here; DB enum values / API keys are never touched.
//
// Usage (client components):
//   import { useLocale } from "@/components/locale-provider";
//   const { t } = useLocale();
//   <button>{t.workspace.call}</button>

export type Locale = "fr" | "en";

export const LOCALE_STORAGE_KEY = "socle_locale";
export const DEFAULT_LOCALE: Locale = "fr";

// ── Full translation dictionary ───────────────────────────────────────────────

const dict = {
  fr: {
    // ── Language toggle ───────────────────────────────────────────────────────
    toggleLang: "EN",
    lang: "Français",

    // ── Sidebar nav labels ────────────────────────────────────────────────────
    // FR strings mirror the hardcoded `label` fields currently in
    // app-sidebar.tsx PRIMARY_NAV / ADMIN_NAV. Adding keys here is purely
    // additive — the sidebar continues to use its hardcoded labels until a
    // future phase wires them through useLocale().
    nav: {
      queue:         "File d'appels",
      phoneReview:   "Téléphones à réviser",
      dashboard:     "Tableau de bord",
      pipeline:      "Pipeline deals",
      leads:         "Leads",
      review:        "Revue",
      import:        "Import rôle",
      enrichment:    "Enrichissement",
      followUps:     "Suivis",
      calendar:      "Calendrier",
      map:           "Carte",
      users:         "Utilisateurs",
      events:        "Journal événements",
      dataHealth:    "Santé données",
      properties:    "Propriétés",
      contacts:      "Contacts",
      callerSection: "Module appels",
    },

    // ── Queue page ────────────────────────────────────────────────────────────
    queue: {
      title:         "File d'appels",
      allLeads:      "Tous les leads",
      empty:         "File vide — rien à appeler pour le moment.",
      browseLeads:   "Parcourir les leads",
      footer:        "Priorité · rappels en retard en premier · plus ancien contact en dernier",
      leadCount:     (n: number) => `${n} lead${n === 1 ? "" : "s"} à appeler`,
      overdueCount:  (n: number) => `${n} rappel${n !== 1 ? "s" : ""} en retard`,
      overdueLabel:  (val: string) => `Rappel en retard — ${val}`,
      never:         "jamais",
      timeAgoMin:    "m",
      timeAgoHour:   "h",
      timeAgoDay:    "j",

      // Stat strip + filters (used by upcoming CallerQueueStats / Filters)
      statTotalToday:   "À appeler",
      statHotPriority:  "Priorité haute",
      statOverdue:      "En retard",
      statLastCall:     "Dernier appel",
      filterAll:        "Tous",
      filterHot:        "Priorité haute",
      filterCallable:   "À appeler",
      searchPlaceholder:"Rechercher (nom, adresse, ville)…",

      // Empty-state breakdown (server-fetched diagnostics, not a logic change)
      emptyTitle:           "Rien à appeler pour le moment",
      emptyDiagAssignedNone:"Aucun lead n'est assigné à toi pour le moment.",
      emptyDiagUnassigned:  (n: number) => `${n} lead${n !== 1 ? "s" : ""} non assigné${n !== 1 ? "s" : ""} dans le système.`,
      emptyDiagFuture:      (n: number) => `${n} rappel${n !== 1 ? "s" : ""} planifié${n !== 1 ? "s" : ""} plus tard.`,
      emptyDiagPhone:       (n: number) => `${n} numéro${n !== 1 ? "s" : ""} en attente de vérification.`,
      emptyDiagLocked:      (n: number) => `${n} lead${n !== 1 ? "s" : ""} verrouillé${n !== 1 ? "s" : ""} par un autre appelant.`,
    },

    // ── Lead status labels (used in queue cards and workspace) ────────────────
    status: {
      new:            "Nouveau",
      ready_to_call:  "À appeler",
      in_outreach:    "En démarche",
      no_answer:      "Sans réponse",
      phone_verified: "Tél. vérifié",
      qualified:      "Qualifié",
      disqualified:   "Disqualifié",
      do_not_contact: "Ne pas contacter",
      rejected:       "Rejeté",
    } as Record<string, string>,

    // ── Call outcomes ─────────────────────────────────────────────────────────
    outcome: {
      no_answer:      "Pas de réponse",
      voicemail_left: "Message vocal laissé",
      wrong_number:   "Mauvais #",
      bad_number:     "Mauvais numéro",
      not_interested: "Pas intéressé",
      do_not_contact: "Ne pas contacter",
      maybe_later:    "Peut-être plus tard",
      call_back_later:"Rappeler plus tard",
      wants_more_info:"Veut info",
      open_to_selling:"Ouvert à vendre",
      wants_offer:    "Veut offre",
      hot_seller:     "🔥 Vendeur chaud",
      follow_up_booked:"Suivi planifié",
      already_sold:   "Déjà vendu",
    } as Record<string, string>,

    // ── Caller workspace ──────────────────────────────────────────────────────
    workspace: {
      backToQueue:          "Retour à la file",
      skipNextLead:         "Passer · prochain lead →",
      phoneDialed:          "Téléphone utilisé",
      noPhones:             "Aucun numéro de téléphone pour ce contact.",
      notesLabel:           "Notes (optionnel)",
      notesPlaceholder:     "Qu'est-ce qu'ils ont dit ?",
      quickOutcome:         "Résultat rapide",
      scheduleCallback:     "Planifier un rappel",
      confirmCallback:      "Confirmer le rappel",
      cancelCallback:       "annuler",
      callBackLater:        "📅 Rappeler plus tard",
      sendToAnthony:        "Envoyer à Anthony",

      // Twilio call button / states
      call:                 "📞 Appeler",
      calling:              "En cours…",
      connecting:           "Connexion…",
      ringing:              "Ton téléphone sonne…",
      answered:             "En ligne",
      callCompleted:        "Appel terminé",
      callFailed:           "Erreur",
      willRingOn:           "Sonnera sur",
      forwardNotConfigured: "Numéro de renvoi non configuré",
      pickup:               "Décroche ton téléphone…",
      connected:            "Connecté · parle avec le propriétaire",
      selectOutcome:        "✓ Appel terminé — sélectionne un résultat ci-dessous",

      // Submission form (hot sellers)
      submitTitle:          "Envoyer à Anthony",
      submitSubtitle:       (outcome: string) => `Appel enregistré comme ${outcome}. Ajoute les détails pour qu'Anthony puisse prendre le relais.`,
      interestLevel:        "Niveau d'intérêt",
      timeline:             "Échéance",
      motivation:           "Motivation (pourquoi envisagent-ils de vendre ?)",
      motivationPlaceholder:"ex: retraite, divorce, hypothèque à renouveler",
      askingPrice:          "Prix demandé (si mentionné)",
      summary:              "Résumé pour Anthony (requis)",
      summaryPlaceholder:   "Que s'est-il passé ? Qu'est-ce qu'Anthony doit savoir pour rappeler ce propriétaire ?",
      submitBtn:            "Soumettre à Anthony",
      submitting:           "Envoi en cours…",
      skipSubmission:       "Passer la soumission",
      summaryTooShort:      "Résumé trop court — donne au moins une phrase à Anthony.",

      // Error messages
      selectPhone:       "Sélectionne un numéro de téléphone.",
      noForwardNumber:   "Ton numéro de renvoi n'est pas configuré — demande à Anthony de l'ajouter dans ton profil.",
      callLaunchFailed:  "Impossible de lancer l'appel.",
      networkError:      "Erreur réseau — réessaie.",
      savingCallback:    "Enregistrement…",

      // Callback preset chips (used by upcoming CallbackScheduler)
      callbackPresetIn15m:      "Dans 15 min",
      callbackPreset1h:         "Dans 1 h",
      callbackPresetTomorrowAm: "Demain matin",
      callbackPresetTomorrowPm: "Demain après-midi",
      callbackPresetCustom:     "Personnalisé",

      // Soft banner when a caller deep-links into a lead held by another caller
      lockedByOther:            (name: string) => `Ce lead est verrouillé par ${name}.`,
    },

    // ── Call history panel ────────────────────────────────────────────────────
    history: {
      title:              (n: number) => `Historique des appels (${n})`,
      showTranscript:     "▼ Voir la transcription",
      hideTranscript:     "▲ Masquer la transcription",
      transcribing:       "⏳ Transcription en cours…",
      transcriptFailed:   "Transcription échouée",
      retry:              "réessayer",
      getTranscript:      "📝 Obtenir la transcription",
      requesting:         "Demande envoyée…",
      networkError:       "Erreur réseau",
      aiAnalysis:         "🤖 Analyse AI",
      aiAnalyzeBtn:       "🤖 Organiser avec l'AI",
      aiAnalyzing:        "⏳ Analyse en cours…",
      objections:         "Objections :",
      nextSteps:          "Prochaines étapes :",
    },

    // ── Phone review page ─────────────────────────────────────────────────────
    review: {
      title:              "Revue téléphonique",
      empty:              "File de revue vide",
      emptyDetail:        "Tous les candidats ont été révisés.",
      rules:              "Approuvez un numéro pour rendre le lead appelable. Rejetez pour le supprimer. Réessayer relance le pipeline. Garder non-résolu masque sans réessayer.",
      candidateCount:     (n: number) => `${n} candidat${n === 1 ? "" : "s"} à approuver avant d'être appelable${n === 1 ? "" : "s"}.`,
      noneInFilter:       "Aucun candidat dans ce filtre de confiance.",
      approve:            "✓ Approuver — rendre appelable",
      reject:             "✗ Rejeter",
      retryPipeline:      "↺ Réessayer",
      keepUnresolved:     "Garder non résolu",
      bulkApprove:        "Approuver tous",
      bulkReject:         "Rejeter tous",
      bulkKeep:           "Garder non-résolu",
      approving:          (done: number, total: number) => `Approbation en cours… ${done} / ${total}`,
      selected:           (n: number) => `${n} candidat${n !== 1 ? "e" : ""}${n !== 1 ? "s" : ""} sélectionné${n !== 1 ? "e" : ""}${n !== 1 ? "s" : ""}`,
      selectAll:          (n: number) => `Tout sélectionner (${n})`,
      deselectAll:        (n: number) => `Tout désélectionner (${n})`,
      notePlaceholder:    "Note optionnelle (enregistrée avec votre décision)",
      openClawAnalysis:   "OpenClaw analysis",
      confidence:         "Confiance :",
      bucketAll:          (n: number) => `Tous (${n})`,
    },

    // ── Common shared strings (loading / retry / etc.) ────────────────────────
    common: {
      skeleton:    "Chargement…",
      errorRetry:  "Réessayer",
    },
  },

  en: {
    // ── Language toggle ───────────────────────────────────────────────────────
    toggleLang: "FR",
    lang: "English",

    // ── Sidebar nav labels ────────────────────────────────────────────────────
    nav: {
      queue:         "Call queue",
      phoneReview:   "Phone review",
      dashboard:     "Dashboard",
      pipeline:      "Pipeline",
      leads:         "Leads",
      review:        "Review",
      import:        "Role import",
      enrichment:    "Enrichment",
      followUps:     "Follow-ups",
      calendar:      "Calendar",
      map:           "Map",
      users:         "Users",
      events:        "Event log",
      dataHealth:    "Data health",
      properties:    "Properties",
      contacts:      "Contacts",
      callerSection: "Caller module",
    },

    // ── Queue page ────────────────────────────────────────────────────────────
    queue: {
      title:         "Call queue",
      allLeads:      "All leads",
      empty:         "Queue empty — nothing to call right now.",
      browseLeads:   "Browse leads",
      footer:        "Priority · overdue callbacks first · oldest contact last",
      leadCount:     (n: number) => `${n} callable lead${n === 1 ? "" : "s"}`,
      overdueCount:  (n: number) => `${n} overdue callback${n !== 1 ? "s" : ""}`,
      overdueLabel:  (val: string) => `Overdue callback — ${val}`,
      never:         "never",
      timeAgoMin:    "m",
      timeAgoHour:   "h",
      timeAgoDay:    "d",

      // Stat strip + filters
      statTotalToday:   "To call",
      statHotPriority:  "Hot priority",
      statOverdue:      "Overdue",
      statLastCall:     "Last call",
      filterAll:        "All",
      filterHot:        "Hot priority",
      filterCallable:   "Callable",
      searchPlaceholder:"Search (name, address, city)…",

      // Empty-state breakdown
      emptyTitle:           "Nothing to call right now",
      emptyDiagAssignedNone:"No leads are assigned to you at the moment.",
      emptyDiagUnassigned:  (n: number) => `${n} lead${n !== 1 ? "s" : ""} unassigned in the system.`,
      emptyDiagFuture:      (n: number) => `${n} callback${n !== 1 ? "s" : ""} scheduled for later.`,
      emptyDiagPhone:       (n: number) => `${n} phone number${n !== 1 ? "s" : ""} awaiting verification.`,
      emptyDiagLocked:      (n: number) => `${n} lead${n !== 1 ? "s" : ""} locked by another caller.`,
    },

    // ── Lead status labels ────────────────────────────────────────────────────
    status: {
      new:            "New",
      ready_to_call:  "Ready to call",
      in_outreach:    "In outreach",
      no_answer:      "No answer",
      phone_verified: "Phone verified",
      qualified:      "Qualified",
      disqualified:   "Disqualified",
      do_not_contact: "Do not contact",
      rejected:       "Rejected",
    } as Record<string, string>,

    // ── Call outcomes ─────────────────────────────────────────────────────────
    outcome: {
      no_answer:       "No answer",
      voicemail_left:  "Voicemail left",
      wrong_number:    "Wrong #",
      bad_number:      "Bad number",
      not_interested:  "Not interested",
      do_not_contact:  "Do not contact",
      maybe_later:     "Maybe later",
      call_back_later: "Call back later",
      wants_more_info: "Wants info",
      open_to_selling: "Open to selling",
      wants_offer:     "Wants offer",
      hot_seller:      "🔥 Hot seller",
      follow_up_booked:"Follow-up booked",
      already_sold:    "Already sold",
    } as Record<string, string>,

    // ── Caller workspace ──────────────────────────────────────────────────────
    workspace: {
      backToQueue:          "Back to queue",
      skipNextLead:         "Skip · next lead →",
      phoneDialed:          "Phone dialed",
      noPhones:             "No phone numbers on file for this contact.",
      notesLabel:           "Notes (optional)",
      notesPlaceholder:     "What did they say?",
      quickOutcome:         "Quick outcome",
      scheduleCallback:     "Schedule callback",
      confirmCallback:      "Confirm callback",
      cancelCallback:       "cancel",
      callBackLater:        "📅 Call back later",
      sendToAnthony:        "Send to Anthony",

      // Twilio call button / states
      call:                 "📞 Call",
      calling:              "In progress…",
      connecting:           "Connecting…",
      ringing:              "Your phone is ringing…",
      answered:             "On the line",
      callCompleted:        "Call completed",
      callFailed:           "Error",
      willRingOn:           "Will ring on",
      forwardNotConfigured: "Forward number not configured",
      pickup:               "Pick up your phone…",
      connected:            "Connected · speaking with owner",
      selectOutcome:        "✓ Call ended — select an outcome below",

      // Submission form
      submitTitle:          "Send to Anthony",
      submitSubtitle:       (outcome: string) => `Call logged as ${outcome}. Add the details Anthony needs to take it from here.`,
      interestLevel:        "Interest level",
      timeline:             "Timeline",
      motivation:           "Motivation (why are they considering selling?)",
      motivationPlaceholder:"e.g. retiring, divorce, mortgage maturity",
      askingPrice:          "Asking price (if mentioned)",
      summary:              "Summary for Anthony (required)",
      summaryPlaceholder:   "What happened? What does Anthony need to know to call this owner back?",
      submitBtn:            "Submit to Anthony",
      submitting:           "Sending…",
      skipSubmission:       "Skip submission",
      summaryTooShort:      "Summary too short — give Anthony at least one sentence.",

      // Error messages
      selectPhone:       "Select a phone number.",
      noForwardNumber:   "Your forward number is not configured — ask Anthony to add it in your profile.",
      callLaunchFailed:  "Unable to start call.",
      networkError:      "Network error — please retry.",
      savingCallback:    "Saving…",

      // Callback preset chips
      callbackPresetIn15m:      "In 15 min",
      callbackPreset1h:         "In 1 h",
      callbackPresetTomorrowAm: "Tomorrow morning",
      callbackPresetTomorrowPm: "Tomorrow afternoon",
      callbackPresetCustom:     "Custom",

      // Soft banner when a caller deep-links into a lead held by another caller
      lockedByOther:            (name: string) => `This lead is locked by ${name}.`,
    },

    // ── Call history panel ────────────────────────────────────────────────────
    history: {
      title:              (n: number) => `Call history (${n})`,
      showTranscript:     "▼ Show transcript",
      hideTranscript:     "▲ Hide transcript",
      transcribing:       "⏳ Transcribing…",
      transcriptFailed:   "Transcription failed",
      retry:              "retry",
      getTranscript:      "📝 Get transcript",
      requesting:         "Requesting…",
      networkError:       "Network error",
      aiAnalysis:         "🤖 AI Analysis",
      aiAnalyzeBtn:       "🤖 Organize with AI",
      aiAnalyzing:        "⏳ Analyzing…",
      objections:         "Objections:",
      nextSteps:          "Next steps:",
    },

    // ── Phone review page ─────────────────────────────────────────────────────
    review: {
      title:              "Phone review",
      empty:              "Review queue is empty",
      emptyDetail:        "All phone candidates have been reviewed.",
      rules:              "Approve a number to make the lead callable. Reject to remove it. Retry re-runs the pipeline. Keep unresolved hides without retrying.",
      candidateCount:     (n: number) => `${n} candidate${n === 1 ? "" : "s"} to approve before becoming callable.`,
      noneInFilter:       "No candidates in this confidence filter.",
      approve:            "✓ Approve — make callable",
      reject:             "✗ Reject",
      retryPipeline:      "↺ Retry",
      keepUnresolved:     "Keep unresolved",
      bulkApprove:        "Approve all",
      bulkReject:         "Reject all",
      bulkKeep:           "Keep unresolved",
      approving:          (done: number, total: number) => `Approving… ${done} / ${total}`,
      selected:           (n: number) => `${n} candidate${n !== 1 ? "s" : ""} selected`,
      selectAll:          (n: number) => `Select all (${n})`,
      deselectAll:        (n: number) => `Deselect all (${n})`,
      notePlaceholder:    "Optional note (stored with your decision)",
      openClawAnalysis:   "OpenClaw analysis",
      confidence:         "Confidence:",
      bucketAll:          (n: number) => `All (${n})`,
    },

    // ── Common shared strings ──────────────────────────────────────────────────
    common: {
      skeleton:    "Loading…",
      errorRetry:  "Retry",
    },
  },
} as const;

// TypeScript type extracted from the French branch (canonical)
export type Dict = (typeof dict)["fr"];

export function getDict(locale: Locale): Dict {
  return dict[locale] as unknown as Dict;
}

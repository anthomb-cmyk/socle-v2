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

      // Admin-only scope toggle (caller-tier never sees this UI; server enforces "mine")
      scopeAdminBadge:  "Admin",
      scopeAll:         "Tous les leads",
      scopeMine:        "Assignés à moi",
      scopeUnassigned:  "Non assignés",

      // ── Phase 9 additions ────────────────────────────────────────────────────
      callable:         "Appelables",
      overdueLabel2:    "Retards",
      verified:         "Vérifiés",
      review:           "À réviser",
      search:           "Rechercher (nom, adresse, ville, numéro)…",
      priorityHot:      "Chaud",
      phoneVerified:    "Vérifié",
      phoneReview:      "À réviser",
      phoneNew:         "Nouveau",
      phoneBad:         "Sans tél.",
      colOwner:         "Propriétaire",
      colCampaign:      "Campagne",
      colUnits:         "U.",
      colNumber:        "Numéro",
      colOutcome:       "Dernière issue",
      assignAll:        "Tous les leads",
      assignMine:       "Assignés à moi",
      assignNone:       "Non assignés",
      filterBtn:        "Filtrer",
      start:            "Appeler",
      preview: {
        activeNumber:   "Numéro actif",
        call:           "Appeler",
        notes:          "Notes",
        lastCall:       "Dernier appel",
        units:          "Logements",
        built:          "Construit",
        assessed:       "Évaluation",
      },
      kbd: {
        navigate:       "Naviguer",
        open:           "Ouvrir",
        search:         "Rechercher",
        call:           "Appeler",
        hot:            "Marquer chaud",
      },
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
      hot_seller:     "Vendeur chaud",
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
      callBackLater:        "Rappeler plus tard",
      sendToAnthony:        "Envoyer à Anthony",

      // Twilio call button / states
      call:                 "Appeler",
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
      selectOutcome:        "Appel terminé — sélectionne un résultat ci-dessous",

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
      callbackPresetIn15m:         "Dans 15 min",
      callbackPreset1h:            "Dans 1 h",
      callbackPresetThisAfternoon: "Cet après-midi",
      callbackPresetTomorrowAm:    "Demain matin",
      callbackPresetTomorrowPm:    "Demain après-midi",
      callbackPresetCustom:        "Personnalisé",
      callbackPreview:             (when: string) => `Rappel prévu : ${when}.`,

      // Soft banner when a caller deep-links into a lead held by another caller
      lockedByOther:            (name: string) => `Ce lead est verrouillé par ${name}.`,
      anotherCaller:            "un autre appelant",

      // Phase 4 — workspace cards and panels
      attempts:        (n: number) => `${n} appel${n !== 1 ? "s" : ""}`,
      noPhonesTitle:   "Aucun téléphone approuvé",
      markForReview:   "Marquer pour révision",
      mainPhone:       "Téléphone principal",
      tapToCall:       "Appel direct",
      hangup:          "Raccrocher",
      hangupHint:      "Raccrochez depuis votre téléphone",

      // Submission form labels (values stay as routing keys; only display text changes)
      interestLow:      "Faible",
      interestMid:      "Moyen",
      interestHigh:     "Élevé",
      interestVeryHigh: "Très élevé",
      timelineSoon:     "Moins de 30 j",
      timeline3m:       "1 à 3 mois",
      timeline6m:       "3 à 6 mois",
      timelineLater:    "Plus de 6 mois",
      timelineUnknown:  "Inconnu",

      // Property-card cell labels
      unitsLabel:     "Logements",
      assessedLabel:  "Évaluation",

      // Outcome group sub-headings
      interestOutcome:  "Niveau d'intérêt",
      unreachableGroup: "Pas joignable",
      rejectionGroup:   "Pas intéressé",
      deferGroup:       "À rappeler",
      hotGroup:         "Intéressé ✓",
    },

    // ── Call history panel ────────────────────────────────────────────────────
    history: {
      title:              (n: number) => `Historique des appels (${n})`,
      showTranscript:     "▼ Voir la transcription",
      hideTranscript:     "▲ Masquer la transcription",
      transcribing:       "Transcription en cours…",
      transcriptFailed:   "Transcription échouée",
      retry:              "réessayer",
      getTranscript:      "Obtenir la transcription",
      requesting:         "Demande envoyée…",
      networkError:       "Erreur réseau",
      aiAnalysis:         "Analyse AI",
      aiAnalyzeBtn:       "Organiser avec l'AI",
      aiAnalyzing:        "Analyse en cours…",
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
      approve:            "Approuver — rendre appelable",
      reject:             "Rejeter",
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

      // Phase 5 — split-layout & slide-over copy
      noSelectionTitle:   "Sélectionne un candidat",
      noSelectionSub:     "Touche une ligne pour voir les détails et agir.",
      dismissAria:        "Retour",

      // Phase 6 — evidence panel score + section labels
      scoreHigh:           "Confiance élevée — numéro probablement correct",
      scoreMid:            "Confiance moyenne — vérification recommandée",
      scoreLow:            "Confiance faible — à recouper",
      scoreVeryLow:        "Confiance très faible — probablement incorrect",
      logUnits:            (n: number) => ` · ${n} logement${n !== 1 ? "s" : ""}`,
      mailingAddressPrefix:"Adresse postale :",
      addressFoundPrefix:  "Adresse trouvée :",
      sectionSearchQuery:  "Requête de recherche",
      sectionSourceFinds:  "Ce que la source indique",
      sectionSource:       "Source",
      sectionOpenClaw:     "Analyse OpenClaw",
      noOpenClawNote:      "Pas d'analyse OpenClaw disponible pour ce candidat.",
      verdictLikely:       "Correspond",
      verdictUncertain:    "Incertain",
      verdictUnlikely:     "Ne correspond pas",

      // B-2 — evidence panel chip labels
      evidence: {
        mailingAddress:        "Adresse mail.",
        city:                  "Ville",
        postalPrefix:          "Code postal",
        contactName:           "Nom",
        companyName:           "Compagnie",
        relatedEntity:         "Entité reliée",
        fetchedPage:           "Page lue",
        directory:             (domain: string) => `Annuaire (${domain})`,
        mailingPrefix:         "Mail :",
        nameFound:             "Nom trouvé :",
        sourceAddress:         "Adresse source :",
        query:                 "Requête :",
        showMore:              "[voir plus]",
        showLess:              "[voir moins]",
        tenantWarning:         "Tenant possible — vérifier",
        stageAddress:          "Adresse",
        stageCompany:          "Entreprise",
        matchedMailingAddress: "adresse postale",
        matchedPostal:         "code postal",
        matchedAddressCompany: "co. à l'adresse",
        matchedPropertyAddress:"adresse immeuble",
        matchedCompanyName:    "nom entreprise",
        matchedDirectorName:   "nom directeur",
        matchedRelatedCompany: "co. liée",
        matchedSameAddress:    "co. même adresse",
        matchedPublicDirectory:"annuaire public",
        matchedCompanyWebsite: "site web co.",
        matchedB2BHint:        "B2BHint public",
      },
    },

    // ── Follow-ups page ───────────────────────────────────────────────────────
    followUps: {
      loading:       "Chargement des suivis…",
      emptyTitle:    "Aucun suivi en attente",
      emptySub:      "Tout est à jour. Bon travail !",
      cancelConfirm: "Annuler ce suivi ?",
      overdue:       "En retard",
      today:         "Aujourd'hui",
      upcoming:      "À venir",
      priorityAria:  (n: number) => `Priorité ${n}`,
      viewLead:      "Fiche →",
      done:          "Fait",
      cancel:        "Annuler",
    },


    // ── Dashboard (Phase 9) ───────────────────────────────────────────────────
    dashboard: {
      title:              "Tableau de bord",
      sub:                "Vue d'ensemble des leads, appels et urgences.",
      activeCampaign:     "Campagne active",
      btnImport:          "+ Import rôle",
      btnLeads:           "Leads",
      btnQueue:           "File d'appels",
      btnReview:          "Revue",
      // Urgency banner
      actionRequired:     "Action requise",
      reviewUrgent:       (n: number) => `${n} vendeur${n > 1 ? "s urgents" : " urgent"}`,
      followUpsOverdue:   (n: number) => `${n} suivi${n > 1 ? "s en retard" : " en retard"}`,
      ctaReviews:         "Traiter revues urgentes →",
      ctaFollowUps:       "Suivis en retard →",
      // KPI tiles
      kpiNewLeads:        "Nouveaux leads",
      kpiNewLeadsSub:     "à qualifier",
      kpiPhoneReady:      "Tél. vérifiés",
      kpiPhoneReadySub:   "prêts à appeler",
      kpiUnassigned:      "Non assignés",
      kpiUnassignedSub:   "sans caller",
      kpiInCalls:         "En cours d'appels",
      kpiInCallsSub:      "assignés · actifs",
      kpiUrgentReviews:   "Revues urgentes",
      kpiUrgentReviewsSub:(open: number) => `${open} ouvertes`,
      kpiFollowUps:       "Suivis aujourd'hui",
      kpiOverdueSub:      (n: number) => `${n} en retard`,
      kpiEnrichSub:       (n: number) => `${n} enrichissement`,
      // Panels
      importsTitle:       "Imports récents",
      importsNew:         "Nouveau →",
      importsEmpty:       "Aucun import récent",
      importsEmptySub:    "Importez un rôle d'évaluation foncière pour commencer.",
      callsTitle:         "Activité d'appels",
      callsLink:          "File →",
      callsEmpty:         "Aucune activité récente",
      callsEmptySub:      "Les appels passés apparaîtront ici.",
      sellersTitle:       "Vendeurs urgents",
      sellersLink:        "Tout voir →",
      sellersEmpty:       "File vide",
      sellersEmptySub:    "Aucun vendeur à traiter en ce moment.",
      errorsTitle:        "Erreurs d'automatisation (24 h)",
      errorsEmpty:        "Aucune erreur récente",
      errorsEmptySub:     "Tous les workflows tournent normalement.",
      enrichTitle:        "Enrichissement",
      enrichPipeline:     "Pipeline →",
      enrichPipelineLabel:"dans le pipeline",
      enrichVerified:     (n: number) => `${n} vérifiés`,
      enrichEmpty:        "Aucun enrichissement actif",
      enrichEmptySub:     "Le pipeline est vide.",
      // Status labels
      statusCompleted:    "Terminé",
      statusProcessing:   "En cours",
      statusFailed:       "Échec",
      statusPending:      "En attente",
      openLead:           "Ouvrir →",
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

      // Admin-only scope toggle
      scopeAdminBadge:  "Admin",
      scopeAll:         "All leads",
      scopeMine:        "Assigned to me",
      scopeUnassigned:  "Unassigned",

      // ── Phase 9 additions ────────────────────────────────────────────────────
      callable:         "Callable",
      overdueLabel2:    "Overdue",
      verified:         "Verified",
      review:           "To review",
      search:           "Search (name, address, city, number)…",
      priorityHot:      "Hot",
      phoneVerified:    "Verified",
      phoneReview:      "To review",
      phoneNew:         "New",
      phoneBad:         "No phone",
      colOwner:         "Owner",
      colCampaign:      "Campaign",
      colUnits:         "U.",
      colNumber:        "Number",
      colOutcome:       "Last outcome",
      assignAll:        "All leads",
      assignMine:       "Assigned to me",
      assignNone:       "Unassigned",
      filterBtn:        "Filter",
      start:            "Call",
      preview: {
        activeNumber:   "Active number",
        call:           "Call",
        notes:          "Notes",
        lastCall:       "Last call",
        units:          "Units",
        built:          "Built",
        assessed:       "Assessed",
      },
      kbd: {
        navigate:       "Navigate",
        open:           "Open",
        search:         "Search",
        call:           "Call",
        hot:            "Toggle hot",
      },
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
      hot_seller:      "Hot seller",
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
      callBackLater:        "Call back later",
      sendToAnthony:        "Send to Anthony",

      // Twilio call button / states
      call:                 "Call",
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
      selectOutcome:        "Call ended — select an outcome below",

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
      callbackPresetIn15m:         "In 15 min",
      callbackPreset1h:            "In 1 h",
      callbackPresetThisAfternoon: "This afternoon",
      callbackPresetTomorrowAm:    "Tomorrow morning",
      callbackPresetTomorrowPm:    "Tomorrow afternoon",
      callbackPresetCustom:        "Custom",
      callbackPreview:             (when: string) => `Callback: ${when}.`,

      // Soft banner when a caller deep-links into a lead held by another caller
      lockedByOther:            (name: string) => `This lead is locked by ${name}.`,
      anotherCaller:            "another caller",

      // Phase 4 — workspace cards and panels
      attempts:        (n: number) => `${n} attempt${n !== 1 ? "s" : ""}`,
      noPhonesTitle:   "No approved phone",
      markForReview:   "Mark for review",
      mainPhone:       "Main phone",
      tapToCall:       "Direct dial",
      hangup:          "Hang up",
      hangupHint:      "End the call from your phone",

      // Submission form labels
      interestLow:      "Low",
      interestMid:      "Medium",
      interestHigh:     "High",
      interestVeryHigh: "Very high",
      timelineSoon:     "Within 30 d",
      timeline3m:       "1–3 months",
      timeline6m:       "3–6 months",
      timelineLater:    "More than 6 months",
      timelineUnknown:  "Unknown",

      // Property-card cell labels
      unitsLabel:     "Units",
      assessedLabel:  "Assessed",

      // Outcome group sub-headings
      interestOutcome:  "Interest level",
      unreachableGroup: "Couldn't reach",
      rejectionGroup:   "Not interested",
      deferGroup:       "Call back",
      hotGroup:         "Interested ✓",
    },

    // ── Call history panel ────────────────────────────────────────────────────
    history: {
      title:              (n: number) => `Call history (${n})`,
      showTranscript:     "▼ Show transcript",
      hideTranscript:     "▲ Hide transcript",
      transcribing:       "Transcribing…",
      transcriptFailed:   "Transcription failed",
      retry:              "retry",
      getTranscript:      "Get transcript",
      requesting:         "Requesting…",
      networkError:       "Network error",
      aiAnalysis:         "AI Analysis",
      aiAnalyzeBtn:       "Organize with AI",
      aiAnalyzing:        "Analyzing…",
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
      approve:            "Approve — make callable",
      reject:             "Reject",
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

      // Phase 5 — split-layout & slide-over copy
      noSelectionTitle:   "Select a candidate",
      noSelectionSub:     "Tap a row to see the details and act.",
      dismissAria:        "Back",

      // Phase 6 — evidence panel score + section labels
      scoreHigh:           "High confidence — number is likely correct",
      scoreMid:            "Medium confidence — verification recommended",
      scoreLow:            "Low confidence — cross-check advised",
      scoreVeryLow:        "Very low confidence — likely incorrect",
      logUnits:            (n: number) => ` · ${n} unit${n !== 1 ? "s" : ""}`,
      mailingAddressPrefix:"Mailing address:",
      addressFoundPrefix:  "Address found:",
      sectionSearchQuery:  "Search query",
      sectionSourceFinds:  "What the source shows",
      sectionSource:       "Source",
      sectionOpenClaw:     "OpenClaw analysis",
      noOpenClawNote:      "No OpenClaw analysis available for this candidate.",
      verdictLikely:       "Matches",
      verdictUncertain:    "Uncertain",
      verdictUnlikely:     "Does not match",

      // B-2 — evidence panel chip labels
      evidence: {
        mailingAddress:        "Mailing addr.",
        city:                  "City",
        postalPrefix:          "Postal",
        contactName:           "Name",
        companyName:           "Company",
        relatedEntity:         "Related entity",
        fetchedPage:           "Page read",
        directory:             (domain: string) => `Directory (${domain})`,
        mailingPrefix:         "Mail:",
        nameFound:             "Name found:",
        sourceAddress:         "Source address:",
        query:                 "Query:",
        showMore:              "[show more]",
        showLess:              "[show less]",
        tenantWarning:         "Possible tenant — verify",
        stageAddress:          "Address",
        stageCompany:          "Company",
        matchedMailingAddress: "mailing address",
        matchedPostal:         "postal code",
        matchedAddressCompany: "co. at address",
        matchedPropertyAddress:"property address",
        matchedCompanyName:    "company name",
        matchedDirectorName:   "director name",
        matchedRelatedCompany: "related co.",
        matchedSameAddress:    "same addr. co.",
        matchedPublicDirectory:"public directory",
        matchedCompanyWebsite: "company website",
        matchedB2BHint:        "B2BHint public",
      },
    },

    // ── Follow-ups page ───────────────────────────────────────────────────────
    followUps: {
      loading:       "Loading follow-ups…",
      emptyTitle:    "No pending follow-ups",
      emptySub:      "All up to date. Good work!",
      cancelConfirm: "Cancel this follow-up?",
      overdue:       "Overdue",
      today:         "Today",
      upcoming:      "Upcoming",
      priorityAria:  (n: number) => `Priority ${n}`,
      viewLead:      "Lead →",
      done:          "Done",
      cancel:        "Cancel",
    },


    // ── Dashboard (Phase 9) ───────────────────────────────────────────────────
    dashboard: {
      title:              "Dashboard",
      sub:                "Overview of leads, calls and urgent items.",
      activeCampaign:     "Active campaign",
      btnImport:          "+ Import role",
      btnLeads:           "Leads",
      btnQueue:           "Call queue",
      btnReview:          "Review",
      // Urgency banner
      actionRequired:     "Action required",
      reviewUrgent:       (n: number) => `${n} urgent seller${n > 1 ? "s" : ""}`,
      followUpsOverdue:   (n: number) => `${n} overdue follow-up${n > 1 ? "s" : ""}`,
      ctaReviews:         "Handle urgent reviews →",
      ctaFollowUps:       "Overdue follow-ups →",
      // KPI tiles
      kpiNewLeads:        "New leads",
      kpiNewLeadsSub:     "to qualify",
      kpiPhoneReady:      "Verified phones",
      kpiPhoneReadySub:   "ready to call",
      kpiUnassigned:      "Unassigned",
      kpiUnassignedSub:   "no caller",
      kpiInCalls:         "In progress",
      kpiInCallsSub:      "assigned · active",
      kpiUrgentReviews:   "Urgent reviews",
      kpiUrgentReviewsSub:(open: number) => `${open} open`,
      kpiFollowUps:       "Follow-ups today",
      kpiOverdueSub:      (n: number) => `${n} overdue`,
      kpiEnrichSub:       (n: number) => `${n} enrichment`,
      // Panels
      importsTitle:       "Recent imports",
      importsNew:         "New →",
      importsEmpty:       "No recent imports",
      importsEmptySub:    "Import a land-evaluation role to get started.",
      callsTitle:         "Call activity",
      callsLink:          "Queue →",
      callsEmpty:         "No recent activity",
      callsEmptySub:      "Completed calls will appear here.",
      sellersTitle:       "Urgent sellers",
      sellersLink:        "See all →",
      sellersEmpty:       "Queue empty",
      sellersEmptySub:    "No sellers to handle right now.",
      errorsTitle:        "Automation errors (24 h)",
      errorsEmpty:        "No recent errors",
      errorsEmptySub:     "All workflows running normally.",
      enrichTitle:        "Enrichment",
      enrichPipeline:     "Pipeline →",
      enrichPipelineLabel:"in the pipeline",
      enrichVerified:     (n: number) => `${n} verified`,
      enrichEmpty:        "No active enrichment",
      enrichEmptySub:     "The pipeline is empty.",
      // Status labels
      statusCompleted:    "Completed",
      statusProcessing:   "Processing",
      statusFailed:       "Failed",
      statusPending:      "Pending",
      openLead:           "Open →",
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

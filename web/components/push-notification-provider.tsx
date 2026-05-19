"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast-provider";

type PushState = "checking" | "unsupported" | "missing-config" | "ready" | "subscribed" | "denied" | "error";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getVapidPublicKey() {
  const res = await fetch("/api/push/vapid-public-key", { cache: "no-store" });
  const json = await res.json();
  if (!json.ok || !json.enabled || !json.publicKey) return "";
  return String(json.publicKey);
}

async function registerServiceWorker() {
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return registration;
}

export function PushNotificationProvider() {
  const { showToast } = useToast();
  const [state, setState] = useState<PushState>("checking");
  const [dismissed, setDismissed] = useState(true);

  const subscribe = useCallback(async (sendTest = false) => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        showToast({ message: "Notifications iPhone non supportées sur cet appareil.", tone: "error" });
        return;
      }

      const publicKey = await getVapidPublicKey();
      if (!publicKey) {
        setState("missing-config");
        showToast({ message: "Notifications non configurées côté serveur.", tone: "error" });
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "ready");
        return;
      }

      const registration = await registerServiceWorker();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Subscription failed");

      setState("subscribed");
      localStorage.setItem("socle_push_prompt_dismissed", "1");
      setDismissed(true);
      showToast({ message: "Notifications iPhone activées.", tone: "success" });

      if (sendTest) {
        await fetch("/api/push/test", { method: "POST" }).catch(() => {});
      }
    } catch {
      setState("error");
      showToast({ message: "Impossible d'activer les notifications.", tone: "error" });
    }
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }

      const hidden = localStorage.getItem("socle_push_prompt_dismissed") === "1";
      if (!cancelled) setDismissed(hidden);

      const publicKey = await getVapidPublicKey().catch(() => "");
      if (!publicKey) {
        if (!cancelled) setState("missing-config");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      if (Notification.permission === "granted") {
        try {
          const registration = await registerServiceWorker();
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await fetch("/api/push/subscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(subscription.toJSON()),
            });
            if (!cancelled) setState("subscribed");
          } else if (!cancelled) {
            setState("ready");
            setDismissed(false);
          }
        } catch {
          if (!cancelled) setState("error");
        }
        return;
      }

      if (!cancelled) {
        setState("ready");
        setDismissed(hidden);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state !== "ready" || dismissed) return null;

  return (
    <div className="crm-push-pill" role="region" aria-label="Notifications iPhone">
      <div>
        <strong>Notifications iPhone</strong>
        <span>Recevoir les appels, textos et alertes importantes.</span>
      </div>
      <button type="button" onClick={() => subscribe(true)}>Activer</button>
      <button
        type="button"
        className="crm-push-pill__close"
        aria-label="Masquer"
        onClick={() => {
          localStorage.setItem("socle_push_prompt_dismissed", "1");
          setDismissed(true);
        }}
      >
        x
      </button>
    </div>
  );
}

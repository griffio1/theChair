"use client";

import { useEffect, useId, useRef, useState } from "react";
import { captchaProof, CAPTCHA_LIFETIME_MS, type CaptchaAction, type CaptchaProof } from "../lib/captcha-policy";
import "./captcha.css";

export const captchaSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();

type Turnstile = {
  ready: (callback: () => void) => void;
  render: (container: HTMLElement, options: {
    sitekey: string; action: CaptchaAction; theme: "light" | "dark"; size: "compact" | "flexible";
    tabindex: number; retry: "never"; "refresh-expired": "manual"; "refresh-timeout": "manual";
    "response-field": boolean; callback: (token: string) => void;
    "error-callback": () => boolean; "expired-callback": () => void;
    "timeout-callback": () => void; "unsupported-callback": () => void;
  }) => string | undefined;
  remove: (widget: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let scriptPromise: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Turnstile>((resolve,reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (error = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error || !window.turnstile) {
        script.remove();
        reject(new Error("Verification unavailable"));
      } else resolve(window.turnstile);
    };
    const timeout = window.setTimeout(() => finish(true),15_000);
    if (window.turnstile) { window.turnstile.ready(() => finish()); return; }
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    if (nonce) script.nonce = nonce;
    script.onload = () => window.turnstile ? window.turnstile.ready(() => finish()) : finish(true);
    script.onerror = () => finish(true);
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = undefined; throw error; });
  return scriptPromise;
}

/** One script per page; each form owns and cleans up its own explicit widget. */
export function Captcha({action,resetKey,onToken,disabled = false}: {
  action: CaptchaAction; resetKey: number; onToken: (proof: CaptchaProof) => void; disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const id = useId();
  const [retry,setRetry] = useState(0);
  const [compact,setCompact] = useState(false);
  const [theme,setTheme] = useState<"light" | "dark">("light");
  const [status,setStatus] = useState("Loading verification…");
  const [failed,setFailed] = useState(false);

  useEffect(() => {
    if (!captchaSiteKey || !container.current) return;
    const element = container.current;
    const measure = () => setCompact(element.clientWidth < 300);
    const appearance = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    measure(); appearance();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const changes = new MutationObserver(appearance);
    changes.observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    return () => { resize.disconnect(); changes.disconnect(); };
  },[]);

  useEffect(() => {
    if (!captchaSiteKey || !container.current) return;
    let active = true;
    let widget: string | undefined;
    let provider: Turnstile | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    callback.current(null);
    setFailed(false); setStatus("Loading verification…");
    const invalidate = (message: string) => {
      if (!active) return;
      clearTimeout(expiry);
      callback.current(null);
      setFailed(true); setStatus(message);
    };
    void loadTurnstile().then(api => {
      if (!active || !container.current) return;
      provider = api;
      setStatus("Complete the verification below.");
      widget = api.render(container.current,{
        sitekey:captchaSiteKey, action, theme, size:compact ? "compact" : "flexible", tabindex:0,
        retry:"never", "refresh-expired":"manual", "refresh-timeout":"manual", "response-field":false,
        callback: token => {
          if (!active) return;
          const proof = captchaProof(token);
          if (!proof) { invalidate("Verification failed. Try again."); return; }
          clearTimeout(expiry);
          callback.current(proof); setFailed(false); setStatus("Verified.");
          expiry = setTimeout(() => invalidate("Verification expired. Try again."),CAPTCHA_LIFETIME_MS);
        },
        "error-callback": () => { invalidate("Verification failed. Try again."); return true; },
        "expired-callback": () => invalidate("Verification expired. Try again."),
        "timeout-callback": () => invalidate("Verification timed out. Try again."),
        "unsupported-callback": () => invalidate("Verification is unavailable in this browser. Try another browser."),
      });
      if (!widget) invalidate("Verification is unavailable. Try again.");
    }).catch(() => invalidate("Couldn’t load verification. Check your connection and try again."));
    return () => {
      active = false;
      clearTimeout(expiry);
      callback.current(null);
      if (widget && provider) { try { provider.remove(widget); } catch {} }
    };
  },[action,resetKey,retry,compact,theme]);

  if (!captchaSiteKey) return null;
  return <div className="chair-captcha" role="group" aria-label="Security verification" aria-describedby={id}>
    <div ref={container} className={`chair-captcha-widget${compact ? " compact" : ""}`} />
    <p id={id} role={failed ? "alert" : "status"}>{status}</p>
    {failed && <button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Retry verification</button>}
  </div>;
}

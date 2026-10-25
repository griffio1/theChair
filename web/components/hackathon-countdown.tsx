"use client";

import {useEffect, useState} from "react";
import {deadlineRemaining} from "../lib/project-editor";
import "./hackathon-countdown.css";

export function HackathonCountdown({deadline}: {deadline: string}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange", update);};
  }, [deadline]);
  const remaining = now === null ? null : deadlineRemaining(deadline, now);
  if (!remaining) return null;
  return <section className={`hackathon-countdown${remaining.ended ? " ended" : ""}`} aria-label="Hackathon deadline">
    <div className="hackathon-countdown-heading"><h2>{remaining.ended ? "Time’s up" : "Time left"}</h2><span>Hackathon</span></div>
    <div className="hackathon-clock" role="timer" aria-live="off">
      {([['days', remaining.days], ['hours', remaining.hours], ['minutes', remaining.minutes], ['seconds', remaining.seconds]] as const).map(([unit, amount]) =>
        <div key={unit}><strong>{String(amount).padStart(2, "0")}</strong><span>{unit}</span></div>)}
    </div>
    <p>Deadline: <time dateTime={deadline}>{new Date(deadline).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})}</time></p>
  </section>;
}

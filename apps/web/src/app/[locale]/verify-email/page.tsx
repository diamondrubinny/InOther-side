"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, Loading } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api";
import { readHashToken } from "@/lib/hash-token";

export default function VerifyEmailPage() {
  const { locale, messages } = useI18n();
  const t = messages.auth;
  const [state, setState] = useState<"working" | "ok" | "fail">("working");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the token is single-use: never send it twice (React strict mode)
    ran.current = true;
    const token = readHashToken();
    if (!token) return setState("fail");
    api("POST", "/auth/verify-email", { token })
      .then(() => setState("ok"))
      .catch(() => setState("fail"));
  }, []);

  return (
    <div className="container section narrow">
      <div className="card stack">
        <h1>{t.verifyTitle}</h1>
        {state === "working" && <Loading />}
        {state === "ok" && (
          <>
            <Alert kind="success">{t.verified}</Alert>
            <Link className="btn" href={`/${locale}/login`}>{messages.nav.login}</Link>
          </>
        )}
        {state === "fail" && <Alert kind="error">{t.verifyFailed}</Alert>}
      </div>
    </div>
  );
}

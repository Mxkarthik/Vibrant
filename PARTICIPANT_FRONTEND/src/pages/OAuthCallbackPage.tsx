import { useEffect, useState } from "react";

type Result = { kind: "loading" } | { kind: "success"; name: string } | { kind: "denied"; role: string } | { kind: "error"; message: string };
const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

export default function OAuthCallbackPage() {
  const [result, setResult] = useState<Result>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const failed = new URLSearchParams(window.location.search).get("error");
    if (failed) {
      setResult({ kind: "error", message: "Google sign-in could not be completed. Please return and try again." });
      return () => controller.abort();
    }

    fetch(`${apiBase}/api/auth/me`, { credentials: "include", headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("We could not confirm your sign-in. Please try again.");
        return response.json() as Promise<{ user: { name: string; role: string } }>;
      })
      .then(({ user }) => {
        if (user.role === "PARTICIPANT") setResult({ kind: "success", name: user.name });
        else setResult({ kind: "denied", role: user.role });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ kind: "error", message: error instanceof Error ? error.message : "We could not confirm your sign-in. Please try again." });
      });
    return () => controller.abort();
  }, []);

  const title = result.kind === "success" ? `Welcome, ${result.name}.` : result.kind === "denied" ? "This account cannot enter the Participant Portal." : result.kind === "loading" ? "Confirming your account…" : "Sign-in needs another try.";
  const description = result.kind === "success"
    ? "Your participant account is ready. The VIBRANT2K26 experience will continue to grow here."
    : result.kind === "denied"
      ? `This Google account is registered with the ${result.role.toLowerCase()} role. Participant access is reserved for participant accounts.`
      : result.kind === "loading" ? "We’re securely checking your VIBRANT session." : result.message;

  return (
    <main className="auth-result-page">
      <section className="auth-result-card" aria-live="polite">
        <a className="auth-brand" href="/">VIBRANT<span>2K26</span></a>
        <p className="auth-kicker">PARTICIPANT PORTAL · DIET ANAKAPALLE</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {result.kind === "loading" ? <span className="auth-loading-line" aria-label="Loading" /> : <a className="button button-dark" href="/">Return to VIBRANT <span aria-hidden="true">↗</span></a>}
      </section>
    </main>
  );
}

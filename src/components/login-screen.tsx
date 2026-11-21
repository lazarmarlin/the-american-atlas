import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";

export function AtlasSplash({ label }: { label: string }) {
  return (
    <main className="h-app safe-x grid place-items-center bg-bg text-ink">
      <div className="px-6 text-center">
        <p className="text-xs tracking-widest text-faint uppercase">Field atlas</p>
        <h1 className="mt-2 font-serif text-4xl">The American Atlas</h1>
        <p className="mt-3 text-sm text-muted">{label}</p>
      </div>
    </main>
  );
}

export function LoginScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === "up") {
        const result = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.trim().split("@")[0] || "Traveler",
          callbackURL: "/",
        });
        if (result.error) {
          setError(result.error.message ?? "Couldn't create that account.");
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: "/",
        });
        if (result.error) {
          setError(result.error.message ?? "Email or password didn't match.");
          return;
        }
      }
      await navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in didn't go through.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="h-app safe-x safe-top safe-bottom grid place-items-center bg-bg text-ink">
      <div className="w-full max-w-sm px-2">
        <p className="text-xs tracking-widest text-faint uppercase">Field atlas</p>
        <h1 className="mt-2 font-serif text-4xl leading-none">The American Atlas</h1>
        <p className="mt-3 text-sm text-muted">Sign in so the places you add stay with your account.</p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === "up" ? (
            <label className="block text-xs text-muted">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="mt-1 h-12 w-full rounded-card border border-line bg-surface px-3 text-base text-ink outline-none"
              />
            </label>
          ) : null}
          <label className="block text-xs text-muted">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              className="mt-1 h-12 w-full rounded-card border border-line bg-surface px-3 text-base text-ink outline-none"
            />
          </label>
          <label className="block text-xs text-muted">
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              className="mt-1 h-12 w-full rounded-card border border-line bg-surface px-3 text-base text-ink outline-none"
            />
          </label>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="h-12 w-full rounded-card bg-accent text-sm font-medium text-accent-ink disabled:opacity-60"
          >
            {pending ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setError(null);
          }}
          className="mt-3 h-11 w-full text-sm text-muted"
        >
          {mode === "in" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>

        <div className="my-4 flex items-center gap-3 text-xs tracking-wide text-faint uppercase">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="space-y-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="h-12 w-full rounded-card border border-line bg-surface text-sm text-ink"
            >
              Continue with {provider.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

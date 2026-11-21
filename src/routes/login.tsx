import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AtlasSplash, LoginScreen } from "@/components/login-screen";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <AtlasSplash label="Opening the atlas…" />;
  if (user) return <Navigate to="/" />;
  return <LoginScreen />;
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthPage } from "@/components/auth/auth-page";
import { useSettledSession } from "@/components/auth/use-settled-session";
import { Button } from "@/components/ui/button";
import { acceptInvitationLink } from "@/fetchers/invitation/invitation-link";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/invitation/link")({
  component: InvitationLink,
});

function InvitationLink() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, isLoading } = useSettledSession();
  const [pending, setPending] = useState(false);
  const token = window.location.hash.slice(1);

  return (
    <AuthPage
      title={t("team:inviteModal.linkAcceptTitle")}
      description={t("team:inviteModal.linkAcceptDescription")}
    >
      {!isLoading &&
        (session?.user ? (
          <Button
            disabled={pending || !/^[A-Za-z0-9_-]{43}$/.test(token)}
            onClick={async () => {
              setPending(true);
              try {
                await acceptInvitationLink(token);
                window.history.replaceState(null, "", window.location.pathname);
                await navigate({ to: "/dashboard" });
              } catch {
                toast.error(t("team:inviteModal.linkAcceptError"));
              } finally {
                setPending(false);
              }
            }}
          >
            {t("team:inviteModal.linkAccept")}
          </Button>
        ) : (
          <Link
            to="/auth/sign-in"
            search={{ redirect: `/invitation/link#${token}` }}
          >
            {t("auth:signIn.title")}
          </Link>
        ))}
    </AuthPage>
  );
}

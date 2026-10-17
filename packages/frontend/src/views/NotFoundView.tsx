import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/t";

/** Catch-all route: an address the app does not know gets a real page with one way back. */
export default function NotFoundView() {
  const t = useT();
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div role="alert" className="mx-auto max-w-md space-y-4 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><Compass className="h-6 w-6" aria-hidden="true" /></span>
        <h1 className="text-xl font-semibold">{t("shell.notFound.title")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{t("shell.notFound.body")}</p>
        <Button asChild variant="cta"><Link to="/">{t("shell.notFound.home")}</Link></Button>
      </div>
    </div>
  );
}

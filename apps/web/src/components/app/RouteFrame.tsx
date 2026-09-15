import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { H1 } from "@/components/ui/typography";
import { exportUrl } from "@/api";
import { StatusPill } from "@/components/ui";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Button as AppButton } from "@/components/ui";
import { Separator } from "@/components/ui/separator";
import { useWorkbench } from "@/workbench/context";
import type { Robot } from "@/types";

type RouteFrameProps = {
  children: ReactNode;
  robot: Robot | null;
  sessionId: string | null;
  error: string | null;
  message: string;
  onDismissError: () => void;
};

export function RouteFrame({
  children,
  robot,
  sessionId,
  error,
  message,
  onDismissError,
}: RouteFrameProps) {
  const workspace = useWorkbench();
  const navigation = [
    ["/teach/pose", "Pose"],
    ["/teach/timeline", "Timeline"],
    ["/teach/camera", "Camera"],
    ["/archive", "Archive"],
    ["/train", "Train"],
    ["/evaluate", "Evaluate"],
  ] as const;

  return (
    <main className="app-shell route-shell">
      <header className="topbar">
        <Link className="brand-lockup brand-link" to="/teach/pose">
          <div className="brand-mark">⌁</div>
          <div>
            <div className="eyebrow">ROBOTICS LAB / 01</div>
            <H1>Learning Workbench</H1>
          </div>
        </Link>
        <div className="topbar-actions">
          <StatusPill online={Boolean(sessionId)}>
            {sessionId ? "Session live" : "No session"}
          </StatusPill>
          {sessionId && (
            <AppButton variant="ghost" size="small" asChild>
              <a href={exportUrl(sessionId)}>Export session</a>
            </AppButton>
          )}
        </div>
      </header>
      <nav className="route-nav" aria-label="Workbench pages">
        {navigation.map(([href, label]) => (
          <NavLink
            className={({ isActive }) =>
              `route-nav-link ${isActive ? "active" : ""}`
            }
            to={href}
            key={href}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="route-context">
        <span>{workspace.robot?.name ?? robot?.name ?? "No robot loaded"}</span>
        <span>·</span>
        <span>{message}</span>
      </div>
      {error && (
        <Alert
          variant="destructive"
          className="mt-3 flex items-center gap-2 border-alert-border bg-alert-bg text-alert-text py-2"
        >
          <AlertTitle className="text-alert-title font-semibold text-xs m-0 col-start-1">
            Attention
          </AlertTitle>
          <AlertDescription className="col-start-1 text-alert-text text-xs">
            {error}
          </AlertDescription>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismissError}
            className="ml-auto h-auto p-1 text-[19px] text-inherit hover:bg-transparent hover:text-inherit border-0"
          >
            ×
          </Button>
        </Alert>
      )}
      <Separator className="my-1 hidden" />
      {children}
      <footer className="footer">
        <span>FastAPI · PyBullet · PyTorch · Three.js</span>
        <span>Robot teaching workspace / routed session</span>
      </footer>
    </main>
  );
}

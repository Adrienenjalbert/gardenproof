/** Always-visible indicators of how the system is running (safe mode, demo AI, simulator, local publishing). */
import type { ShellInfo } from "@/lib/dashboard/queries";
import { Badge } from "@/components/ui/primitives";

export function SafeModeBadge({ on }: { on: boolean }) {
  return on ? (
    <Badge tone="olive" icon="shieldCheck" title="Customer messages are held until you approve them">
      Safe mode on
    </Badge>
  ) : (
    <Badge tone="red" icon="shield" title="Customer messages send immediately">
      Safe mode off
    </Badge>
  );
}

export function ModeBadges({ info, compact }: { info: ShellInfo; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SafeModeBadge on={info.safeMode} />
      {info.demoAI && (
        <Badge tone="amber" icon="wand" title="No ANTHROPIC_API_KEY: copy is produced by the deterministic demo generator">
          Demo AI
        </Badge>
      )}
      {!compact && info.simulatorMessaging && (
        <Badge tone="neutral" icon="phone" title="WhatsApp is simulated at /simulator">
          Simulator
        </Badge>
      )}
      {!compact && info.localPublishing && (
        <Badge tone="neutral" icon="globe" title="Publishing writes a local preview instead of WordPress">
          Local publishing
        </Badge>
      )}
    </div>
  );
}

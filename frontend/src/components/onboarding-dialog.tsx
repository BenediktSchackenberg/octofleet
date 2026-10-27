"use client";

import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, Terminal, FileJson, Monitor, Eye, EyeOff } from "lucide-react";

interface OnboardingData {
  command: string;
  apiUrl: string;
  apiKey: string;
}

interface OnboardingDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const WINDOWS_CONFIG_PATH = "C:\\ProgramData\\Octofleet\\service-config.json";
const WINDOWS_RESTART_COMMAND = "Restart-Service OctofleetNodeAgent";
const KEY_MASK = "••••••••••••";

/** Quotes a value for a POSIX shell command line. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * install.sh from this server, which then takes agent.sh and the unit from the server as well.
 * Downloaded first and then run: with `curl ... | sudo bash` a failed download still ends with success.
 */
function linuxCommand(apiUrl: string, apiKey: string): string {
  const installer = `${apiUrl}/api/v1/agent/releases/linux/install.sh`;
  return `f=$(mktemp) && curl -fsSL ${shellQuote(installer)} -o "$f" && sudo bash "$f" --api-url ${shellQuote(apiUrl)} --api-key ${shellQuote(apiKey)}`;
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0">{n}</div>
      <div className="flex-1 min-w-0 pt-1">
        <p className="text-sm font-medium">{title}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

/** A command or path with a copy button next to it (not on top of it). */
function CodeLine({ display, value, copied, onCopy, color = "text-green-400" }: {
  display: string; value: string; copied: boolean; onCopy: (value: string) => void; color?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2">
      <pre className={`flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono ${color} whitespace-pre-wrap break-all`}>
        {display}
      </pre>
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8 shrink-0"
        title={copied ? t("onboarding.copied") : t("onboarding.copy")}
        aria-label={copied ? t("onboarding.copied") : t("onboarding.copy")}
        onClick={() => onCopy(value)}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** Compact segmented control used for the OS and the install method. */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value ? "bg-purple-500/15 text-purple-300" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OnboardingDialog({ trigger, open, onOpenChange }: OnboardingDialogProps) {
  const { t } = useI18n();
  const [data, setData] = useState<OnboardingData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [os, setOs] = useState<"windows" | "linux">("windows");
  const [activeTab, setActiveTab] = useState<"auto" | "manual">("auto");
  const [showKey, setShowKey] = useState(false);
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    if (!dialogOpen) return;
    apiClient.get<OnboardingData>("/onboarding/install-command", { showErrorToast: false })
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, [dialogOpen]);

  const copyToClipboard = async (text: string, label: string) => {
    if (!(await copyText(text))) {
      toast.error(t("onboarding.copyFailed"));
      return;
    }
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // The API key is shown masked unless the user asks for it; copying always uses the real value.
  const mask = (text: string) => (showKey || !data?.apiKey ? text : text.split(data.apiKey).join(KEY_MASK));

  const config = {
    InventoryApiUrl: data?.apiUrl || "",
    InventoryApiKey: data?.apiKey || "",
    AutoPushInventory: true,
    AutoStart: true,
    ScheduledPushEnabled: true,
    ScheduledPushIntervalMinutes: 30,
    DisplayName: ""
  };

  const downloadConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "service-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const windowsCommand = data?.command || "";
  const linuxInstall = data ? linuxCommand(data.apiUrl, data.apiKey) : "";
  const loading = t("onboarding.loading");

  const keyToggle = data?.apiKey ? (
    <button
      type="button"
      onClick={() => setShowKey((v) => !v)}
      className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
    >
      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {showKey ? t("onboarding.hideKey") : t("onboarding.showKey")}
    </button>
  ) : null;

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}
      {/* min-w-0 keeps long lines (commands, the config preview) from widening the dialog */}
      <DialogContent className="max-w-2xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Monitor className="h-5 w-5 text-purple-400" />
            {t("onboarding.title")}
          </DialogTitle>
          <DialogDescription>{t("onboarding.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            value={os}
            onChange={setOs}
            options={[
              { value: "windows", label: "Windows" },
              { value: "linux", label: "Linux" },
            ]}
          />
          {os === "windows" && (
            <Segmented
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: "auto", label: t("onboarding.automatic"), icon: <Terminal className="h-3.5 w-3.5" /> },
                { value: "manual", label: t("onboarding.manual"), icon: <FileJson className="h-3.5 w-3.5" /> },
              ]}
            />
          )}
        </div>

        {os === "windows" && activeTab === "auto" && (
          <div className="space-y-4">
            <Step n={1} title={t("onboarding.windows.step1")} />
            <Step n={2} title={t("onboarding.runCommand")}>
              <CodeLine
                display={windowsCommand ? mask(windowsCommand) : loading}
                value={windowsCommand}
                copied={copied === "windows"}
                onCopy={(v) => v && copyToClipboard(v, "windows")}
              />
              <div className="mt-1.5">{keyToggle}</div>
            </Step>
            <Step n={3} title={t("onboarding.done")}>
              <p className="text-xs text-zinc-500">{t("onboarding.appearsSoon")}</p>
            </Step>
            <p className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-400">
              <strong className="text-zinc-300">{t("onboarding.whatThisDoes")}</strong> {t("onboarding.windows.whatText")}
            </p>
          </div>
        )}

        {os === "windows" && activeTab === "manual" && (
          <div className="space-y-4">
            <Step n={1} title={t("onboarding.manualSteps.step1")}>
              <Button variant="outline" size="sm" onClick={downloadConfig}>
                <Download className="h-4 w-4 mr-2" /> {t("onboarding.manualSteps.download")}
              </Button>
            </Step>
            <Step n={2} title={t("onboarding.manualSteps.step2")}>
              <CodeLine
                display={WINDOWS_CONFIG_PATH}
                value={WINDOWS_CONFIG_PATH}
                color="text-cyan-400"
                copied={copied === "path"}
                onCopy={(v) => copyToClipboard(v, "path")}
              />
            </Step>
            <Step n={3} title={t("onboarding.manualSteps.step3")}>
              <p className="text-xs text-zinc-400">
                {t("onboarding.manualSteps.step3Before")}{" "}
                <a href="https://github.com/BenediktSchackenberg/octofleet/releases/latest" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">GitHub Releases</a>{" "}
                {t("onboarding.manualSteps.step3After")}
              </p>
            </Step>
            <Step n={4} title={t("onboarding.manualSteps.step4")}>
              <CodeLine
                display={WINDOWS_RESTART_COMMAND}
                value={WINDOWS_RESTART_COMMAND}
                copied={copied === "restart"}
                onCopy={(v) => copyToClipboard(v, "restart")}
              />
            </Step>
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs text-zinc-400 font-medium">{t("onboarding.manualSteps.preview")}</p>
                {keyToggle}
              </div>
              <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all">
                {mask(JSON.stringify({
                  ...config,
                  InventoryApiUrl: config.InventoryApiUrl || "http://your-server:8080",
                  InventoryApiKey: config.InventoryApiKey || "your-api-key",
                }, null, 2))}
              </pre>
            </div>
          </div>
        )}

        {os === "linux" && (
          <div className="space-y-4">
            <Step n={1} title={t("onboarding.linux.step1")}>
              <p className="text-xs text-zinc-500">{t("onboarding.linux.requirements")}</p>
            </Step>
            <Step n={2} title={t("onboarding.runCommand")}>
              <CodeLine
                display={linuxInstall ? mask(linuxInstall) : loading}
                value={linuxInstall}
                copied={copied === "linux"}
                onCopy={(v) => v && copyToClipboard(v, "linux")}
              />
              <div className="mt-1.5">{keyToggle}</div>
            </Step>
            <Step n={3} title={t("onboarding.done")}>
              <p className="text-xs text-zinc-500">{t("onboarding.appearsSoon")}</p>
            </Step>
            <p className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-400">
              <strong className="text-zinc-300">{t("onboarding.whatThisDoes")}</strong> {t("onboarding.linux.whatText")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

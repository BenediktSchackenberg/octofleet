"use client";

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, Terminal, FileJson, Monitor } from "lucide-react";

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

export function OnboardingDialog({ trigger, open, onOpenChange }: OnboardingDialogProps) {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"auto" | "manual">("auto");
  const dialogOpen = open ?? internalOpen;
  const setDialogOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    if (!dialogOpen) return;
    apiClient.get<OnboardingData>("/onboarding/install-command", { showErrorToast: false })
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, [dialogOpen]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadConfig = () => {
    // Build config JSON and download
    const config = {
      InventoryApiUrl: data?.apiUrl || "",
      InventoryApiKey: data?.apiKey || "",
      AutoPushInventory: true,
      AutoStart: true,
      ScheduledPushEnabled: true,
      ScheduledPushIntervalMinutes: 30,
      DisplayName: ""
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "service-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Monitor className="h-5 w-5 text-purple-400" />
            Add New Device
          </DialogTitle>
          <DialogDescription>
            Install the Octofleet agent on a Windows machine to start managing it.
          </DialogDescription>
        </DialogHeader>

        {/* Tab selector */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setActiveTab("auto")}
            className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
              activeTab === "auto"
                ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                : "bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Terminal className="h-4 w-4 inline mr-2" />
            Automatic Install
          </button>
          <button
            onClick={() => setActiveTab("manual")}
            className={`flex-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
              activeTab === "manual"
                ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                : "bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FileJson className="h-4 w-4 inline mr-2" />
            Manual Setup
          </button>
        </div>

        {activeTab === "auto" && (
          <div className="space-y-4 mt-2">
            {/* Step 1 */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">1</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Open PowerShell as Administrator on the target machine</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">2</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Paste and run this command:</p>
                <div className="relative group">
                  <pre className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap break-all">
                    {data?.command || "Loading..."}
                  </pre>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => data && copyToClipboard(data.command, "command")}
                  >
                    {copied === "command" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">3</div>
              <div className="flex-1">
                <p className="text-sm font-medium">Done! The agent will install, configure, and start reporting automatically.</p>
                <p className="text-xs text-zinc-500 mt-1">The device will appear in your node list within 30 seconds.</p>
              </div>
            </div>

            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-400">
              <strong className="text-zinc-300">What this does:</strong> Downloads the latest agent from GitHub, installs it as a Windows service, and configures it with your server URL and API key.
            </div>
          </div>
        )}

        {activeTab === "manual" && (
          <div className="space-y-4 mt-2">
            {/* Download config */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">1</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Download the configuration file</p>
                <Button variant="outline" size="sm" onClick={downloadConfig}>
                  <Download className="h-4 w-4 mr-2" /> Download service-config.json
                </Button>
              </div>
            </div>

            {/* Copy to ProgramData */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">2</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Place it on the target machine at:</p>
                <div className="relative group">
                  <code className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-cyan-400 block">
                    C:\ProgramData\Octofleet\service-config.json
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard("C:\\ProgramData\\Octofleet\\service-config.json", "path")}
                  >
                    {copied === "path" ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Install agent */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">3</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Install the agent (if not already installed):</p>
                <p className="text-xs text-zinc-400">Download the latest release from <a href="https://github.com/BenediktSchackenberg/octofleet/releases/latest" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline">GitHub Releases</a> and run the installer.</p>
              </div>
            </div>

            {/* Restart service */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center h-7 w-7 rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold shrink-0 mt-0.5">4</div>
              <div className="flex-1">
                <p className="text-sm font-medium mb-2">Restart the agent service:</p>
                <div className="relative group">
                  <pre className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-green-400">
                    Restart-Service OctofleetNodeAgent
                  </pre>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard("Restart-Service OctofleetNodeAgent", "restart")}
                  >
                    {copied === "restart" ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            </div>

            {/* Config preview */}
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3">
              <p className="text-xs text-zinc-400 mb-2 font-medium">Config preview:</p>
              <pre className="text-xs font-mono text-zinc-300 overflow-x-auto">
{JSON.stringify({
  InventoryApiUrl: data?.apiUrl || "http://your-server:8080",
  InventoryApiKey: data?.apiKey || "your-api-key",
  AutoPushInventory: true,
  AutoStart: true,
  ScheduledPushEnabled: true,
  ScheduledPushIntervalMinutes: 30
}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

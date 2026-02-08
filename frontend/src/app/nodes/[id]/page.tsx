import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { notFound } from "next/navigation";

interface CustomSelectProps {
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  defaultValue: string;
}

function CustomSelect({ options, onChange, defaultValue }: CustomSelectProps) {
  return (
    <select
      className="block appearance-none w-full bg-gray-200 border border-gray-400 text-gray-700 py-2 px-4 pr-8 rounded leading-tight focus:outline-none focus:bg-white focus:border-gray-500"
      onChange={(e) => onChange(e.target.value)}
      defaultValue={defaultValue}
    >
      {options.map((option, idx) => (
        <option key={idx} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default async function NodeDetail() {
  const handleTabChange = (value: string) => {
    const element = document.querySelector(`[value="${value}"]`) as HTMLElement;
    if (element) element.click();
  };

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="outline" asChild>
            <Link href="/">← Zurück</Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Node Name</h1>
            <p className="text-muted-foreground">Node ID</p>
          </div>
        </div>

        <div className="flex md:hidden mb-4">
          <CustomSelect
            options={[
              { value: "overview", label: "Übersicht" },
              { value: "hardware", label: "Hardware" },
              { value: "software", label: "Software" },
              { value: "hotfixes", label: "Updates" },
              { value: "network", label: "Netzwerk" },
              { value: "security", label: "Sicherheit" },
              { value: "browser", label: "Browser" },
            ]}
            onChange={handleTabChange}
            defaultValue="overview"
          />
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="hidden md:grid w-full grid-cols-7">
            <TabsTrigger value="overview">Übersicht</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="software">Software</TabsTrigger>
            <TabsTrigger value="hotfixes">Updates</TabsTrigger>
            <TabsTrigger value="network">Netzwerk</TabsTrigger>
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="browser">Browser</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">Overview Content</TabsContent>
          <TabsContent value="hardware">Hardware Content</TabsContent>
          <TabsContent value="software">Software Content</TabsContent>
          <TabsContent value="hotfixes">Updates Content</TabsContent>
          <TabsContent value="network">Network Content</TabsContent>
          <TabsContent value="security">Security Content</TabsContent>
          <TabsContent value="browser">Browser Content</TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
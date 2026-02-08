"use client";

import React from "react";

interface MobileTabSelectProps {
  tabs: { value: string; label: string }[];
  currentTab: string;
  onTabChange: (value: string) => void;
}

export function MobileTabSelect({ tabs, currentTab, onTabChange }: MobileTabSelectProps) {
  return (
    <div className="md:hidden mb-4">
      <select
        value={currentTab}
        onChange={(e) => onTabChange(e.target.value)}
        className="w-full p-3 rounded-lg border border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-600 text-gray-900 dark:text-white text-lg font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        {tabs.map((tab) => (
          <option key={tab.value} value={tab.value}>
            {tab.label}
          </option>
        ))}
      </select>
    </div>
  );
}

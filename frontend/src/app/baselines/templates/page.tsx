"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function BaselinesTemplatesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/compliance?tab=templates"); }, [router]);
  return null;
}

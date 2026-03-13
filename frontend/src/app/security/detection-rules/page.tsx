"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function DetectionRulesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/security/rules"); }, [router]);
  return null;
}

import { redirect } from "next/navigation";

/**
 * The vulnerability views are on /vulnerabilities (data of the vulnerability scan). This older page
 * read a table that nothing fills and always showed 0; old links and bookmarks land on the real page.
 */
export default function SecurityVulnerabilitiesPage() {
  redirect("/vulnerabilities");
}

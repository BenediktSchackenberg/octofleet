import { redirect } from "next/navigation";

// Retention moved to Admin: it also covers performance data and hardware changes.
export default function RetentionMoved() {
  redirect("/settings/retention");
}

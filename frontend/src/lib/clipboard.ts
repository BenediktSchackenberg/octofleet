/**
 * Copies text to the clipboard. navigator.clipboard only exists in secure contexts (HTTPS or
 * localhost); Octofleet is often opened over plain HTTP on the LAN, so fall back to a hidden
 * textarea and execCommand("copy") there. Returns false if neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall back to the legacy method below
    }
  }
  // Inside a modal dialog the textarea has to live in the dialog: its focus trap would
  // take the focus (and the selection) back from an element outside it.
  const host = document.activeElement?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  host.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    host.removeChild(textarea);
  }
}

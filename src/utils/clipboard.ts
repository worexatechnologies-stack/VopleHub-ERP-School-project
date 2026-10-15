/**
 * Robust cross-browser clipboard utility with full fallback support.
 * Works across secure contexts (HTTPS/localhost) and non-secure contexts (HTTP over IP/LAN),
 * iframes, mobile browsers, and webviews.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  // 1. Try Modern Async Clipboard API if available and context is secure
  if (navigator?.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed, falling back to execCommand:', err);
    }
  }

  // 2. Fallback: document.execCommand('copy') with temporary textarea
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Prevent scrolling and zooming on mobile
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');

    document.body.appendChild(textArea);

    // Select content
    textArea.focus({ preventScroll: true });
    textArea.select();
    textArea.setSelectionRange(0, text.length);

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (successful) {
      return true;
    }
  } catch (execErr) {
    console.error('execCommand copy failed:', execErr);
  }

  // 3. Last-resort fallback: prompt user with text preselected
  try {
    window.prompt('Copy to clipboard: Press Ctrl+C (or Cmd+C), then press Enter', text);
    return true;
  } catch {
    return false;
  }
}

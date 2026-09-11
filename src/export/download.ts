/**
 * Browser downloads (Spec §10): Blob + anchor, with a copy-to-clipboard fallback for text when the host
 * sandbox blocks downloads. Returns what happened so the UI can say so.
 */
export type DownloadOutcome = 'downloaded' | 'copied' | 'failed';

export async function downloadBytes(name: string, data: Uint8Array | string, mime: string): Promise<DownloadOutcome> {
  try {
    const blob = new Blob([data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    return 'downloaded';
  } catch {
    if (typeof data === 'string') {
      try {
        await navigator.clipboard.writeText(data);
        return 'copied';
      } catch {
        return 'failed';
      }
    }
    return 'failed';
  }
}

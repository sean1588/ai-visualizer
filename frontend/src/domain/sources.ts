export function normalizePublicDataUrl(value: string): string {
  const input = value.trim();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  if (url.hostname === 'docs.google.com') {
    const sheet = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
    if (sheet) {
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      const gid = url.searchParams.get('gid') || hashParams.get('gid') || '0';
      return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    }
  }
  if (url.hostname === 'github.com') {
    const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (blob) {
      return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}`;
    }
  }
  return input;
}

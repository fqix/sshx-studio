export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['K', 'M', 'G', 'T'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)}${units[i]}`;
}

export function formatDate(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

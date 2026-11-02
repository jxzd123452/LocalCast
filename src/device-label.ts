export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  let device = 'Device';
  if (/iPhone/i.test(ua)) device = 'iPhone';
  else if (/iPad/i.test(ua)) device = 'iPad';
  else if (/Android/i.test(ua)) device = 'Android';
  else if (/CrOS/i.test(ua)) device = 'Chromebook';
  else if (/SmartTV|BRAVIA|Web0S|Tizen|AppleTV|HbbTV/i.test(ua)) device = 'TV';
  else if (/Mac OS|Macintosh/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows';
  else if (/Linux/i.test(ua)) device = 'Linux';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome|Chromium/.test(ua)) browser = 'Safari';
  return `${device} · ${browser}`;
}

export function sanitizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) return null;
  return value;
}

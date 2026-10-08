import QRCode from 'qrcode';

/** Join URL encoded in the tournament QR code (spec §7): {PUBLIC_BASE_URL}/join/{JOINCODE}. */
export function joinUrl(publicBaseUrl: string, joinCode: string): string {
  return `${publicBaseUrl}/join/${encodeURIComponent(joinCode)}`;
}

/** Player rejoin link for staff-assisted device changes (code in the fragment so it never hits server logs). */
export function rejoinUrl(publicBaseUrl: string, joinCode: string, publicId: string, rejoinCode: string): string {
  return `${joinUrl(publicBaseUrl, joinCode)}#rejoin=${encodeURIComponent(publicId)}:${encodeURIComponent(rejoinCode)}`;
}

/** Crisp, scalable SVG QR code with a quiet zone; error correction M survives projector glare. */
export async function qrSvg(text: string, size = 512): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: Math.max(128, Math.min(4096, size)), color: { dark: '#000000', light: '#ffffff' } });
}

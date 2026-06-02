// Server-only: render a QR code as a data URL.
import QRCode from "qrcode";

export async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 320,
    color: { dark: "#0a0a0b", light: "#ffffff" },
  });
}

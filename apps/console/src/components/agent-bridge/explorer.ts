/**
 * ArcScan transaction explorer base URL.
 *
 * NEXT_PUBLIC_ARC_SCAN_TX_BASE di-set di Vercel via env. Fallback
 * ke testnet agar dev / local tetap jalan tanpa env var.
 *
 * Contoh value: "https://testnet.arcscan.app/tx/"
 * Tx hash akan ditempel langsung di belakang → `${ARC_SCAN_TX}${txHash}`
 */
export const ARC_SCAN_TX: string =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_ARC_SCAN_TX_BASE) ||
  'https://testnet.arcscan.app/tx/';

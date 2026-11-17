// Decode only formats we know. Unknown and malformed payloads retain their bytes.
const standard = short => `0000${short}-0000-1000-8000-00805f9b34fb`;
const strings = new Set(['2a24', '2a25', '2a26', '2a27', '2a28', '2a29'].map(standard));
export function decodeValue(id, value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ');
  let formatted = 'Unknown format; see raw bytes below.';
  if (!bytes.length) return { formatted: 'Empty value (0 bytes).', hex: '(empty)' };
  if (strings.has(id)) {
    try { formatted = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { formatted = 'Invalid UTF-8 text; see raw bytes below.'; }
  } else if (id === standard('2a19')) {
    formatted = bytes.length === 1 && bytes[0] <= 100 ? `${bytes[0]}%` : 'Invalid battery value; expected one byte from 0 to 100.';
  } else if (id === standard('2a50')) {
    if (bytes.length === 7) {
      const source = { 1: 'Bluetooth SIG', 2: 'USB-IF' }[bytes[0]] || `Unknown (${bytes[0]})`;
      const hex16 = offset => '0x' + value.getUint16(offset, true).toString(16).padStart(4, '0');
      formatted = `Vendor ID source: ${source}\nVendor ID: ${hex16(1)}\nProduct ID: ${hex16(3)}\nProduct version (raw): ${hex16(5)}`;
    } else formatted = 'Invalid PnP ID; expected 7 bytes.';
  }
  return { formatted, hex };
}

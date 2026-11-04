// Browser tools for the control page's Set up a board, bundled by build.js
// into dist/setup-tools.min.js (window.SetupTools): esptool-js (flashing
// over Web Serial), spark-md5 (to check what was written), qrcode (labels).
import SparkMD5 from 'spark-md5';

export { ESPLoader, Transport } from 'esptool-js';
export { default as QRCode } from 'qrcode';

// MD5 (hex) of a Uint8Array, for esptool-js's calculateMD5Hash: it then
// reads each region's MD5 back from the board and fails on a mismatch.
export const md5 = (u8) => SparkMD5.ArrayBuffer.hash(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));

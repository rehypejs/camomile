/**
 * Encode bytes.
 *
 * @param {Iterable<number>} bytes
 */
export function hexEncode(bytes) {
  return Array.from(bytes, function (byte) {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

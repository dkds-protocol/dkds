/**
 * The constant tables of the DEFLATE format (RFC 1951, sections 3.2.5 and 3.2.7), shared by the
 * compressor and the decompressor.
 */

/** Order in which the code lengths of the code length code are transmitted (3.2.7). */
export const CODE_LENGTH_ORDER: readonly number[] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Base match length of length symbols 257 to 285 (3.2.5). */
export const LENGTH_BASE: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];

/** Extra bits of length symbols 257 to 285 (3.2.5). */
export const LENGTH_EXTRA: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

/** Base distance of distance symbols 0 to 29 (3.2.5). */
export const DIST_BASE: readonly number[] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];

/** Extra bits of distance symbols 0 to 29 (3.2.5). */
export const DIST_EXTRA: readonly number[] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

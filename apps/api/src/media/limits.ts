/** Multipart / upload ceiling — matches ImageKit free-plan image upload limit. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "25MB";

/**
 * ImageKit pre-upload transform: shrink only if larger than 2560px on a side,
 * keep aspect ratio, compress quality. Does not upscale smaller images.
 * @see https://imagekit.io/docs/dam/pre-and-post-transformation-on-upload
 */
export const IMAGEKIT_PRE_TRANSFORM = "w-2560,h-2560,c-at_max,q-80";

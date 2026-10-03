// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Canonical Realm Passport avatar rendering and file normalization.
 *
 * Account settings and social clients share this module. Apps never own a
 * second avatar record: the bounded `thumb` returned here is the only media
 * value suitable for PublicProfileV1, while `full` is available only for a
 * transient local preview during selection.
 */

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico)(\?|#|$)/i;
const VID_EXT = /\.(webm|mp4|m4v|ogg|ogv|mov)(\?|#|$)/i;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/webm', 'video/mp4']);
const MAX_DECODED_EDGE = 8192;
const MAX_DECODED_PIXELS = 40_000_000;

export const AVATAR_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,video/webm,video/mp4';
export const AVATAR_EMOJI_OPTIONS = Object.freeze(['🙂','😎','🦊','🐱','🐉','🌸','🚀','🎧','👾','🌚','🔥','💎']);
export const AVATAR_SOURCE_CAP_BYTES = 3_000_000;
export const PROFILE_AVATAR_MAX_CHARS = 1024;
export const PROFILE_AVATAR_THUMB_CAP_BYTES = 720;

export function isImageAvatar(value) {
  const avatar = String(value || '');
  return /^data:image\//i.test(avatar) || (/^(https?:)?\/\//i.test(avatar) && IMG_EXT.test(avatar));
}

export function isVideoAvatar(value) {
  const avatar = String(value || '');
  return /^data:video\//i.test(avatar) || (/^(https?:)?\/\//i.test(avatar) && VID_EXT.test(avatar));
}

export function isMediaAvatar(value) {
  return isImageAvatar(value) || isVideoAvatar(value);
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Render one glyph, image, video, or initials fallback into a caller-owned container. */
export function renderAvatar(container, avatar, { name = '' } = {}) {
  if (!container) return;
  container.replaceChildren();
  container.classList.remove('media', 'glyph', 'initials');
  const value = String(avatar ?? '').trim();

  if (isImageAvatar(value)) {
    const image = document.createElement('img');
    image.className = 'fx-avatar-media sm-ava-media';
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;
    image.src = value;
    container.classList.add('media');
    container.appendChild(image);
    return;
  }
  if (isVideoAvatar(value)) {
    const video = document.createElement('video');
    video.className = 'fx-avatar-media sm-ava-media';
    video.src = value;
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    try { video.disablePictureInPicture = true; } catch (_) {}
    container.classList.add('media');
    container.appendChild(video);
    video.play?.().catch(() => {});
    return;
  }
  if (value) {
    container.classList.add('glyph');
    container.appendChild(document.createTextNode(value));
    return;
  }
  container.classList.add('initials');
  container.appendChild(document.createTextNode(initials(name)));
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decode failed.'));
    image.src = src;
  });
}

function assertDecodedDimensions(width, height, kind) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1
      || width > MAX_DECODED_EDGE || height > MAX_DECODED_EDGE
      || width * height > MAX_DECODED_PIXELS) {
    throw new Error(`${kind} dimensions are too large.`);
  }
}

function withinEncodedCap(value, capBytes, maxChars) {
  if (maxChars && value.length > maxChars) return false;
  return !capBytes || value.length * 0.75 <= capBytes;
}

function squareDataUrl(source, width, height, px, type, quality, capBytes, maxChars) {
  assertDecodedDimensions(width, height, source?.tagName === 'VIDEO' ? 'Video' : 'Image');
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;
  let targetPx = Math.max(24, Math.min(512, Math.floor(px) || 72));

  while (targetPx >= 24) {
    const canvas = document.createElement('canvas');
    canvas.width = targetPx;
    canvas.height = targetPx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, side, side, 0, 0, targetPx, targetPx);

    for (let candidateQuality = Math.min(1, Math.max(0.3, Number(quality) || 0.8)); candidateQuality >= 0.3; candidateQuality -= 0.12) {
      const output = canvas.toDataURL(type, candidateQuality);
      if (withinEncodedCap(output, capBytes, maxChars)) return output;
    }
    if (targetPx === 24) break;
    targetPx = Math.max(24, Math.floor(targetPx * 0.78));
  }
  throw new Error('The selected picture cannot fit the Realm Passport avatar limit.');
}

async function squareDownscale(src, px, type, quality, capBytes, maxChars = 0) {
  const image = await loadImage(src);
  return squareDataUrl(image, image.naturalWidth, image.naturalHeight, px, type, quality, capBytes, maxChars);
}

function videoFirstFrame(src, px, type, quality, capBytes, maxChars = 0) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = src;
    let settled = false;
    let timer = null;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      try { video.load(); } catch (_) {}
      if (error) reject(error); else resolve(value);
    };
    timer = setTimeout(() => done(new Error('Video thumbnail timed out.')), 8000);
    video.onloadeddata = () => {
      try { video.currentTime = Math.min(0.1, (video.duration || 1) / 2); }
      catch (error) { done(error); }
    };
    video.onseeked = () => {
      try {
        done(null, squareDataUrl(video, video.videoWidth, video.videoHeight, px, type, quality, capBytes, maxChars));
      } catch (error) { done(error); }
    };
    video.onerror = () => done(new Error('Video decode failed.'));
  });
}

function acceptedAvatarMime(file) {
  const mime = String(file?.type || '').trim().toLowerCase();
  if (IMAGE_MIME_TYPES.has(mime)) return Object.freeze({ mime, kind: 'image' });
  if (VIDEO_MIME_TYPES.has(mime)) return Object.freeze({ mime, kind: 'video' });
  throw new Error('Unsupported file — use PNG, JPEG, GIF, WebP, WebM, or MP4.');
}

function assertAvatarSource(file, sourceCapBytes) {
  if (!file) throw new Error('No file selected.');
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('The selected file is empty or unreadable.');
  if (size > sourceCapBytes) throw new Error('File too large (max 3 MB). Try a shorter or smaller file.');
  return acceptedAvatarMime(file);
}

/**
 * Normalize one selected file. `thumb` is bounded for callers; `full` is a
 * transient preview only and may be omitted to avoid unnecessary processing.
 */
export async function fileToAvatarSet(file, {
  fullMaxPx = 512,
  fullCapBytes = AVATAR_SOURCE_CAP_BYTES,
  sourceCapBytes = AVATAR_SOURCE_CAP_BYTES,
  thumbPx = 72,
  thumbCapBytes = 12_000,
  thumbMaxChars = 0,
  fallback = '🙂',
  includeFull = true,
} = {}) {
  const accepted = assertAvatarSource(file, sourceCapBytes);

  if (accepted.kind === 'video') {
    const source = await blobToDataURL(file);
    let thumb = fallback;
    try { thumb = await videoFirstFrame(source, thumbPx, 'image/webp', 0.7, thumbCapBytes, thumbMaxChars); } catch (_) {}
    return { full: includeFull ? source : null, thumb };
  }

  const source = await blobToDataURL(file);
  const animated = accepted.mime === 'image/gif' || accepted.mime === 'image/webp';
  let full = null;
  if (includeFull) {
    full = animated && file.size <= fullCapBytes
      ? source
      : await squareDownscale(source, fullMaxPx, 'image/webp', 0.9, fullCapBytes);
  }
  let thumb = fallback;
  try {
    thumb = await squareDownscale(source, thumbPx, 'image/webp', 0.72, thumbCapBytes, thumbMaxChars);
    if (!withinEncodedCap(thumb, thumbCapBytes, thumbMaxChars)) thumb = fallback;
  } catch (_) {}
  return { full, thumb };
}

/** Convert a selected file into the exact bounded value stored in PublicProfileV1. */
export async function fileToProfileAvatar(file) {
  const { thumb } = await fileToAvatarSet(file, {
    sourceCapBytes: AVATAR_SOURCE_CAP_BYTES,
    thumbPx: 72,
    thumbCapBytes: PROFILE_AVATAR_THUMB_CAP_BYTES,
    thumbMaxChars: PROFILE_AVATAR_MAX_CHARS,
    fallback: '',
    includeFull: false,
  });
  if (!isImageAvatar(thumb) || thumb.length > PROFILE_AVATAR_MAX_CHARS) {
    throw new Error('Could not create a bounded profile picture from that file. Try a simpler image.');
  }
  return thumb;
}

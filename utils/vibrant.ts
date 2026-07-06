import ImageColors from 'react-native-image-colors';

interface HslColor {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  hex: string;
}

/**
 * Converts an RGB color value to HSL.
 * Assumes r, g, and b are contained in the set [0, 255] and
 * returns h, s, and l in the set [0, 1].
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

/**
 * Converts an HSL color value to RGB hex string.
 */
function hslToHex(h: number, s: number, l: number): string {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Parses hex color to RGB object.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Extracts the most vibrant color from an image URI (local or remote)
 * mimicking the custom canvas extraction logic from Monochrome.
 * 
 * @param imageUri URI of the image (local file path or web URL)
 * @param fallbackColor Hex fallback color if extraction fails
 */
export async function getVibrantColorFromImage(
  imageUri: string,
  fallbackColor: string = '#3b82f6'
): Promise<string> {
  try {
    const result = await ImageColors.getColors(imageUri, {
      fallback: fallbackColor,
      cache: true,
      key: imageUri,
    });

    const hexColors: string[] = [];

    if (result.platform === 'android') {
      if (result.vibrant) hexColors.push(result.vibrant);
      if (result.dominant) hexColors.push(result.dominant);
      if (result.darkVibrant) hexColors.push(result.darkVibrant);
      if (result.lightVibrant) hexColors.push(result.lightVibrant);
      if (result.muted) hexColors.push(result.muted);
      if (result.darkMuted) hexColors.push(result.darkMuted);
      if (result.lightMuted) hexColors.push(result.lightMuted);
    } else if (result.platform === 'ios') {
      if (result.primary) hexColors.push(result.primary);
      if (result.secondary) hexColors.push(result.secondary);
      if (result.detail) hexColors.push(result.detail);
      if (result.background) hexColors.push(result.background);
    } else if (result.platform === 'web') {
      if (result.vibrant) hexColors.push(result.vibrant);
      if (result.dominant) hexColors.push(result.dominant);
      if (result.darkVibrant) hexColors.push(result.darkVibrant);
      if (result.lightVibrant) hexColors.push(result.lightVibrant);
      if (result.muted) hexColors.push(result.muted);
    }

    const candidates: HslColor[] = [];

    // Parse all hex colors into HSL
    for (const hex of hexColors) {
      const rgb = hexToRgb(hex);
      if (!rgb) continue;

      const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);

      // Filtering criteria identical to Monochrome:
      // Saturation >= 0.3, Lightness between 0.3 and 0.8
      if (s >= 0.3 && l >= 0.3 && l <= 0.8) {
        candidates.push({ r: rgb.r, g: rgb.g, b: rgb.b, h, s, l, hex });
      }
    }

    // Relaxed criteria if no candidates found
    if (candidates.length === 0) {
      for (const hex of hexColors) {
        const rgb = hexToRgb(hex);
        if (!rgb) continue;

        const [h, s, l] = rgbToHsl(rgb.r, rgb.g, rgb.b);
        // Lightness between 0.1 and 0.95
        if (l > 0.1 && l < 0.95) {
          candidates.push({ r: rgb.r, g: rgb.g, b: rgb.b, h, s, l, hex });
        }
      }
    }

    if (candidates.length === 0) {
      return fallbackColor;
    }

    // Sort by saturation descending, then proximity of lightness to 0.5 (identical to Monochrome)
    candidates.sort((c1, c2) => {
      return c2.s - c1.s || 0.5 - Math.abs(c1.l - 0.5) - (0.5 - Math.abs(c2.l - 0.5));
    });

    return candidates[0].hex;
  } catch (error) {
    console.warn('Failed to extract vibrant color from image:', error);
    return fallbackColor;
  }
}

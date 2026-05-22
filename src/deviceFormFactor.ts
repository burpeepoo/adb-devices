export type DeviceFormFactor = "phone" | "tablet" | "largeScreen";

const TABLET_MIN_INCHES = 7;
const LARGE_SCREEN_MIN_INCHES = 15.6;

export function classifyDeviceFormFactor(
  displaySize: string,
  displayDensity: string,
  physicalSizeMm = "",
): DeviceFormFactor {
  const physicalSize = parsePhysicalSizeMm(physicalSizeMm);
  if (physicalSize) {
    return classifyDiagonal(Math.sqrt(physicalSize.widthMm ** 2 + physicalSize.heightMm ** 2) / 25.4);
  }

  const size = parseDisplaySize(displaySize);
  const density = parseDisplayDensity(displayDensity);

  if (!size || !density) {
    return "phone";
  }

  const diagonalInches = Math.sqrt(size.width ** 2 + size.height ** 2) / density;
  return classifyDiagonal(diagonalInches);
}

function classifyDiagonal(diagonalInches: number): DeviceFormFactor {
  if (diagonalInches >= LARGE_SCREEN_MIN_INCHES) {
    return "largeScreen";
  }
  if (diagonalInches >= TABLET_MIN_INCHES) {
    return "tablet";
  }
  return "phone";
}

function parseDisplaySize(value: string) {
  const match = value.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function parseDisplayDensity(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const density = Number(match[1]);
  if (!Number.isFinite(density) || density <= 0) {
    return null;
  }
  return density;
}

function parsePhysicalSizeMm(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const widthMm = Number(match[1]);
  const heightMm = Number(match[2]);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return null;
  }

  return { widthMm, heightMm };
}

import sharp from "sharp";
import { WorkspaceError } from "./workspace-server";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export async function normalizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new WorkspaceError(413, "Choose an image smaller than 3 MiB.");
  try {
    const source = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
    const info = await source.metadata();
    if (!["png", "jpeg", "webp"].includes(info.format ?? "") || (info.pages ?? 1) > 1)
      throw new Error("Unsupported image");
    const { data, info: output } = await source.rotate()
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES)
      throw new WorkspaceError(413, "This image is too large after processing. Choose a smaller image.");
    return { bytes: data, width: output.width, height: output.height };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(400, "Choose a valid, still PNG, JPEG or WebP image (up to 25 megapixels).");
  }
}

import * as fs from "fs";
import * as path from "path";

export function getImageFiles(imageDir: string): string[] {
  const supportedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const files = fs.readdirSync(imageDir);
  return files
    .filter((file) => supportedExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => path.join(imageDir, file));
}
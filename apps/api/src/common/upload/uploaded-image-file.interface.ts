/**
 * Minimal shape of a Multer memory-stored upload.
 *
 * Declared locally instead of relying on the global `Express.Multer.File`
 * augmentation because the project does not install `@types/multer`.
 */
export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

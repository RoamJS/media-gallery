export type UploadDestination = { parentUid: string | null; label: string };
export type MediaUpload = {
  id: string;
  file: File;
  fileName: string;
  blockUid: string;
  url?: string;
  status: "queued" | "uploading" | "linking" | "added" | "failed";
  error?: string;
};

import { getValidGoogleAccessToken } from "../google-calendar/connection";

const API_BASE = "https://www.googleapis.com/drive/v3";
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  webViewLink?: string;
}

export class GoogleDriveApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
  }
}

export class GoogleDriveClient {
  private async authHeader(): Promise<Record<string, string>> {
    const accessToken = await getValidGoogleAccessToken();
    return { Authorization: `Bearer ${accessToken}` };
  }

  /**
   * Lists Google Meet "Take notes with Gemini" files by name match,
   * newest first. Uses `drive.readonly` (not `drive.file`) because these
   * files are created by Meet, not by this app.
   */
  async listGeminiNotes(): Promise<DriveFile[]> {
    const headers = await this.authHeader();
    const params = new URLSearchParams({
      q: "name contains 'Gemini' and trashed = false",
      orderBy: "createdTime desc",
      pageSize: "50",
      fields: "files(id,name,mimeType,createdTime,webViewLink)",
    });

    const response = await fetch(`${API_BASE}/files?${params.toString()}`, { headers });
    if (!response.ok) {
      throw new GoogleDriveApiError(
        "Failed to list Google Drive files",
        response.status,
        await safeReadBody(response)
      );
    }

    const data = (await response.json()) as { files: DriveFile[] };
    return data.files;
  }

  /** Fetches metadata for a single file by ID. */
  async getFile(fileId: string): Promise<DriveFile> {
    const headers = await this.authHeader();
    const params = new URLSearchParams({ fields: "id,name,mimeType,createdTime,webViewLink" });

    const response = await fetch(`${API_BASE}/files/${fileId}?${params.toString()}`, { headers });
    if (!response.ok) {
      throw new GoogleDriveApiError(
        `Failed to get Drive file ${fileId}`,
        response.status,
        await safeReadBody(response)
      );
    }

    return (await response.json()) as DriveFile;
  }

  /**
   * Downloads a file's bytes — exports to PDF if it's a native Google Doc
   * (Gemini notes are usually a Doc), otherwise downloads it directly.
   */
  async downloadFile(file: DriveFile): Promise<{ bytes: Buffer; contentType: string }> {
    const headers = await this.authHeader();
    const isGoogleDoc = file.mimeType === GOOGLE_DOC_MIME_TYPE;

    const url = isGoogleDoc
      ? `${API_BASE}/files/${file.id}/export?mimeType=application/pdf`
      : `${API_BASE}/files/${file.id}?alt=media`;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new GoogleDriveApiError(
        `Failed to download Drive file ${file.id}`,
        response.status,
        await safeReadBody(response)
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), contentType: isGoogleDoc ? "application/pdf" : file.mimeType };
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

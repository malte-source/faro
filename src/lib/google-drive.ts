/**
 * Thin wrapper around the Google Drive REST API (files only).
 *
 * We use the `drive.file` scope which gives us access ONLY to files the
 * app creates or that the user explicitly opens with the app via picker.
 * That's safer than the full `drive` scope and is "non-sensitive" in
 * Google's classification (no verification needed even for External apps).
 */

const BASE = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink: string
  iconLink: string
  modifiedTime: string
  size?: string
}

export interface DriveFolder {
  id: string
  name: string
  webViewLink: string
}

async function call<T>(
  accessToken: string,
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Drive ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/**
 * Create a new folder in the user's My Drive root.
 * Returns the folder's id and webViewLink for opening in Drive UI.
 */
export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<DriveFolder> {
  const created = await call<DriveFolder>(
    accessToken,
    `${BASE}/files?fields=id,name,webViewLink`,
    {
      method: 'POST',
      body: {
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      },
    },
  )
  return created
}

/**
 * List files inside a Drive folder, sorted by most-recently-modified first.
 * Returns at most 50 entries.
 */
export async function listDriveFolderFiles(
  accessToken: string,
  folderId: string,
): Promise<DriveFile[]> {
  const fields = 'files(id,name,mimeType,webViewLink,iconLink,modifiedTime,size)'
  const q = `'${folderId}' in parents and trashed=false`
  const url = `${BASE}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime%20desc&pageSize=50&fields=${encodeURIComponent(fields)}`
  const res = await call<{ files: DriveFile[] }>(accessToken, url)
  return res.files ?? []
}

/**
 * Fetch a single folder's metadata. Used to verify a folder still exists
 * and to display its name in FARO when only the ID is stored.
 */
export async function getDriveFolder(
  accessToken: string,
  folderId: string,
): Promise<DriveFolder | null> {
  try {
    return await call<DriveFolder>(
      accessToken,
      `${BASE}/files/${folderId}?fields=id,name,webViewLink`,
    )
  } catch {
    return null
  }
}

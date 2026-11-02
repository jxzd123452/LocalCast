export interface Entry {
  name: string;
  relPath: string;
  kind: 'dir' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'file';
  size: number | null;
  mtimeMs: number;
  playable: boolean | 'try' | null;
}

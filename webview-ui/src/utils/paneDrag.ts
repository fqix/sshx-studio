/** Dragging rows between the local and remote panes (not files from the OS). */
export const PANE_DRAG_MIME = 'application/x-sshx-paths';

export interface PaneDrag {
  from: 'local' | 'remote';
  paths: string[];
}

export function setPaneDrag(e: React.DragEvent, drag: PaneDrag) {
  e.dataTransfer.setData(PANE_DRAG_MIME, JSON.stringify(drag));
  e.dataTransfer.effectAllowed = 'copy';
}

/** The pane drag in this event, if any (only readable on drop). */
export function getPaneDrag(e: React.DragEvent): PaneDrag | undefined {
  const raw = e.dataTransfer.getData(PANE_DRAG_MIME);
  try {
    return raw ? (JSON.parse(raw) as PaneDrag) : undefined;
  } catch {
    return undefined;
  }
}

export const isPaneDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(PANE_DRAG_MIME);

import { useState } from "react";

export function useUndoRedo(deps: {
  convs: any[];
  clusters: any[];
  convId: any;
  commits: any[];
  headId: any;
  branch: any;
  parentRef: any;
}) {
  const [undoAction, setUndoAction] = useState<any>(null);
  const snap = (value: any) => JSON.parse(JSON.stringify(value));
  const rememberUndo = (label: string) => {
    setUndoAction({
      label,
      convs: snap(deps.convs),
      clusters: snap(deps.clusters),
      current: { convId: deps.convId, commits: snap(deps.commits), headId: deps.headId, branch: deps.branch, parentRef: snap(deps.parentRef) },
    });
  };
  return { undoAction, setUndoAction, rememberUndo };
}

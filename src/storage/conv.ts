import storage from "../lib/storage";
import seedMobyDick from "../seed-moby-dick";
import { normalizeClusters } from "./clusters";
import {
  collectAttachmentRefs,
  externalizeAttachment,
} from "../lib/attachments";
import type { Attachment, Commit, Conversation } from "@/types";

type Cluster = { id: string; title?: string; parentId?: string | null; auto?: boolean; createdAt?: string; u?: string };

// Walk commits, persist each attachment's data under its own storage key,
// and return a shallow-cloned conversation whose commits only reference those keys.
// This keeps the conversation JSON small so it parses/saves quickly.
function externalizeAttachmentsOnCommits(commits: Commit[]): Commit[] {
  let mutated = false;
  const next: Commit[] = [];
  for (const c of commits) {
    const atts = c.attachments;
    if (!atts?.length) {
      next.push(c);
      continue;
    }
    let attsChanged = false;
    const newAtts: Attachment[] = [];
    for (const a of atts) {
      const ext = externalizeAttachment(a);
      if (ext !== a) attsChanged = true;
      newAtts.push(ext);
    }
    if (attsChanged) {
      mutated = true;
      next.push({ ...c, attachments: newAtts });
    } else {
      next.push(c);
    }
  }
  return mutated ? next : commits;
}

export function persistConv(cv: Conversation): void {
  const commits = cv.commits || [];
  const externalized = externalizeAttachmentsOnCommits(commits);
  const toWrite =
    externalized === commits ? cv : { ...cv, commits: externalized };
  storage.set(cv.id, JSON.stringify(toWrite));
}

export function persistCluster(cluster: Cluster): void {
  storage.set(cluster.id, JSON.stringify(cluster));
}

export function loadAllConvsAndClusters(): { convs: Conversation[]; clusters: Cluster[] } | null {
  seedMobyDick();
  const r = storage.list("conv:");
  if (!r?.keys?.length) return null;
  const cs: Conversation[] = [];
  for (const k of r.keys) {
    const p = storage.get(k);
    if (p?.value) {
      try {
        cs.push(JSON.parse(p.value));
      } catch {}
    }
  }
  const cr = storage.list("cluster:");
  const loadedClusters: Cluster[] = [];
  if (cr?.keys?.length) {
    for (const k of cr.keys) {
      const p = storage.get(k);
      if (p?.value) {
        try {
          loadedClusters.push(JSON.parse(p.value));
        } catch {}
      }
    }
  }
  const normalized = normalizeClusters(cs, loadedClusters);
  const sorted = normalized.convs.sort((a, b) => (b.u || "").localeCompare(a.u || ""));
  return { convs: sorted, clusters: normalized.clusters };
}

export function deleteConvCascade(
  convs: Conversation[],
  id: string,
): { nextConvs: Conversation[]; deletedIds: Set<string>; attachmentRefs: string[] } {
  const deletedIds = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of convs) {
      if (!deletedIds.has(c.id) && c.parentRef && deletedIds.has(c.parentRef.convId)) {
        deletedIds.add(c.id);
        grew = true;
      }
    }
  }
  const attachmentRefs: string[] = [];
  for (const c of convs) {
    if (deletedIds.has(c.id)) {
      attachmentRefs.push(...collectAttachmentRefs(c.commits));
    }
  }
  const nextConvs = convs.filter((c) => !deletedIds.has(c.id));
  return { nextConvs, deletedIds, attachmentRefs };
}

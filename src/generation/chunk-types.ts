import type {
  ChunkPlan,
  Entity,
  Snapshot,
  WorldSpec,
} from "../world/schema.js";

export type GenerationStatus = "pending" | "running" | "ready" | "failed";
export interface GenerationJob {
  id: string;
  x: number;
  z: number;
  status: GenerationStatus;
  attempt: number;
  specRevision: number;
  error?: string;
  updatedAt: number;
}
export interface GenerationRequest {
  documents?: { path: string; text: string }[];
  documentWarnings?: string[];
  worldId: string;
  spec: WorldSpec;
  specRevision: number;
  chunk: { id: string; x: number; z: number; size: number };
  neighbors: {
    id: string;
    x: number;
    z: number;
    entities: Pick<Entity, "id" | "kind" | "name" | "position" | "state">[];
  }[];
  boundaries: {
    groundHeight: 0;
    inset: 2;
    corridorHalfWidth: 2;
    center: [number, number, number];
    portals: [number, number, number][];
  };
}
export type ChunkGenerator = (
  request: GenerationRequest,
  signal: AbortSignal,
) => Promise<ChunkPlan>;
export interface GenerationOptions {
  concurrency?: number;
  maxQueued?: number;
  maxNewChunks?: number;
  timeoutMs?: number;
  prefetchRadius?: number;
}
export interface GenerationView {
  mode: "ai" | "demo";
  regions: {
    id: string;
    x: number;
    z: number;
    status: GenerationStatus | "unrequested";
    error?: string;
  }[];
  active: number;
  queued: number;
  budgetRemaining: number;
  blockedReason?: string;
}
export type HostSnapshot = Snapshot & { generation: GenerationView };

import type { StructureCheckpoint } from '@/core/structure'
import type { TaskStorage } from './task-journal'

export const STRUCTURE_CHECKPOINT_KEY = 'reshelve:structure-checkpoint'

export async function readStructureCheckpoint(
  storage: TaskStorage,
): Promise<StructureCheckpoint | null> {
  return await storage.get<StructureCheckpoint>(STRUCTURE_CHECKPOINT_KEY)
}

export async function writeStructureCheckpoint(
  storage: TaskStorage,
  checkpoint: StructureCheckpoint,
): Promise<void> {
  await storage.set(STRUCTURE_CHECKPOINT_KEY, checkpoint)
}

export async function clearStructureCheckpoint(storage: TaskStorage): Promise<void> {
  await storage.remove(STRUCTURE_CHECKPOINT_KEY)
}

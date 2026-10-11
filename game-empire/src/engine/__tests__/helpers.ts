export { focus, GENRES } from '../constants';
import { recommendedBudget } from '../development';
import type { ArtStyleId, PlatformId, ScopeId } from '../types';

export function recommendedBudgetFor(scope: ScopeId, art: ArtStyleId, platforms: PlatformId[]): number {
  return recommendedBudget(scope, art, platforms);
}

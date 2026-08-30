export type Tier = 'bronze' | 'silver' | 'gold';
export type TierArtifact = 'bronze-record' | 'staged-proposal' | 'authorized-page';

export function classifyTier(artifact: TierArtifact): Tier {
  if (artifact === 'bronze-record') return 'bronze';
  if (artifact === 'staged-proposal') return 'silver';
  return 'gold';
}

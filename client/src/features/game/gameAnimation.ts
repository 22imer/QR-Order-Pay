import type { GameRound } from '@may-cafe/contracts';

export function wheelAngle(round: GameRound | null, now: number, reduced: boolean) {
  if (!round?.winnerId || round.spinStartsAt === null || round.revealsAt === null) return 0;
  const index = round.players.findIndex((p) => p.id === round.winnerId);
  if (index < 0 || !round.players.length) return 0;
  const t = Math.max(
    0,
    Math.min(1, (now - round.spinStartsAt) / (round.revealsAt - round.spinStartsAt)),
  );
  return (
    (1800 - (index * 360) / round.players.length) *
    (reduced ? (t >= 1 ? 1 : 0) : 1 - Math.pow(1 - t, 3))
  );
}

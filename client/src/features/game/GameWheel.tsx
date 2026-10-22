import type { GameRound } from '@may-cafe/contracts';
import { wheelAngle } from './gameAnimation';

const colors = ['#F4A21D', '#77A88A', '#F1C6A8', '#7BA4B0', '#D6C59C', '#BFA6C6'];
const point = (angle: number, radius = 140) => ({
  x: 160 + Math.cos((angle * Math.PI) / 180) * radius,
  y: 160 + Math.sin((angle * Math.PI) / 180) * radius,
});
export function GameWheel({
  round,
  now,
  reduced,
}: {
  round: GameRound | null;
  now: number;
  reduced: boolean;
}): JSX.Element {
  const players = round?.players ?? [],
    count = players.length;
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-sm"
      data-game-wheel
      data-angle={wheelAngle(round, now, reduced).toFixed(2)}
    >
      <div
        className="absolute -top-1 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[24px] border-x-transparent border-t-foreground"
        aria-hidden="true"
      />
      <svg
        viewBox="0 0 320 320"
        role="img"
        aria-label={`Vòng quay với ${count} người tham gia`}
        className="h-full w-full drop-shadow-lg"
        style={{ transform: `rotate(${wheelAngle(round, now, reduced)}deg)` }}
      >
        <circle cx="160" cy="160" r="146" fill="#1B2B23" stroke="#F4A21D" strokeWidth="4" />
        {count === 1 && <circle cx="160" cy="160" r="140" fill={colors[0]} />}
        {players.map((p, i) => {
          const step = 360 / count,
            start = point(-90 - step / 2 + i * step),
            end = point(-90 + step / 2 + i * step),
            label = point(-90 + i * step, 96);
          return (
            <g key={p.id}>
              {count > 1 && (
                <path
                  d={`M160 160 L${start.x} ${start.y} A140 140 0 ${step > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`}
                  fill={colors[i % colors.length]}
                  stroke="#1B2B23"
                  strokeWidth="2"
                />
              )}
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#101D18"
                fontSize={count > 8 ? 10 : 13}
                fontWeight="700"
                transform={`rotate(${i * step},${label.x},${label.y})`}
              >
                {i + 1}. {p.name.slice(0, 10)}
              </text>
            </g>
          );
        })}
        <circle cx="160" cy="160" r="32" fill="#101D18" stroke="#F6F3EB" strokeWidth="2" />
        <text x="160" y="164" textAnchor="middle" fill="#F6F3EB" fontSize="13" fontWeight="700">
          {count ? '☕' : 'Chờ bạn'}
        </text>
      </svg>
    </div>
  );
}

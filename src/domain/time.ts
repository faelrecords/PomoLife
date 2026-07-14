export function roundUpToIncrement(value: number, increment: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) {
    throw new RangeError("O valor e o incremento precisam ser números válidos.");
  }

  return Math.ceil(value / increment) * increment;
}

export function calculateRealisticMinutes(
  optimisticMinutes: number,
  typicalMinutes: number,
): number {
  if (
    !Number.isFinite(optimisticMinutes) ||
    !Number.isFinite(typicalMinutes) ||
    optimisticMinutes <= 0 ||
    typicalMinutes <= 0
  ) {
    throw new RangeError("As estimativas precisam ser maiores que zero.");
  }

  const baseMinutes = Math.max(optimisticMinutes * 1.5, typicalMinutes);
  return roundUpToIncrement(baseMinutes * 1.2, 15);
}

export function formatMinutesPtBr(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    throw new RangeError("A duração precisa ser um número positivo.");
  }

  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
}

// Key files carry the share generation they belong to (phase 4: a device move refreshes the
// shares, same addresses, and every older file stops working). A client file and a server file
// only combine when both are of the same generation; files made before generations count as 0.

export interface WithShareGeneration {
  shareGeneration?: number | null;
}

export function shareGenerationOf(file: WithShareGeneration): number {
  const g = file.shareGeneration;
  return typeof g === "number" && Number.isInteger(g) && g >= 0 ? g : 0;
}

/** Throws a plain error when the two files are from different key versions. */
export function assertSameShareGeneration(client: WithShareGeneration, server: WithShareGeneration): void {
  const c = shareGenerationOf(client), s = shareGenerationOf(server);
  if (c !== s) {
    throw new Error(
      `These two files are from different key versions: client gen ${c}, server gen ${s}. ` +
        "A device move replaced the keys; use a client file and a server export made after the same move.",
    );
  }
}

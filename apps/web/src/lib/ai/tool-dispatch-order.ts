/**
 * Bearbetningsordning för verktygsanrop i EN agent-tur (CLAUDE.md § 16.2).
 *
 * Regel för motorn: LÄSANROP körs parallellt (latens), men SKRIVANROP körs
 * SEKVENTIELLT i exakt den ordning modellen gav dem. Bakgrund: när en modul
 * i Startupkompassen byggdes från chatten körde loopen alla
 * `add_compass_question`-anrop samtidigt; varje anrop läste "högsta
 * sort_order" innan något av de andra hunnit skriva, alla fick samma värde och
 * frågorna visades som "6, 1, 9". Sekventiell skrivning gör att skapandeordning
 * = anropsordning, oavsett vilket skrivverktyg det gäller.
 *
 * Ren modul (ingen IO) så den kan enhetstestas. Resultaten returneras alltid i
 * anropens ursprungliga index-ordning.
 */

export interface OrderedDispatchOptions<C> {
  /** True ⇒ anropet körs sekventiellt (efter alla föregående sekventiella). */
  isSequential: (call: C, index: number) => boolean;
}

/**
 * Kör `run` för varje anrop: parallella anrop startas direkt, sekventiella
 * körs ett i taget i listordning. Ett fel i ett sekventiellt anrop stoppar
 * INTE de efterföljande — `run` förväntas returnera ett resultat (t.ex.
 * `{ ok:false }`) i stället för att kasta; kastar den ändå propagerar felet.
 */
export async function runToolCallsOrdered<C, R>(
  calls: readonly C[],
  run: (call: C, index: number) => Promise<R>,
  options: OrderedDispatchOptions<C>
): Promise<R[]> {
  const results: R[] = new Array(calls.length);
  const parallel: Promise<void>[] = [];
  const sequential: number[] = [];

  calls.forEach((call, index) => {
    if (options.isSequential(call, index)) {
      sequential.push(index);
    } else {
      parallel.push(
        run(call, index).then((r) => {
          results[index] = r;
        })
      );
    }
  });

  for (const index of sequential) {
    results[index] = await run(calls[index]!, index);
  }
  await Promise.all(parallel);
  return results;
}

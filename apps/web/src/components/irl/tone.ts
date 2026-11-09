/** Låg = orange, mellan = gul, hög = grön (Movexum saknar röd, § 2.3). */
export function irlLevelTone(level: number): string {
  if (level <= 3) return 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange';
  if (level <= 6) return 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul';
  return 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron';
}

import { redirect } from 'next/navigation';

/**
 * Det finns ingen indexsida för /education/assignments – varje tilldelning
 * nås via /education/assignments/[id]. Den här sidan förhindrar att Next.js
 * App Router skickar en RSC-request för föräldrasegmentet och får 404 som
 * svar (vilket spökar i konsolen varje gång en server action anropar
 * revalidatePath('/education/assignments/[id]')).
 */
export default function WorkshopAssignmentsIndexPage() {
  redirect('/education');
}

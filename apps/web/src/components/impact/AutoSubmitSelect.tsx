'use client';

import type { SelectHTMLAttributes } from 'react';

/** Select som skickar sitt formulär när värdet ändras (originalets AutoSubmitSelect). Utan JS fungerar formulärets vanliga submit. */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      onChange={(event) => {
        props.onChange?.(event);
        event.currentTarget.form?.requestSubmit();
      }}
    />
  );
}

'use client';

export function ConfirmDeleteButton({ label, message }: { label: string; message: string }) {
  return (
    <button
      type="submit"
      className="mx-btn mx-sm"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}

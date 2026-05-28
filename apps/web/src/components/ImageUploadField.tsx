'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';

interface ImageUploadFieldProps {
  /** File input name sent to the server action. */
  name?: string;
  /** Existing image URL (when editing). */
  currentUrl?: string | null;
  label?: string;
  hint?: string;
  /** Checkbox name that flags removal of an existing image. */
  removeName?: string;
  /** Tailwind aspect-ratio class for the preview area. */
  aspectClass?: string;
}

export function ImageUploadField({
  name = 'image',
  currentUrl,
  label = 'Bild',
  hint = 'PNG, JPG eller WEBP · max 5 MB',
  removeName = 'remove_image',
  aspectClass = 'aspect-[16/9]'
}: ImageUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const [removed, setRemoved] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    if (!file) {
      setPreview(currentUrl ?? null);
      return;
    }
    setPreview(URL.createObjectURL(file));
    setRemoved(false);
  }

  function handleRemove() {
    if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    if (fileRef.current) fileRef.current.value = '';
    setPreview(null);
    setRemoved(Boolean(currentUrl));
  }

  return (
    <div>
      <p className="block text-sm font-medium text-foreground-muted">{label}</p>
      <div className="mt-2 flex items-start gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`group relative ${aspectClass} w-44 flex-shrink-0 overflow-hidden rounded-2xl border border-default bg-canvas-subtle transition hover:border-brand`}
          aria-label={`Ladda upp ${label.toLowerCase()}`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-foreground-subtle">
              <ImagePlus className="h-5 w-5" />
              <span className="text-[11px]">Lägg till bild</span>
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-movexum-svart/30 opacity-0 transition group-hover:opacity-100">
            <ImagePlus className="h-5 w-5 text-movexum-vit" />
          </span>
        </button>

        <div className="min-w-0 pt-1">
          <p className="text-xs text-foreground-subtle">{hint}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs font-medium text-link hover:underline"
            >
              {preview ? 'Byt bild' : 'Välj bild'}
            </button>
            {preview ? (
              <button
                type="button"
                onClick={handleRemove}
                className="inline-flex items-center gap-1 text-xs font-medium text-movexum-morkorange hover:underline dark:text-movexum-pastell-orange"
              >
                <Trash2 className="h-3 w-3" /> Ta bort
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        name={name}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleChange}
      />
      {removed ? <input type="hidden" name={removeName} value="on" /> : null}
    </div>
  );
}

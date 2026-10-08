'use client';

import { useRef, useState } from 'react';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_CATEGORY_META,
  effectiveNotificationChannels,
  setNotificationKindChannel,
  toggleMutedNotificationEntity,
  type NotificationCategory,
  type NotificationKind,
  type NotificationPreferences
} from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import {
  resetNotificationPreferencesAction,
  setNotificationChannelAction,
  setNotificationEntityMutedAction,
  setNotificationKindsInAppAction,
  type NotificationPreferencesActionState
} from '@/lib/actions/notifications';

/**
 * Mitt konto → Notiser (CLAUDE.md § 50). Listan är DYNAMISK: den byggs ur
 * notiskatalogen i `@platform/shared`, filtrerad på dina roller, så en ny
 * notistyp dyker upp här utan ändring i UI:t. Varje val sparas direkt
 * (optimistiskt; ett fel rullar tillbaka och visas). Obligatoriska typer —
 * där någon väntar på dig — kan inte stängas av.
 */
export function NotificationPreferencesForm({
  initial,
  groups,
  available
}: {
  initial: NotificationPreferences;
  groups: Array<{ category: NotificationCategory; kinds: NotificationKind[] }>;
  available: boolean;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Sparningar körs i tur och ordning — servern läser, ändrar och skriver.
  const chain = useRef<Promise<void>>(Promise.resolve());

  function save(optimistic: NotificationPreferences, task: () => Promise<NotificationPreferencesActionState>) {
    const previous = prefs;
    setPrefs(optimistic);
    setError(null);
    chain.current = chain.current.then(async () => {
      const res = await task();
      if (!res.ok) {
        setPrefs(previous);
        setError(res.error ?? 'Kunde inte spara.');
        return;
      }
      if (res.prefs) setPrefs(res.prefs);
      setSavedAt(Date.now());
    });
  }

  function toggleKind(kind: NotificationKind, enabled: boolean) {
    save(setNotificationKindChannel(prefs, kind, 'in_app', enabled), () =>
      setNotificationChannelAction(kind, 'in_app', enabled)
    );
  }

  function toggleCategory(kinds: NotificationKind[], enabled: boolean) {
    const optional = kinds.filter((k) => !NOTIFICATION_CATALOG[k].mandatory);
    if (optional.length === 0) return;
    const next = optional.reduce((acc, k) => setNotificationKindChannel(acc, k, 'in_app', enabled), prefs);
    save(next, () => setNotificationKindsInAppAction(optional, enabled));
  }

  function unmute(entity: { type: string; id: string; label?: string }) {
    save(toggleMutedNotificationEntity(prefs, entity, false), () => setNotificationEntityMutedAction(entity, false));
  }

  function reset() {
    save({ ...prefs, kinds: {}, muted: [] }, () => resetNotificationPreferencesAction());
  }

  const disabled = !available;

  return (
    <div className="space-y-5">
      {!available && (
        <p className="rounded-xl border border-movexum-gul bg-movexum-pastell-gul px-4 py-3 text-[13px] text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-gul">
          Notisinställningarna kan inte sparas än — databasen saknar inställningstabellen (migration
          1700000186). Du får alla notiser som standard tills den är på plats.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-movexum-orange bg-movexum-pastell-orange px-4 py-3 text-[13px] text-movexum-morkorange dark:bg-movexum-morkorange/20 dark:text-movexum-orange"
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map(({ category, kinds }) => {
          const meta = NOTIFICATION_CATEGORY_META[category];
          const optional = kinds.filter((k) => !NOTIFICATION_CATALOG[k].mandatory);
          const onCount = optional.filter((k) => effectiveNotificationChannels(prefs, k).in_app).length;
          const allOn = optional.length > 0 && onCount === optional.length;
          return (
            <section
              key={category}
              aria-labelledby={`notis-kat-${category}`}
              className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
                    <Icon name={meta.icon} size={14} />
                  </span>
                  <div className="min-w-0">
                    <h3 id={`notis-kat-${category}`} className="font-heading text-[14px] font-semibold text-foreground">
                      {meta.label}
                    </h3>
                    <p className="mt-0.5 text-[12px] text-foreground-muted">{meta.description}</p>
                  </div>
                </div>
                {optional.length > 1 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleCategory(kinds, !allOn)}
                    className="shrink-0 rounded-lg border border-default px-2.5 py-1 text-[11.5px] text-foreground-muted transition hover:border-strong hover:text-foreground disabled:opacity-50"
                  >
                    {allOn ? 'Stäng av alla' : 'Slå på alla'}
                  </button>
                )}
              </div>

              <ul className="mt-4 divide-y divide-default">
                {kinds.map((kind) => {
                  const k = NOTIFICATION_CATALOG[kind];
                  const on = effectiveNotificationChannels(prefs, kind).in_app;
                  const id = `notis-${kind}`;
                  return (
                    <li key={kind} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <label htmlFor={id} className="block text-[13px] font-medium text-foreground">
                          {k.label}
                        </label>
                        <p className="mt-0.5 text-[12px] text-foreground-muted">{k.description}</p>
                        {k.mandatory && (
                          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground-subtle">
                            <Icon name="shield" size={11} /> Alltid på — någon väntar på dig
                          </p>
                        )}
                      </div>
                      <Switch
                        id={id}
                        checked={on}
                        disabled={disabled || Boolean(k.mandatory)}
                        onChange={(v) => toggleKind(kind, v)}
                        label={`${k.label} i appen`}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
        <h3 className="font-heading text-[14px] font-semibold text-foreground">Tystade</h3>
        <p className="mt-0.5 text-[12px] text-foreground-muted">
          Uppdrag och andra saker du valt att inte få notiser om (via &rdquo;Tysta notiser om detta&rdquo; i en
          notis). Notiser där någon väntar på dig kommer ändå fram.
        </p>
        {prefs.muted.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-foreground-subtle">Inget tystat.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {prefs.muted.map((m) => (
              <li
                key={`${m.type}:${m.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-default px-3 py-2"
              >
                <span className="min-w-0 truncate text-[13px] text-foreground">{m.label || 'Tystad sak'}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => unmute(m)}
                  className="shrink-0 text-[12px] font-medium text-link hover:underline disabled:opacity-50"
                >
                  Slå på igen
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-foreground-subtle">
        <p className="max-w-2xl">
          Notiserna visas i klockan uppe till höger. E-post, push till mobilen och en daglig
          sammanställning kan väljas här när de kanalerna slås på.
        </p>
        <div className="flex items-center gap-3">
          {savedAt && <span aria-live="polite">Sparat</span>}
          <button
            type="button"
            disabled={disabled}
            onClick={reset}
            className="rounded-lg border border-default px-3 py-1.5 text-[12px] text-foreground-muted transition hover:border-strong hover:text-foreground disabled:opacity-50"
          >
            Återställ till standard
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({
  id,
  checked,
  disabled,
  onChange,
  label
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-movexum-morklila ' +
        (checked ? 'border-brand bg-brand' : 'border-strong bg-canvas-muted')
      }
    >
      <span
        aria-hidden
        className={
          'inline-block h-4 w-4 rounded-full bg-surface shadow-sm shadow-movexum-svart/20 transition-transform ' +
          (checked ? 'translate-x-[18px]' : 'translate-x-[3px]')
        }
      />
    </button>
  );
}

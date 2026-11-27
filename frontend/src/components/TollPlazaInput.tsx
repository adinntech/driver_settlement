"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { request } from "@/services/api";
import { formatDate, formatInr } from "@/utils/format";
import {
  STATUS_TEXT, canAutoFill, journeyRate, plazaLabel, type TollJourney, type TollSearchResponse, type TollSearchResult, type TollSourceInfo,
  type TollVehicleClass,
} from "@/utils/tolls";

/**
 * Toll location box with plaza suggestions from the server's toll directory (plaza name, state, NH number or place).
 * Typing always works as free text (manual entry); a suggestion only links the row to a plaza when the user picks it.
 * Without a vehicle class there is no lookup, because the rate depends on it.
 */
export default function TollPlazaInput({
  value, index, vehicleClass, journey, onType, onPick, onSource,
}: {
  value: string;
  index: number;
  vehicleClass: TollVehicleClass | "";
  journey: TollJourney;
  onType: (location: string) => void;
  onPick: (r: TollSearchResult, source: TollSourceInfo | null) => void;
  onSource?: (s: TollSourceInfo | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false); // only search after the user typed (not for a restored value)
  const [state, setState] = useState<{ q: string; error: string; data: TollSearchResponse | null }>({ q: "", error: "", data: null });
  const [active, setActive] = useState(-1);
  const q = useDebounce(value.trim(), 300);
  const listId = useId();
  const seq = useRef(0);

  const searchable = typed && open && !!vehicleClass && q.length >= 2;
  useEffect(() => {
    if (!searchable) return;
    const mine = ++seq.current; // "searching" shows while the last finished query differs from q
    request<TollSearchResponse>(`/tolls/search?q=${encodeURIComponent(q)}&vehicleClass=${vehicleClass}`)
      .then((data) => {
        if (mine !== seq.current) return; // a newer search finished first
        setState({ q, error: "", data });
        setActive(data.results.length ? 0 : -1);
        if (data.source) onSource?.(data.source);
      })
      .catch((e: Error) => mine === seq.current && setState({ q, error: e.message, data: null }));
  }, [searchable, q, vehicleClass, onSource]);

  const results = state.data?.results ?? [];
  const pick = (r: TollSearchResult) => {
    onPick(r, state.data?.source ?? null);
    setOpen(false);
    setTyped(false);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? results.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(results[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const show = open && typed && value.trim().length >= 2;
  return (
    <div className="proj-pick toll-pick">
      <input
        value={value}
        maxLength={120}
        placeholder={vehicleClass ? `Search toll plaza ${index + 1} (name, state, NH)` : `Location ${index + 1}`}
        aria-label={`Toll location ${index + 1}`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { onType(e.target.value); setTyped(true); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {show && (
        <div className="proj-results toll-results" role="listbox" id={listId} onMouseDown={(e) => e.preventDefault()}>
          {!vehicleClass ? (
            <p className="muted">Choose the toll vehicle class above to look up plaza rates. You can still type a location and rate manually.</p>
          ) : state.q !== q ? (
            <p className="muted">Searching toll plazas…</p>
          ) : state.error ? (
            <p className="toll-warn" role="alert">{state.error}</p>
          ) : !results.length ? (
            <p className="muted">No matching toll plaza. Check the spelling, or enter the location and rate manually.</p>
          ) : (
            <>
              {results.length > 1 && <p className="muted toll-results-note">{results.length} plazas match: check the NH and state to pick the right one.</p>}
              {results.map((r, i) => <Suggestion key={r.id} r={r} journey={journey} id={`${listId}-${i}`} active={i === active} onPick={pick} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Suggestion({ r, journey, id, active, onPick }: { r: TollSearchResult; journey: TollJourney; id: string; active: boolean; onPick: (r: TollSearchResult) => void }) {
  const rate = journeyRate(r, journey);
  const auto = canAutoFill(r, journey);
  const where = [r.location && r.location !== r.name ? r.location : "", r.chainage ?? ""].filter(Boolean).join(" · ");
  return (
    <button type="button" id={id} role="option" aria-selected={active} className={`proj-item toll-item${active ? " is-active" : ""}`} onClick={() => onPick(r)}>
      <span className="toll-item-top">
        <strong>{plazaLabel(r)}</strong>
        <span className={`toll-rate${auto ? "" : " is-warn"}`}>{rate === null ? "No rate" : formatInr(rate)}</span>
      </span>
      {where && <small className="muted">{where.slice(0, 140)}</small>}
      <small className={auto ? "muted" : "toll-warn"}>
        {STATUS_TEXT[r.rate.status] ?? r.rate.status}
        {r.sourceType === "state" ? " · state highway" : ""}
        {r.rateEffectiveDate ? ` · effective ${formatDate(r.rateEffectiveDate)}` : ""}
      </small>
    </button>
  );
}

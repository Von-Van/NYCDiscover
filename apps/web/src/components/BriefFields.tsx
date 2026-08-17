import type { Mood, TransportMode } from "@/lib/api-types";
import type { DiscoveryForm } from "@/lib/form";

const moods: Array<{ value: Mood; label: string; mark: string }> = [
  { value: "social", label: "Social", mark: "S" },
  { value: "relaxing", label: "Relaxing", mark: "R" },
  { value: "outdoors", label: "Outdoors", mark: "O" },
  { value: "date-night", label: "Date night", mark: "D" },
  { value: "productive", label: "Productive", mark: "P" },
  { value: "chaotic", label: "Chaotic", mark: "!" },
  { value: "low-energy", label: "Low energy", mark: "L" },
  { value: "cultural", label: "Cultural", mark: "C" },
  { value: "food-focused", label: "Food-focused", mark: "F" },
];

const durations = [
  [90, "1½ hours"],
  [120, "2 hours"],
  [180, "3 hours"],
  [240, "4 hours"],
  [360, "6 hours"],
] as const;

export const initialDiscoveryForm: DiscoveryForm = {
  locationLabel: "",
  coordinates: null,
  startMode: "now",
  laterTime: "19:00",
  availableMinutes: 240,
  budgetMax: 40,
  groupSize: 2,
  transportMode: "walk",
  radiusMiles: 2,
  mood: "social",
};

interface BriefFieldsProps {
  form: DiscoveryForm;
  message: string;
  errors: string[];
  disabled?: boolean;
  compact?: boolean;
  onLocateMe: () => void;
  onResolveLocation: () => void;
  onUpdate: <K extends keyof DiscoveryForm>(key: K, value: DiscoveryForm[K]) => void;
}

export function BriefFields({
  form,
  message,
  errors,
  disabled = false,
  compact = false,
  onLocateMe,
  onResolveLocation,
  onUpdate,
}: BriefFieldsProps) {
  return (
    <div className={compact ? "brief-fields brief-fields-compact" : "brief-fields"}>
      <fieldset className="form-section location-section" disabled={disabled}>
        <legend>
          <span>1</span> Start here
        </legend>
        <label htmlFor={compact ? "inspector-location" : "location"}>
          Neighborhood, landmark, or address
        </label>
        <div className="location-row">
          <input
            id={compact ? "inspector-location" : "location"}
            value={form.locationLabel}
            onChange={(event) => {
              onUpdate("locationLabel", event.target.value);
              onUpdate("coordinates", null);
            }}
            placeholder="Try “Upper West Side”"
            autoComplete="street-address"
          />
          <button type="button" className="square-button" onClick={onResolveLocation}>
            Set
          </button>
        </div>
        <button type="button" className="text-button" onClick={onLocateMe}>
          <span className="crosshair" aria-hidden="true">⌖</span> Use my current location
        </button>
        {message && <p className="form-message" role="status">{message}</p>}
      </fieldset>

      <div className="form-grid">
        <fieldset className="form-section" disabled={disabled}>
          <legend>
            <span>2</span> Start time
          </legend>
          <div className="segmented">
            {(["now", "later"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={form.startMode === mode ? "active" : ""}
                aria-pressed={form.startMode === mode}
                onClick={() => onUpdate("startMode", mode)}
              >
                {mode === "now" ? "Now" : "Later today"}
              </button>
            ))}
          </div>
          {form.startMode === "later" && (
            <input
              aria-label="Start time"
              type="time"
              value={form.laterTime}
              onChange={(event) => onUpdate("laterTime", event.target.value)}
            />
          )}
        </fieldset>

        <fieldset className="form-section" disabled={disabled}>
          <legend>
            <span>3</span> Time available
          </legend>
          <select
            aria-label="Time available"
            value={form.availableMinutes}
            onChange={(event) => onUpdate("availableMinutes", Number(event.target.value))}
          >
            {durations.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </fieldset>
      </div>

      <div className="form-grid">
        <fieldset className="form-section" disabled={disabled}>
          <legend>
            <span>4</span> Per-person budget
          </legend>
          <div className="range-readout">
            <span>$0</span>
            <strong>${form.budgetMax}</strong>
          </div>
          <input
            aria-label="Maximum per-person budget"
            type="range"
            min="0"
            max="100"
            step="5"
            value={form.budgetMax}
            onChange={(event) => onUpdate("budgetMax", Number(event.target.value))}
          />
        </fieldset>

        <fieldset className="form-section" disabled={disabled}>
          <legend>
            <span>5</span> Group size
          </legend>
          <div className="stepper">
            <button
              type="button"
              aria-label="Decrease group size"
              onClick={() => onUpdate("groupSize", Math.max(1, form.groupSize - 1))}
            >−</button>
            <strong>{form.groupSize}</strong>
            <button
              type="button"
              aria-label="Increase group size"
              onClick={() => onUpdate("groupSize", Math.min(12, form.groupSize + 1))}
            >+</button>
          </div>
        </fieldset>
      </div>

      <fieldset className="form-section" disabled={disabled}>
        <legend>
          <span>6</span> How are you moving?
        </legend>
        <div className="transport-row">
          {(["walk", "bike", "transit"] as TransportMode[]).map((mode) => (
            <button
              type="button"
              key={mode}
              className={form.transportMode === mode ? "active" : ""}
              aria-pressed={form.transportMode === mode}
              onClick={() => onUpdate("transportMode", mode)}
            >
              <i aria-hidden="true">{mode === "walk" ? "↟" : mode === "bike" ? "◎" : "M"}</i>
              {mode}
            </button>
          ))}
          <label className="radius-control">
            <span>Radius</span>
            <select
              value={form.radiusMiles}
              onChange={(event) => onUpdate("radiusMiles", Number(event.target.value))}
            >
              <option value="1">1 mi</option>
              <option value="2">2 mi</option>
              <option value="3">3 mi</option>
              <option value="5">5 mi</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="form-section mood-section" disabled={disabled}>
        <legend>
          <span>7</span> Pick the mood
        </legend>
        <div className="mood-grid">
          {moods.map((mood) => (
            <button
              type="button"
              key={mood.value}
              className={form.mood === mood.value ? "active" : ""}
              aria-pressed={form.mood === mood.value}
              onClick={() => onUpdate("mood", mood.value)}
            >
              <span aria-hidden="true">{mood.mark}</span>
              {mood.label}
            </button>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div className="error-box" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
    </div>
  );
}

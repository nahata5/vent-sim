import { useEffect, useState } from 'preact/hooks';
import type { VentSettings } from '../sim/vent/settings';
import type { Mode } from '../sim/types';
import { IMPLEMENTED_MODES } from '../sim/types';
import type { SessionController } from '../app/controller';

interface Props {
  ctl: SessionController;
  settings: VentSettings;
  pendingOnVent: Array<keyof VentSettings>;
}

type NumKey = {
  [K in keyof VentSettings]: VentSettings[K] extends number ? K : never;
}[keyof VentSettings];

interface FieldDef {
  key: NumKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  modes?: Mode[];
  /** Display transform (settings store FiO2 as a fraction). */
  toDisplay?: (v: number) => number;
  fromDisplay?: (v: number) => number;
}

const FIELDS: FieldDef[] = [
  { key: 'peep', label: 'PEEP', unit: 'cmH2O', min: 0, max: 25, step: 1 },
  { key: 'fio2', label: 'FiO2', unit: '%', min: 21, max: 100, step: 5, toDisplay: (v) => Math.round(v * 100), fromDisplay: (v) => v / 100 },
  { key: 'vt', label: 'Tidal volume', unit: 'mL', min: 100, max: 1200, step: 10, modes: ['VC-AC', 'SIMV'] },
  { key: 'rr', label: 'Rate', unit: '/min', min: 4, max: 60, step: 1, modes: ['VC-AC', 'PC-AC', 'SIMV'] },
  { key: 'peakFlow', label: 'Peak flow', unit: 'L/min', min: 10, max: 120, step: 5, modes: ['VC-AC', 'SIMV'] },
  { key: 'pause', label: 'Insp. pause', unit: 's', min: 0, max: 2, step: 0.1, modes: ['VC-AC', 'SIMV'] },
  { key: 'pinsp', label: 'Pinsp above PEEP', unit: 'cmH2O', min: 0, max: 40, step: 1, modes: ['PC-AC', 'SIMV'] },
  { key: 'ti', label: 'Ti', unit: 's', min: 0.2, max: 3, step: 0.1, modes: ['PC-AC', 'SIMV'] },
  { key: 'ps', label: 'Pressure support', unit: 'cmH2O', min: 0, max: 40, step: 1, modes: ['PSV', 'SIMV'] },
  { key: 'ets', label: 'ETS (cycle-off)', unit: '% peak', min: 5, max: 80, step: 5, modes: ['PSV', 'SIMV'], toDisplay: (v) => Math.round(v * 100), fromDisplay: (v) => v / 100 },
  { key: 'tiMax', label: 'Ti max', unit: 's', min: 0.5, max: 4, step: 0.1, modes: ['PSV', 'SIMV'] },
  { key: 'riseTime', label: 'Rise time', unit: 's', min: 0, max: 0.4, step: 0.05, modes: ['PC-AC', 'PSV', 'SIMV'] },
  { key: 'flowTrigger', label: 'Flow trigger', unit: 'L/min', min: 0.5, max: 10, step: 0.5 },
  { key: 'pressureTrigger', label: 'Pressure trigger', unit: 'cmH2O', min: 0.5, max: 5, step: 0.5 },
  { key: 'simvWindow', label: 'Sync window', unit: 'fraction of period', min: 0.05, max: 1, step: 0.05, modes: ['SIMV'] },
];

type Draft = Partial<Pick<VentSettings, NumKey>> & {
  mode?: Mode;
  triggerType?: VentSettings['triggerType'];
  flowPattern?: VentSettings['flowPattern'];
  simvBase?: VentSettings['simvBase'];
};

export function SettingsPanel({ ctl, settings, pendingOnVent }: Props) {
  const [draft, setDraft] = useState<Draft>({});
  const [showAlarms, setShowAlarms] = useState(false);
  const [alarmDraft, setAlarmDraft] = useState<Partial<VentSettings['alarms']>>({});
  useEffect(() => {
    setDraft({});
    setAlarmDraft({});
  }, [ctl.scenario?.id]);

  const mode = draft.mode ?? settings.mode;
  const triggerType = draft.triggerType ?? settings.triggerType;
  const base = draft.simvBase ?? settings.simvBase;
  const dirty = Object.keys(draft).length + Object.keys(alarmDraft).length > 0;

  const confirm = () => {
    const partial: Partial<VentSettings> = { ...draft };
    if (Object.keys(alarmDraft).length) partial.alarms = { ...settings.alarms, ...alarmDraft };
    ctl.applySettings(partial);
    setDraft({});
    setAlarmDraft({});
  };
  const cancel = () => {
    setDraft({});
    setAlarmDraft({});
  };

  const visible = FIELDS.filter((f) => !f.modes || f.modes.includes(mode))
    .filter((f) => (f.key === 'flowTrigger' ? triggerType === 'flow' : f.key === 'pressureTrigger' ? triggerType === 'pressure' : true))
    .filter((f) => mode !== 'SIMV' || (base === 'PC' ? !['vt', 'peakFlow', 'pause'].includes(f.key) : !['pinsp', 'ti'].includes(f.key)));

  return (
    <section class="panel settings" aria-label="Ventilator settings" data-testid="settings-panel">
      <h2>Settings</h2>
      <label class="field">
        <span>Mode</span>
        <select
          value={mode}
          data-testid="mode-select"
          onChange={(e) => setDraft({ ...draft, mode: (e.currentTarget).value as Mode })}
          class={draft.mode !== undefined && draft.mode !== settings.mode ? 'pending' : ''}
        >
          {IMPLEMENTED_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {mode === 'SIMV' && (
        <label class="field">
          <span>Mandatory breaths</span>
          <select
            value={base}
            data-testid="simv-base-select"
            class={draft.simvBase !== undefined && draft.simvBase !== settings.simvBase ? 'pending' : ''}
            onChange={(e) => setDraft({ ...draft, simvBase: (e.currentTarget).value as VentSettings['simvBase'] })}
          >
            <option value="VC">Volume control</option>
            <option value="PC">Pressure control</option>
          </select>
        </label>
      )}
      {visible.map((f) => {
        const cur = settings[f.key];
        const d = draft[f.key];
        const shown = f.toDisplay ? f.toDisplay(d ?? cur) : (d ?? cur);
        const isPending = d !== undefined && d !== cur;
        const onVent = pendingOnVent.includes(f.key);
        return (
          <label class={`field ${isPending ? 'pending' : ''} ${onVent ? 'on-vent' : ''}`} key={f.key}>
            <span>
              {f.label} <em class="muted">{f.unit}</em>
              {onVent && <em class="chip chip-pending">next breath</em>}
            </span>
            <input
              type="number"
              data-testid={`setting-${f.key}`}
              min={f.min}
              max={f.max}
              step={f.step}
              value={Number.isInteger(shown) ? shown : Number(shown.toFixed(2))}
              onInput={(e) => {
                const raw = Number((e.currentTarget).value);
                if (!Number.isFinite(raw)) return;
                const v = f.fromDisplay ? f.fromDisplay(raw) : raw;
                setDraft({ ...draft, [f.key]: v });
              }}
            />
          </label>
        );
      })}
      {(mode === 'VC-AC' || (mode === 'SIMV' && base === 'VC')) && (
        <label class="field">
          <span>Flow pattern</span>
          <select
            value={draft.flowPattern ?? settings.flowPattern}
            class={draft.flowPattern !== undefined && draft.flowPattern !== settings.flowPattern ? 'pending' : ''}
            onChange={(e) => setDraft({ ...draft, flowPattern: (e.currentTarget).value as VentSettings['flowPattern'] })}
          >
            <option value="square">Square</option>
            <option value="ramp">Decelerating ramp</option>
          </select>
        </label>
      )}
      <label class="field">
        <span>Trigger</span>
        <select
          value={triggerType}
          class={draft.triggerType !== undefined && draft.triggerType !== settings.triggerType ? 'pending' : ''}
          onChange={(e) => setDraft({ ...draft, triggerType: (e.currentTarget).value as VentSettings['triggerType'] })}
        >
          <option value="flow">Flow</option>
          <option value="pressure">Pressure</option>
        </select>
      </label>
      <div class="confirm-row">
        <button type="button" class="primary" disabled={!dirty} onClick={confirm} data-testid="confirm-settings">
          Confirm
        </button>
        <button type="button" disabled={!dirty} onClick={cancel}>
          Cancel
        </button>
        {dirty && <span class="muted small">pending → confirm</span>}
      </div>
      <button type="button" class="link" onClick={() => setShowAlarms(!showAlarms)} aria-expanded={showAlarms}>
        {showAlarms ? '▾' : '▸'} Alarm limits
      </button>
      {showAlarms && (
        <div class="alarm-limits">
          {(
            [
              ['highPpeak', 'High Ppeak', 'cmH2O', 15, 60, 1],
              ['lowVte', 'Low Vte', 'mL', 50, 800, 10],
              ['highRR', 'High RR', '/min', 10, 60, 1],
              ['highVe', 'High Ve', 'L/min', 5, 40, 1],
              ['lowVe', 'Low Ve', 'L/min', 0, 10, 0.5],
              ['highPeepi', 'High PEEPi', 'cmH2O', 1, 15, 1],
            ] as const
          ).map(([key, label, unit, min, max, step]) => (
            <label class={`field ${alarmDraft[key] !== undefined ? 'pending' : ''}`} key={key}>
              <span>
                {label} <em class="muted">{unit}</em>
              </span>
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={alarmDraft[key] ?? settings.alarms[key]}
                onInput={(e) => setAlarmDraft({ ...alarmDraft, [key]: Number((e.currentTarget).value) })}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

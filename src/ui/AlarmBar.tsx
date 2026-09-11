import type { AlarmId } from '../sim/vent/ventilator';
import { alarmLabel } from './waveform-draw';

interface Props {
  active: AlarmId[];
  inBackup: boolean;
  pendingCount: number;
}

export function AlarmBar({ active, inBackup, pendingCount }: Props) {
  return (
    <div class={`alarm-bar ${active.length ? 'has-alarms' : ''}`} role="status" aria-live="polite" data-testid="alarm-bar">
      {active.length === 0 ? (
        <span class="muted small">No active alarms</span>
      ) : (
        active.map((a) => (
          <span class="chip chip-alarm" key={a}>
            ⚠ {alarmLabel(a)}
          </span>
        ))
      )}
      {inBackup && <span class="chip chip-warn">apnea backup ventilation</span>}
      {pendingCount > 0 && <span class="chip chip-pending">{pendingCount} setting(s) apply at next breath</span>}
    </div>
  );
}
